var assert = require('assert');
var inherits = require('util').inherits;
var Readable = require('stream').Readable;
var util = require('./util');

// Stream of operations. Subscribe returns one of these. Passing a version
// makes the stream not emit any operations that are earlier than the
// specified version. This will be updated as the stream emits ops.
function OpStream() {
  Readable.call(this, {objectMode: true});

  this.id = null;
  this.share = null;
  this.agent = null;
  this.projection = null;
  // Version number of the next op we expect to see
  this.v = null;

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

OpStream.prototype.initDocSubscribe = function(share, agent, projection, version) {
  this.share = share;
  this.agent = agent;
  this.projection = projection;
  this.v = version;
};

OpStream.prototype.pushOp = function(op) {
  // We shouldn't get messages after unsubscribe, but it's happened
  if (!this.open) return;

  if (this.v && op.v) {
    // op.v will usually be == stream.v, except if we're subscribing &
    // buffering ops
    if (op.v >= this.v) {
      this.v = op.v + 1;
    } else {
      return;
    }
  }

  if (this.share) {
    var stream = this;
    this.share._sanitizeOp(this.agent, this.projection, op.collection, op.id, op, function(err, op) {
      stream.push(err ? {error: err} : op);
    });
  } else {
    this.push(op);
  }
};

OpStream.prototype.destroy = function() {
  if (!this.open) return;
  this.open = false;

  this.push(null);
  this.emit('close');
};

// Helper for subscribe & bulkSubscribe to repack the start of a stream given
// potential operations which happened while the listeners were getting
// established
OpStream.prototype.pack = function(v, ops) {
  // If there's no ops to pack, we're good - just return the stream as-is.
  if (!ops.length) return;

  // Ok, so if there's anything in the stream right now, it might overlap with
  // the historical operations. We'll pump the reader and (probably!) prefix
  // it with the getOps result.
  var d;
  var queue = [];
  while (d = this.read()) {
    queue.push(d);
  }

  // First send all the operations between v and when we called getOps
  for (var i = 0; i < ops.length; i++) {
    d = ops[i];
    assert.equal(d.v, v);
    v++;
    // console.log("stream push from preloaded ops", d);
    this.push(d);
  }
  // Then all the ops between then and now..
  for (i = 0; i < queue.length; i++) {
    d = queue[i];
    if (d.v >= v) {
      assert.equal(d.v, v);
      v++;
      // console.log("stream push from early stream", d);
      this.push(d);
    }
  }
  // if (queue.length || ops.length) console.log("Queue " + queue.length + " ops " + ops.length);

  this.v = v;
};
