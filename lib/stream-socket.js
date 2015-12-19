var util = require('./util');

function StreamSocket(stream) {
  this.stream = stream;
  this.readyState = 0;

  var socket = this;
  stream._read = util.doNothing;
  stream._write = function(chunk, encoding, callback) {
    process.nextTick(function() {
      socket.onmessage({
        type: 'message',
        data: chunk
      });
      callback();
    });
  };
}
module.exports = StreamSocket;

StreamSocket.prototype._open = function() {
  this.readyState = 1;
  this.onopen();
};
StreamSocket.prototype.close = function() {
  if (this.readyState === 3) return;
  this.readyState = 3;
  this.stream.end();
  this.stream.emit('close');
  this.stream.emit('end');
  this.onclose();
};
StreamSocket.prototype.send = function(data) {
  // Data is a string of JSON
  var stream = this.stream;
  process.nextTick(function() {
    stream.push(data);
  });
};
StreamSocket.prototype.onmessage = util.doNothing;
StreamSocket.prototype.onclose = util.doNothing;
StreamSocket.prototype.onerror = util.doNothing;
StreamSocket.prototype.onopen = util.doNothing;
StreamSocket.prototype.onconnecting = util.doNothing;
