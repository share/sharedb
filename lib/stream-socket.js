var Duplex = require('stream').Duplex;
var logger = require('./logger');
var util = require('./util');

function StreamSocket() {
  this.readyState = 0;
  this.stream = new ServerStream(this);
}
module.exports = StreamSocket;

StreamSocket.prototype._open = function() {
  if (this.readyState !== 0) return;
  this.readyState = 1;
  this.onopen();
};
StreamSocket.prototype.close = function(reason) {
  if (this.readyState === 3) return;
  this.readyState = 3;
  // Signal data writing is complete. Emits the 'end' event
  this.stream.push(null);
  this.onclose(reason || 'closed');
};
StreamSocket.prototype.send = function(data) {
  // Data is an object
  this.stream.push(JSON.parse(data));
};
StreamSocket.prototype.onmessage = util.doNothing;
StreamSocket.prototype.onclose = util.doNothing;
StreamSocket.prototype.onerror = util.doNothing;
StreamSocket.prototype.onopen = util.doNothing;


function ServerStream(socket) {
  Duplex.call(this, {objectMode: true});

  this.socket = socket;

  this.on('error', function(error) {
    logger.warn('ShareDB client message stream error', error);
    socket.close('stopped');
  });

  // The server ended the writable stream. Triggered by calling stream.end()
  // in agent.close()
  this.on('finish', function() {
    socket.close('stopped');
  });
}
util.inherits(ServerStream, Duplex);

ServerStream.prototype.isServer = true;

ServerStream.prototype._read = util.doNothing;

ServerStream.prototype._write = function(chunk, encoding, callback) {
  var socket = this.socket;
  util.nextTick(function() {
    if (socket.readyState !== 1) return;
    socket.onmessage({data: JSON.stringify(chunk)});
    callback();
  });
};
