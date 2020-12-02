var sinon = require('sinon');
var expect = require('chai').expect;
var Backend = require('../../lib/backend');
var Connection = require('../../lib/client/connection');
var LegacyConnection = require('sharedb-legacy/lib/client').Connection;
var StreamSocket = require('../../lib/stream-socket');

describe('client connection', function() {
  beforeEach(function() {
    this.backend = new Backend();
  });

  it('ends the agent stream when a connection is closed after connect', function(done) {
    var connection = this.backend.connect();
    connection.agent.stream.on('end', function() {
      done();
    });
    connection.on('connected', function() {
      connection.close();
    });
  });

  it('ends the agent stream when a connection is immediately closed', function(done) {
    var connection = this.backend.connect();
    connection.agent.stream.on('end', function() {
      done();
    });
    connection.close();
  });

  it('emits closed event on call to connection.close()', function(done) {
    var connection = this.backend.connect();
    connection.on('closed', function() {
      done();
    });
    connection.close();
  });

  it('ends the agent stream on call to agent.close()', function(done) {
    var isDone = false;
    var finish = function() {
      if (!isDone) done();
    };

    this.backend.use('connect', function(request, next) {
      request.agent.stream.on('close', finish);
      request.agent.stream.on('end', finish);
      request.agent.close();
      next();
    });
    this.backend.connect();
  });

  it('emits stopped event on call to agent.close()', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.close();
      next();
    });
    var connection = this.backend.connect();
    connection.on('stopped', function() {
      done();
    });
  });

  it('subscribing to same doc closes old stream and adds new stream to agent', function(done) {
    var connection = this.backend.connect();
    var agent = connection.agent;
    var collection = 'test';
    var docId = 'abcd-1234';
    var doc = connection.get(collection, docId);
    doc.subscribe(function(err) {
      if (err) return done(err);
      var originalStream = agent.subscribedDocs[collection][docId];
      doc.subscribe(function() {
        if (err) return done(err);
        expect(originalStream).to.have.property('open', false);
        var newStream = agent.subscribedDocs[collection][docId];
        expect(newStream).to.have.property('open', true);
        expect(newStream).to.not.equal(originalStream);
        connection.close();
        done();
      });
    });
  });

  it('emits socket errors as "connection error" events', function(done) {
    var connection = this.backend.connect();
    connection.on('connection error', function(err) {
      expect(err.message).equal('Test');
      done();
    });
    connection.socket.onerror({message: 'Test'});
  });

  it('connects to a Backend that binds its socket late', function(done) {
    var backend = this.backend;
    var socket = new StreamSocket();
    var connection = new Connection(socket);
    socket._open();
    var doc = connection.get('test', '123');
    doc.fetch(done);

    socket.stream.on('data', function() {
      // Registering a stream triggers data to get flushed in our tests.
      // In production, aw web socket might lose messages any time between
      // connection and calling backend.listen()
    });

    process.nextTick(function() {
      backend.listen(socket.stream);
    });
  });

  it('connects when binding the Connection late', function(done) {
    var backend = this.backend;
    var socket = new StreamSocket();
    socket._open();
    backend.listen(socket.stream);

    process.nextTick(function() {
      var connection = new Connection(socket);
      var doc = connection.get('test', '123');
      doc.fetch(done);
    });
  });

  describe('backend.agentsCount', function() {
    it('updates after connect and connection.close()', function(done) {
      var backend = this.backend;
      expect(backend.agentsCount).equal(0);
      var connection = backend.connect();
      expect(backend.agentsCount).equal(1);
      connection.on('connected', function() {
        connection.close();
        setTimeout(function() {
          expect(backend.agentsCount).equal(0);
          done();
        }, 10);
      });
    });

    it('updates after connection socket stream emits "close"', function(done) {
      var backend = this.backend;
      var connection = backend.connect();
      connection.on('connected', function() {
        connection.socket.stream.emit('close');
        expect(backend.agentsCount).equal(0);
        done();
      });
    });

    it('updates correctly after stream emits both "end" and "close"', function(done) {
      var backend = this.backend;
      var connection = backend.connect();
      connection.on('connected', function() {
        connection.socket.stream.emit('end');
        connection.socket.stream.emit('close');
        expect(backend.agentsCount).equal(0);
        done();
      });
    });

    it('does not increment when agent connect is rejected', function() {
      var backend = this.backend;
      backend.use('connect', function(request, next) {
        next({message: 'Error'});
      });
      expect(backend.agentsCount).equal(0);
      backend.connect();
      expect(backend.agentsCount).equal(0);
    });
  });

  describe('state management using setSocket', function() {
    it('initial connection.state is connecting, if socket.readyState is CONNECTING', function() {
      // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-connecting
      var socket = {readyState: 0};
      var connection = new Connection(socket);
      expect(connection.state).equal('connecting');
    });

    it('initial connection.state is connecting and init handshake, if socket.readyState is OPEN', function() {
      var socket = {
        readyState: 1,
        send: sinon.spy()
      };
      var connection = new Connection(socket);
      expect(connection.state).equal('connecting');
      expect(socket.send.calledOnce).to.be.true;
      var message = JSON.parse(socket.send.getCall(0).args[0]);
      expect(message.a).to.equal('hs');
    });

    it('initial connection.state is disconnected, if socket.readyState is CLOSING', function() {
      // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-closing
      var socket = {readyState: 2};
      var connection = new Connection(socket);
      expect(connection.state).equal('disconnected');
    });

    it('initial connection.state is disconnected, if socket.readyState is CLOSED', function() {
      // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-closed
      var socket = {readyState: 3};
      var connection = new Connection(socket);
      expect(connection.state).equal('disconnected');
    });

    it('initial state is connecting', function() {
      var connection = this.backend.connect();
      expect(connection.state).equal('connecting');
    });

    it('after connected event is emitted, state is connected', function(done) {
      var connection = this.backend.connect();
      connection.on('connected', function() {
        expect(connection.state).equal('connected');
        done();
      });
    });

    it('when connection is manually closed, state is closed', function(done) {
      var connection = this.backend.connect();
      connection.on('connected', function() {
        connection.close();
      });
      connection.on('closed', function() {
        expect(connection.state).equal('closed');
        done();
      });
    });

    it('when connection is disconnected, state is disconnected', function(done) {
      var connection = this.backend.connect();
      connection.on('connected', function() {
        // Mock a disconnection by providing a reason
        connection.socket.close('foo');
      });
      connection.on('disconnected', function() {
        expect(connection.state).equal('disconnected');
        done();
      });
    });
  });

  it('persists its id and seq when reconnecting', function(done) {
    var backend = this.backend;
    backend.connect(null, null, function(connection) {
      var id = connection.id;
      expect(id).to.be.ok;
      var doc = connection.get('test', '123');
      doc.create({foo: 'bar'}, function(error) {
        if (error) return done(error);
        expect(connection.seq).to.equal(2);
        connection.close();
        backend.connect(connection, null, function() {
          expect(connection.id).to.equal(id);
          expect(connection.seq).to.equal(2);
          done();
        });
      });
    });
  });

  it('still connects to legacy clients, whose ID changes on reconnection', function(done) {
    var currentBackend = this.backend;
    var socket = new StreamSocket();
    var legacyClient = new LegacyConnection(socket);
    currentBackend.connect(legacyClient);

    var doc = legacyClient.get('test', '123');
    doc.create({foo: 'bar'}, function(error) {
      if (error) return done(error);
      var initialId = legacyClient.id;
      expect(initialId).to.equal(legacyClient.agent.clientId);
      expect(legacyClient.agent.src).to.be.null;
      legacyClient.close();
      currentBackend.connect(legacyClient);
      doc.submitOp({p: ['baz'], oi: 'qux'}, function(error) {
        if (error) return done(error);
        var newId = legacyClient.id;
        expect(newId).not.to.equal(initialId);
        expect(newId).to.equal(legacyClient.agent.clientId);
        expect(legacyClient.agent.src).to.be.null;
        done();
      });
    });
  });

  it('errors when submitting an op with a very large seq', function(done) {
    this.backend.connect(null, null, function(connection) {
      var doc = connection.get('test', '123');
      doc.create({foo: 'bar'}, function(error) {
        if (error) return done(error);
        connection.sendOp(doc, {
          op: {p: ['foo'], od: 'bar'},
          src: connection.id,
          seq: Number.MAX_SAFE_INTEGER
        });
        doc.once('error', function(error) {
          expect(error.code).to.equal('ERR_CONNECTION_SEQ_INTEGER_OVERFLOW');
          done();
        });
      });
    });
  });
});
