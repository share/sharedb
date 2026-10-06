var Backend = require('../lib/backend');
var logger = require('../lib/logger');
var sinon = require('sinon');
var StreamSocket = require('../lib/stream-socket');
var expect = require('chai').expect;
var ACTIONS = require('../lib/message-actions').ACTIONS;
var Connection = require('../lib/client/connection');
var protocol = require('../lib/protocol');
var LegacyConnection = require('sharedb-legacy/lib/client').Connection;
var util = require('./util');

describe('Agent', function() {
  var backend;

  beforeEach(function() {
    backend = new Backend();
  });

  afterEach(function(done) {
    backend.close(done);
  });

  describe('handshake', function() {
    it('warns when messages are sent before the handshake', function(done) {
      var socket = new StreamSocket();
      var stream = socket.stream;
      backend.listen(stream);
      sinon.spy(logger, 'warn');
      socket.send(JSON.stringify({a: ACTIONS.subscribe, c: 'dogs', d: 'fido'}));
      var connection = new Connection(socket);
      socket._open();
      connection.once('connected', function() {
        expect(logger.warn).to.have.been.calledOnceWithExactly(
          'Unexpected message received before handshake',
          {a: ACTIONS.subscribe, c: 'dogs', d: 'fido'}
        );
        done();
      });
    });

    it('does not warn when messages are sent after the handshake', function(done) {
      var socket = new StreamSocket();
      var stream = socket.stream;
      var agent = backend.listen(stream);
      sinon.spy(logger, 'warn');
      var connection = new Connection(socket);
      socket._open();
      connection.once('connected', function() {
        socket.send(JSON.stringify({a: ACTIONS.subscribe, c: 'dogs', d: 'fido'}));
        expect(logger.warn).not.to.have.been.called;
        expect(agent._firstReceivedMessage).to.be.null;
        done();
      });
    });

    it('does not warn for clients on protocol v1.0', function(done) {
      backend.use('receive', function(request, next) {
        var error = null;
        if (request.data.a === ACTIONS.handshake) error = new Error('Unexpected handshake');
        next(error);
      });
      var socket = new StreamSocket();
      var stream = socket.stream;
      backend.listen(stream);
      sinon.spy(logger, 'warn');
      socket.send(JSON.stringify({a: ACTIONS.subscribe, c: 'dogs', d: 'fido'}));
      var connection = new LegacyConnection(socket);
      socket._open();
      connection.get('dogs', 'fido').fetch(function(error) {
        if (error) return done(error);
        expect(logger.warn).not.to.have.been.called;
        done();
      });
    });

    it('records the client protocol on the agent', function(done) {
      var connection = backend.connect();
      connection.once('connected', function() {
        expect(connection.agent.protocol).to.eql({
          major: protocol.major,
          minor: protocol.minor
        });
        done();
      });
    });
  });

  describe('pub/sub channel collisions', function() {
    var writer;
    var subscriber;

    beforeEach(function() {
      writer = backend.connect();
      subscriber = backend.connect();
    });

    it('does not deliver ops for a doc whose collection and id join to the same channel', function(done) {
      var doc = subscriber.get('notes', 'private.alice');
      doc.subscribe(function(error) {
        if (error) return done(error);
        doc.once('create', function() {
          expect(doc.data).to.eql({text: 'Hello'});
          done();
        });
        writer.get('notes.private', 'alice').create({diary: 'Dear diary'}, function(error) {
          if (error) return done(error);
          writer.get('notes', 'private.alice').create({text: 'Hello'}, function(error) {
            if (error) done(error);
          });
        });
      });
    });

    it('does not deliver ops from a collection whose channel matches the doc channel', function(done) {
      var doc = subscriber.get('notes', 'private');
      doc.subscribe(function(error) {
        if (error) return done(error);
        doc.once('create', function() {
          expect(doc.data).to.eql({text: 'Hello'});
          done();
        });
        writer.get('notes.private', 'alice').create({diary: 'Dear diary'}, function(error) {
          if (error) return done(error);
          writer.get('notes', 'private').create({text: 'Hello'}, function(error) {
            if (error) done(error);
          });
        });
      });
    });

    it('does not deliver ops to a query on a collection whose channel matches the doc channel', function(done) {
      var opMessages = [];
      var diaryEdit = {p: ['diary'], od: 'Dear diary', oi: 'Dear diary, again'};
      subscriber.on('receive', function(request) {
        if (request.data.a === ACTIONS.op) opMessages.push(request.data);
      });
      var privateDoc = writer.get('notes.private', 'private');
      privateDoc.create({diary: 'Dear diary'}, function(error) {
        if (error) return done(error);
        subscriber.createSubscribeQuery('notes.private', {}, null, function(error, results) {
          if (error) return done(error);
          results[0].once('op', function() {
            expect(opMessages).to.have.length(1);
            expect(opMessages[0].op).to.eql([diaryEdit]);
            done();
          });
          writer.get('notes', 'private').create({text: 'Hello'}, function(error) {
            if (error) return done(error);
            privateDoc.submitOp(diaryEdit, function(error) {
              if (error) done(error);
            });
          });
        });
      });
    });

    it('does not deliver ops to a query from another collection sharing its custom channel', function(done) {
      backend.use('commit', function(context, next) {
        context.channels.push('shared');
        next();
      });
      backend.use('query', function(context, next) {
        context.channels = ['shared'];
        next();
      });
      var opMessages = [];
      var rename = {p: ['name'], od: 'Fido', oi: 'Rex'};
      subscriber.on('receive', function(request) {
        if (request.data.a === ACTIONS.op) opMessages.push(request.data);
      });
      var dog = writer.get('dogs', 'fido');
      dog.create({name: 'Fido'}, function(error) {
        if (error) return done(error);
        subscriber.createSubscribeQuery('dogs', {}, null, function(error, results) {
          if (error) return done(error);
          results[0].once('op', function() {
            expect(opMessages).to.have.length(1);
            expect(opMessages[0].op).to.eql([rename]);
            done();
          });
          writer.get('cats', 'fido').create({name: 'Tom'}, function(error) {
            if (error) return done(error);
            dog.submitOp(rename, function(error) {
              if (error) done(error);
            });
          });
        });
      });
    });
  });

  describe('query subscribe with known results', function() {
    var connection;

    beforeEach(function(done) {
      connection = backend.connect();
      connection.get('dogs', 'fido').create({name: 'Fido'}, done);
    });

    function resubscribe(callback) {
      connection.on('receive', function(request) {
        if (request.data.a === ACTIONS.querySubscribe) callback(request.data);
      });
      connection.send({
        a: ACTIONS.querySubscribe,
        id: 1,
        c: 'dogs',
        q: {},
        o: {pollDebounce: 0, pollInterval: 50},
        r: [['fido', 0], ['spot', null]]
      });
    }

    it('does not read known results when the query middleware rejects it', function(done) {
      backend.use('query', function(context, next) {
        next(new Error('Forbidden'));
      });
      sinon.spy(backend.db, 'getOpsBulk');
      sinon.spy(backend.db, 'getSnapshotBulk');
      resubscribe(function(reply) {
        expect(reply.error).to.have.property('message', 'Forbidden');
        expect(backend.db.getOpsBulk).not.to.have.been.called;
        expect(backend.db.getSnapshotBulk).not.to.have.been.called;
        done();
      });
    });

    it('does not stay subscribed if fetching known results fails', function(done) {
      backend.use('op', function(context, next) {
        next(new Error('Forbidden'));
      });
      resubscribe(function(reply) {
        expect(reply.error).to.have.property('message', 'Forbidden');
        expect(connection.agent.subscribedQueries).to.be.empty;
        expect(backend.pubsub.streamsCount).to.equal(0);
        done();
      });
    });

    it('does not stay subscribed if re-polling the query fails', function(done) {
      var clock = util.useFakeTimers();
      connection.get('dogs', 'rex').create({name: 'Rex'}, function(error) {
        if (error) return done(error);
        backend.use('readSnapshots', function(context, next) {
          var forbidden = context.snapshots.some(function(snapshot) {
            return snapshot.id === 'rex';
          });
          next(forbidden ? new Error('Forbidden') : null);
        });
        resubscribe(function(reply) {
          expect(reply.error).to.have.property('message', 'Forbidden');
          expect(connection.agent.subscribedQueries).to.be.empty;
          expect(backend.pubsub.streamsCount).to.equal(0);
          sinon.spy(backend.db, 'queryPoll');
          clock.tick(1000);
          expect(backend.db.queryPoll).not.to.have.been.called;
          done();
        });
      });
    });

    it('delivers an op committed while fetching known results', function(done) {
      var writer = backend.connect().get('dogs', 'fido');
      connection.createSubscribeQuery('dogs', {}, null, function(error, results) {
        if (error) return done(error);
        var fido = results[0];
        fido.on('op', function() {
          expect(fido.data).to.eql({name: 'Rex'});
          done();
        });
        var getOpsBulk = backend.db.getOpsBulk;
        sinon.stub(backend.db, 'getOpsBulk').callsFake(function(collection, fromMap, toMap, options, callback) {
          backend.db.getOpsBulk.restore();
          getOpsBulk.call(backend.db, collection, fromMap, toMap, options, function(error, opsMap) {
            writer.fetch(function(error) {
              if (error) return done(error);
              writer.submitOp({p: ['name'], od: 'Fido', oi: 'Rex'}, function(error) {
                callback(error, opsMap);
              });
            });
          });
        });
        connection.close();
        backend.connect(connection);
      });
    });
  });
});
