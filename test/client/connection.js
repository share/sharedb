var sinon = require('sinon');
var assert = require('assert');
var Connection = require('../../lib/client').Connection;
var Doc = require('../../lib/client').Doc;

describe('Connection', function() {
  var socket = {
    readyState: 0,
    send: function() {},
    close: function() {
      this.readyState = 3;
      this.onclose();
    },
    canSendWhileConnecting: true
  };

  beforeEach(function() {
    socket.readyState = 0;
    this.connection = new Connection(socket);
  });

  describe('state and socket', function() {
    it('is set to disconnected', function() {
      socket.readyState = 3;
      var connection = new Connection(socket);
      assert.equal(connection.state, 'disconnected');
    });

    it('is set to connecting', function() {
      socket.readyState = 1;
      var connection = new Connection(socket);
      assert.equal(connection.state, 'connecting');
    });
  });

  describe('socket onopen', function() {
    beforeEach(function() {
      socket.readyState = 3;
      this.connection = new Connection(socket);
    });

    it('sets connecting state', function() {
      assert.equal(this.connection.state, 'disconnected');
      socket.onopen();
      assert.equal(this.connection.state, 'connecting');
    });

    it('sets canSend', function() {
      assert(!this.connection.canSend);
      socket.onopen();
      assert(this.connection.canSend);
    });
  });

  describe('socket onclose', function() {
    it('sets disconnected state', function() {
      assert.equal(this.connection.state, 'connecting');
      socket.close();
      assert.equal(this.connection.state, 'disconnected');
    });

    it('sets canSend', function() {
      assert(this.connection.canSend);
      socket.close();
      assert(!this.connection.canSend);
    });
  });

  describe('socket onmessage', function() {
    it('calls handle message', function() {
      var handleMessage = sinon.spy(this.connection, 'handleMessage');
      socket.onmessage({data: {key: 'value'}});
      sinon.assert.calledWith(handleMessage, {
        key: 'value'
      });
    });

    it('pushes message buffer', function() {
      assert(this.connection.messageBuffer.length === 0);
      socket.onmessage({data: {key: 'value'}});
      assert(this.connection.messageBuffer.length === 1);
    });
  });

  describe('#disconnect', function() {
    it('calls socket.close()', function() {
      var close;
      close = sinon.spy(socket, 'close');
      this.connection.disconnect();
      sinon.assert.calledOnce(close);
      close.reset();
    });

    it('emits disconnected', function() {
      var emit = sinon.spy(this.connection, 'emit');
      this.connection.disconnect();
      sinon.assert.calledWith(emit, 'disconnected');
      emit.reset();
    });
  });
});
