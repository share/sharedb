var Backend = require('../lib/backend');
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
