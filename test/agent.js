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

    // Sends a raw message and asserts that the agent rejects it before any of
    // the bulk or query read paths reach the database adapter.
    function expectRejected(message, expectedError, done) {
      var getSnapshotBulk = sinon.spy(MemoryDb.prototype, 'getSnapshotBulk');
      var getOpsBulk = sinon.spy(MemoryDb.prototype, 'getOpsBulk');
      var query = sinon.spy(MemoryDb.prototype, 'query');
      connection.on('receive', function(request) {
        var reply = request.data;
        if (!reply || !reply.error) return;
        request.data = null; // Stop the client processing the error reply
        expect(reply.error).to.include({code: 'ERR_MESSAGE_BADLY_FORMED', message: expectedError});
        expect(getSnapshotBulk).not.to.have.been.called;
        expect(getOpsBulk).not.to.have.been.called;
        expect(query).not.to.have.been.called;
        done();
      });
      socket.send(JSON.stringify(message));
    }

    [ACTIONS.bulkFetch, ACTIONS.bulkSubscribe, ACTIONS.bulkUnsubscribe].forEach(function(action) {
      [{}, 42, null, '__proto__'].forEach(function(badId) {
        it('rejects a ' + action + ' whose ids contain ' + JSON.stringify(badId), function(done) {
          expectRejected({a: action, c: 'dogs', b: ['fido', badId]}, 'Invalid id', done);
        });
      });

      [{$gt: -1}, '1', null, -1].forEach(function(badVersion) {
        it('rejects a ' + action + ' with version ' + JSON.stringify(badVersion), function(done) {
          expectRejected({a: action, c: 'dogs', b: {fido: badVersion}}, 'Invalid version', done);
        });
      });

      it('rejects a ' + action + ' with a dangerous id in its version map', function(done) {
        // JSON.parse() is the only way to get '__proto__' as an own key, which
        // is how it arrives off the wire
        var versions = JSON.parse('{"__proto__": 0}');
        expectRejected({a: action, c: 'dogs', b: versions}, 'Invalid id', done);
      });
    });

    [ACTIONS.queryFetch, ACTIONS.querySubscribe].forEach(function(action) {
      [{}, 42, null, '__proto__'].forEach(function(badId) {
        it('rejects a ' + action + ' reconnecting with id ' + JSON.stringify(badId), function(done) {
          expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: [[badId]]}, 'Invalid id', done);
        });
      });

      [{$gt: -1}, '1', -1].forEach(function(badVersion) {
        it('rejects a ' + action + ' reconnecting with version ' + JSON.stringify(badVersion), function(done) {
          expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: [['fido', badVersion]]}, 'Invalid version', done);
        });
      });

      it('rejects a ' + action + ' whose reconnect results are not an array', function(done) {
        expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: {fido: 0}}, 'Invalid query results', done);
      });

      it('rejects a ' + action + ' whose reconnect result is not an array', function(done) {
        expectRejected({a: action, id: 1, c: 'dogs', q: {}, r: ['fido']}, 'Invalid query results', done);
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
});
