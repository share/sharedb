var assert = require('assert');
var inherits = require('util').inherits;
var Readable = require('stream').Readable;

function doNothing() {};

// The ASCII unit separator!
var SEPARATOR = '\x1f';

// Rather than passing around 2 arguments (which results in extra objects in a
// bunch of cases), we're joining the collection & docname together using the
// ASCII unit separator.
//
// NOTE THAT THIS IS A BAD IDEA. I thought it would be faster, but jsperf says otherwise:
// http://jsperf.com/2-level-vs-flattened-map
// Its slower in all tested browsers, too. I'll probably rip this whole joined keys model out.
exports.encodeCD = function(cName, docName) {
  return cName + SEPARATOR + docName;
};
// Returns [cName, docName]
exports.decodeCD = function(cd) {
  return cd.split(SEPARATOR);
};

exports.hasKeys = function(object) {
  for (var key in object) return true;
  return false;
};

exports.OpStream = OpStream;
// Stream of operations. Subscribe returns one of these. Passing a version makes the stream not emit
// any operations that are earlier than the specified version. This will be updated as the stream
// emits ops.
function OpStream(v) {
  Readable.call(this, {objectMode:true});

  // Version number of the next op we expect to see. Be careful - this is modified & used in a few
  // places.
  this._v = v;
  this.id = null;

  this.open = true;
}
inherits(OpStream, Readable);

// This function is for notifying us that the stream is empty and needs data.
// For now, we'll just ignore the signal and assume the reader reads as fast
// as we fill it. I could add a buffer in this function, but really I don't
// think that is any better than the buffer implementation in nodejs streams
// themselves.
OpStream.prototype._read = doNothing;

OpStream.prototype.pushOp = function(data) {
  // We shouldn't get messages after unsubscribe, but it's happened.
  if (!this.open) return;

  if (this._v && data.v) {
    if (data.v >= this._v) {
      // data.v will usually be == stream._v, except if we're subscribing & buffering ops.
      this.push(data);
      this._v = data.v + 1;
    }
  } else {
    this.push(data);
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

  // Ok, so if there's anything in the stream right now, it might overlap with the
  // historical operations. We'll pump the reader and (probably!) prefix it with the
  // getOps result.
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

  this._v = v;
};
