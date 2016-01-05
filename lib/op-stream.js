var inherits = require('util').inherits;
var Readable = require('stream').Readable;
var util = require('./util');

// Stream of operations. Subscribe returns one of these
function OpStream() {
  Readable.call(this, {objectMode: true});

  this.id = null;
  this.backend = null;
  this.agent = null;
  this.projection = null;

  this.open = true;
}
module.exports = OpStream;

inherits(OpStream, Readable);

// This function is for notifying us that the stream is empty and needs data.
// For now, we'll just ignore the signal and assume the reader reads as fast
// as we fill it. I could add a buffer in this function, but really I don't
// think that is any better than the buffer implementation in nodejs streams
// themselves.
OpStream.prototype._read = util.doNothing;

OpStream.prototype.initProjection = function(backend, agent, projection) {
  this.backend = backend;
  this.agent = agent;
  this.projection = projection;
};

OpStream.prototype.pushOp = function(collection, id, op) {
  if (this.backend) {
    var stream = this;
    this.backend._sanitizeOp(this.agent, this.projection, collection, id, op, function(err) {
      if (!stream.open) return;
      stream.push(err ? {error: err} : op);
    });
  } else {
    // Ignore any messages after unsubscribe
    if (!this.open) return;
    this.push(op);
  }
};

OpStream.prototype.pushOps = function(collection, id, ops) {
  for (var i = 0; i < ops.length; i++) {
    this.pushOp(collection, id, ops[i]);
  }
};

OpStream.prototype.destroy = function() {
  if (!this.open) return;
  this.open = false;

  this.push(null);
  this.emit('close');
};
