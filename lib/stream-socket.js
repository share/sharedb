var Duplex = require('stream').Duplex;
var util = require('./util');

function StreamSocket() {
  this.stream = new Duplex({objectMode: true});
  this.readyState = 0;

  var socket = this;
  this.stream._read = util.doNothing;
  this.stream._write = function(chunk, encoding, callback) {
    process.nextTick(function() {
      if (socket.readyState !== 1) return;
      socket.onmessage({data: chunk});
      callback();
    });
  };
  // The server ended the writable stream. Triggered by calling stream.end()
  // in agent.close()
  this.stream.once('finish', function() {
    socket.close('stopped');
  });
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
  // Data is a string of JSON
  this.stream.push(data);
};
StreamSocket.prototype.onmessage = util.doNothing;
StreamSocket.prototype.onclose = util.doNothing;
StreamSocket.prototype.onerror = util.doNothing;
StreamSocket.prototype.onopen = util.doNothing;
