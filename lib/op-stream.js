var Readable = require('stream').Readable;
var util = require('./util');

// Stream of operations. Subscribe returns one of these
function OpStream() {
  Readable.call(this, {objectMode: true});
  this.id = null;
  this.open = true;
}
module.exports = OpStream;

util.inherits(OpStream, Readable);

// This function is for notifying us that the stream is empty and needs data.
// For now, we'll just ignore the signal and assume the reader reads as fast
// as we fill it. I could add a buffer in this function, but really I don't
// think that is any better than the buffer implementation in nodejs streams
// themselves.
OpStream.prototype._read = util.doNothing;

OpStream.prototype.pushData = function(data) {
  // Ignore any messages after unsubscribe
  if (!this.open) return;
  // This data gets consumed in Agent#_subscribeToStream
  this.push(data);
};

OpStream.prototype.destroy = function() {
  // Only close stream once
  if (!this.open) return;
  this.open = false;

  this.push(null);
  this.emit('close');
};
