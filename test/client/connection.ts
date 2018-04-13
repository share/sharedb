var expect = require('expect.js');
var Backend = require('../../lib/backend');
var Connection = require('../../lib/client/connection');

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

  it('ends the agent steam on call to agent.close()', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.stream.on('end', function() {
        done();
      });
      request.agent.close();
      next();
    });
    var connection = this.backend.connect();
  })

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

  it('emits socket errors as "connection error" events', function(done) {
    var connection = this.backend.connect();
    connection.on('connection error', function(err) {
      expect(err.message).equal('Test');
      done();
    });
    connection.socket.onerror({message: 'Test'});
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

    it('does not increment when agent connect is rejected', function() {
      var backend = this.backend;
      backend.use('connect', function(request, next) {
        next({message: 'Error'});
      });
      expect(backend.agentsCount).equal(0);
      var connection = backend.connect();
      expect(backend.agentsCount).equal(0);
    });
  });

  describe('state management using setSocket', function() {

    it('initial connection.state is connecting, if socket.readyState is CONNECTING', function () {
        // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-connecting
        var socket = {readyState: 0};
        var connection = new Connection(socket);
        expect(connection.state).equal('connecting');
    });

    it('initial connection.state is connecting, if socket.readyState is OPEN', function () {
        // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-open
        var socket = {readyState: 1};
        var connection = new Connection(socket);
        expect(connection.state).equal('connecting');
    });

    it('initial connection.state is disconnected, if socket.readyState is CLOSING', function () {
        // https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-closing
        var socket = {readyState: 2};
        var connection = new Connection(socket);
        expect(connection.state).equal('disconnected');
    });

    it('initial connection.state is disconnected, if socket.readyState is CLOSED', function () {
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

});
