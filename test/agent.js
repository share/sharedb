var Backend = require('../lib/backend');
var MemoryDb = require('../lib/db/memory');
var logger = require('../lib/logger');
var sinon = require('sinon');
var StreamSocket = require('../lib/stream-socket');
var expect = require('chai').expect;
var ACTIONS = require('../lib/message-actions').ACTIONS;
var Connection = require('../lib/client/connection');
var protocol = require('../lib/protocol');
var LegacyConnection = require('sharedb-legacy/lib/client').Connection;

describe('Agent', function() {
  var backend;

  beforeEach(function() {
    backend = new Backend();
  });

  afterEach(function(done) {
    backend.close(done);
  });

  describe('request validation', function() {
    var socket;
    var connection;

    beforeEach(function(done) {
      socket = new StreamSocket();
      backend.listen(socket.stream);
      connection = new Connection(socket);
      socket._open();
      connection.once('connected', function() {
        done();
      });
    });

    function expectRejected(message, expectedError, done) {
      var dbReads = ['getSnapshot', 'getSnapshotBulk', 'getOps', 'getOpsBulk', 'query'].map(function(method) {
        return sinon.spy(MemoryDb.prototype, method);
      });
      connection.on('receive', function(request) {
        var reply = request.data;
        if (!reply || !reply.error) return;
        request.data = null;
        expect(reply.error).to.include({code: 'ERR_MESSAGE_BADLY_FORMED', message: expectedError});
        dbReads.forEach(function(dbRead) {
          expect(dbRead).not.to.have.been.called;
        });
        done();
      });
      socket.send(JSON.stringify(message));
    }

    var unconvertible = {toString: 1};
    var badIds = [unconvertible, 42, null, '__proto__'];
    var badVersions = [unconvertible, '1', -1];

    [ACTIONS.fetch, ACTIONS.subscribe, ACTIONS.snapshotFetch].forEach(function(action) {
      badVersions.forEach(function(badVersion) {
        it('rejects a ' + action + ' with version ' + JSON.stringify(badVersion), function(done) {
          expectRejected({a: action, c: 'dogs', d: 'fido', v: badVersion}, 'Invalid version', done);
        });
      });
    });

    [unconvertible, '1'].forEach(function(badTimestamp) {
      it('rejects a snapshot fetch with timestamp ' + JSON.stringify(badTimestamp), function(done) {
        var message = {a: ACTIONS.snapshotFetchByTimestamp, c: 'dogs', d: 'fido', ts: badTimestamp};
        expectRejected(message, 'Invalid timestamp', done);
      });
    });

    [ACTIONS.bulkFetch, ACTIONS.bulkSubscribe, ACTIONS.bulkUnsubscribe].forEach(function(action) {
      it('rejects a ' + action + ' without bulk data', function(done) {
        expectRejected({a: action, c: 'dogs', b: null}, 'Invalid bulk subscribe data', done);
      });

      badIds.forEach(function(badId) {
        it('rejects a ' + action + ' with id ' + JSON.stringify(badId), function(done) {
          expectRejected({a: action, c: 'dogs', b: ['fido', badId]}, 'Invalid id', done);
        });
      });

      badVersions.forEach(function(badVersion) {
        it('rejects a ' + action + ' with version ' + JSON.stringify(badVersion), function(done) {
          expectRejected({a: action, c: 'dogs', b: {fido: badVersion}}, 'Invalid version', done);
        });
      });

      it('rejects a ' + action + ' with a __proto__ key in its version map', function(done) {
        expectRejected({a: action, c: 'dogs', b: JSON.parse('{"__proto__": 0}')}, 'Invalid id', done);
      });
    });

    [ACTIONS.queryFetch, ACTIONS.querySubscribe].forEach(function(action) {
      [unconvertible, ['dogs'], '__proto__'].forEach(function(badCollection) {
        it('rejects a ' + action + ' with collection ' + JSON.stringify(badCollection), function(done) {
          expectRejected({a: action, id: 1, c: badCollection, q: {}}, 'Invalid collection', done);
        });
      });

      badIds.forEach(function(badId) {
        it('rejects a ' + action + ' with result id ' + JSON.stringify(badId), function(done) {
          expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: [[badId]]}, 'Invalid id', done);
        });
      });

      badVersions.forEach(function(badVersion) {
        it('rejects a ' + action + ' with result version ' + JSON.stringify(badVersion), function(done) {
          expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: [['fido', badVersion]]}, 'Invalid version', done);
        });
      });

      [{fido: 0}, ['fido']].forEach(function(badResults) {
        it('rejects a ' + action + ' with results ' + JSON.stringify(badResults), function(done) {
          expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: badResults}, 'Invalid query results', done);
        });
      });
    });

    it('accepts a query unsubscribe without a collection', function(done) {
      connection.on('receive', function(request) {
        var reply = request.data;
        if (!reply || reply.a !== ACTIONS.queryUnsubscribe) return;
        request.data = null;
        expect(reply).not.to.have.property('error');
        done();
      });
      socket.send(JSON.stringify({a: ACTIONS.queryUnsubscribe, id: 1}));
    });

    [ACTIONS.presenceSubscribe, ACTIONS.presenceUnsubscribe].forEach(function(action) {
      [unconvertible, '1'].forEach(function(badSeq) {
        it('rejects a ' + action + ' with seq ' + JSON.stringify(badSeq), function(done) {
          expectRejected({a: action, ch: 'dogs.fido', seq: badSeq}, 'Invalid seq', done);
        });
      });
    });

    badVersions.forEach(function(badVersion) {
      it('rejects presence with presence version ' + JSON.stringify(badVersion), function(done) {
        var message = {a: ACTIONS.presence, ch: 'dogs.fido', id: 'rex', p: null, pv: badVersion};
        expectRejected(message, 'Invalid presence version', done);
      });
    });

    [unconvertible, true].forEach(function(badProtocol) {
      it('rejects a handshake with protocol ' + JSON.stringify(badProtocol), function(done) {
        expectRejected({a: ACTIONS.handshake, protocol: badProtocol, protocolMinor: 2}, 'Invalid protocol', done);
      });

      it('rejects a handshake with minor protocol ' + JSON.stringify(badProtocol), function(done) {
        expectRejected({a: ACTIONS.handshake, protocol: 1, protocolMinor: badProtocol}, 'Invalid protocol', done);
      });
    });
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
});
