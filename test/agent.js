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
var async = require('async');
var types = require('../lib/types');
var presenceTestType = require('./client/presence/presence-test-type');
types.register(presenceTestType.type);

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

    [unconvertible, ['dogs'], '__proto__'].forEach(function(badCollection) {
      it('rejects doc presence with collection ' + JSON.stringify(badCollection), function(done) {
        var message = {a: ACTIONS.presence, ch: 'dogs.fido', c: badCollection, d: 'fido', id: 'rex', pv: 0, v: 0};
        expectRejected(message, 'Invalid collection', done);
      });
    });

    [unconvertible, '__proto__'].forEach(function(badChannel) {
      it('rejects doc presence with channel ' + JSON.stringify(badChannel), function(done) {
        var message = {a: ACTIONS.presence, ch: badChannel, c: 'dogs', d: 'fido', id: 'rex', pv: 0, v: 0};
        expectRejected(message, 'Invalid presence channel', done);
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

  describe('cleanup', function() {
    var connection;

    beforeEach(function(done) {
      backend.close(function(error) {
        if (error) return done(error);
        backend = new Backend({presence: true});
        connection = backend.connect();
        connection.get('books', 'northern-lights').create('North Lights', presenceTestType.type.name, done);
      });
    });

    function closeConnection(callback) {
      connection.agent.stream.once('end', callback);
      connection.close();
    }

    function opensStreams(count, step) {
      return function(next) {
        var streamsCount = backend.pubsub.streamsCount;
        step(function(error) {
          if (error) return next(error);
          expect(backend.pubsub.streamsCount - streamsCount).to.equal(count);
          next();
        });
      };
    }

    it('destroys a stream that is missing from its subscription map', function(done) {
      connection.get('dogs', 'fido').subscribe(function(error) {
        if (error) return done(error);
        delete connection.agent.subscribedDocs.dogs;
        closeConnection(function() {
          expect(backend.pubsub.streamsCount).to.equal(0);
          done();
        });
      });
    });

    it('stops tracking streams once they close', function(done) {
      var doc = connection.get('dogs', 'fido');
      var presence = connection.getDocPresence('books', 'northern-lights');
      var localPresence = presence.create('presence-1');
      async.series([
        doc.subscribe.bind(doc),
        doc.unsubscribe.bind(doc),
        presence.subscribe.bind(presence),
        presence.unsubscribe.bind(presence),
        localPresence.submit.bind(localPresence, {index: 0}),
        localPresence.destroy.bind(localPresence),
        function(next) {
          expect(connection.agent._streams).to.be.empty;
          next();
        }
      ], done);
    });

    it('empties its stream maps as soon as the connection closes', function(done) {
      var presence = connection.getDocPresence('books', 'northern-lights');
      var agent = connection.agent;
      async.series([
        function(next) {
          connection.get('dogs', 'fido').subscribe(next);
        },
        presence.subscribe.bind(presence),
        function(next) {
          presence.create('presence-1').submit({index: 0}, next);
        },
        function(next) {
          agent.stream.once('end', function() {
            expect(agent.subscribedDocs).to.be.empty;
            expect(agent.subscribedPresences).to.be.empty;
            expect(agent.latestDocVersionStreams).to.be.empty;
            next();
          });
          connection.close();
        }
      ], done);
    });

    it('does not track a stream that closed before reaching the agent', function(done) {
      backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(context, next) {
        backend.pubsub.close();
        next();
      });
      connection.get('dogs', 'fido').subscribe(function(error) {
        if (error) return done(error);
        expect(connection.agent._streams).to.be.empty;
        done();
      });
    });

    it('destroys every pub/sub stream when the connection closes', function(done) {
      var presence = connection.getDocPresence('books', 'northern-lights');
      async.series([
        opensStreams(1, function(next) {
          connection.get('dogs', 'fido').subscribe(next);
        }),
        opensStreams(2, function(next) {
          connection.startBulk();
          connection.get('dogs', 'rex').subscribe();
          connection.get('dogs', 'spot').subscribe(next);
          connection.endBulk();
        }),
        opensStreams(1, presence.subscribe.bind(presence)),
        opensStreams(1, function(next) {
          presence.create('presence-1').submit({index: 0}, next);
        }),
        opensStreams(1, function(next) {
          connection.createSubscribeQuery('dogs', {}, null, next);
        }),
        closeConnection,
        function(next) {
          expect(backend.pubsub.streamsCount).to.equal(0);
          next();
        }
      ], done);
    });
  });
});
