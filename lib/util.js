var assert = require('assert');

// The ASCII unit separator!
var SEPARATOR = '\x1f';

// Rather than passing around 2 arguments (which results in extra objects in a
// bunch of cases), we're joining the collection & docname together using the
// ASCII unit separator.
exports.encodeCD = function(cName, docName) {
  return cName + SEPARATOR + docName;
};
// Returns [cName, docName]
exports.decodeCD = function(cd) {
  return cd.split(SEPARATOR);
};


// Helper for subscribe & bulkSubscribe to repack the start of a stream given
// potential operations which happened while the listeners were getting
// established
exports.packOpStream = function(v, stream, ops) {
  // If there's no ops to pack, we're good - just return the stream as-is.
  if (!ops.length) return;
  
  // Ok, so if there's anything in the stream right now, it might overlap with the
  // historical operations. We'll pump the reader and (probably!) prefix it with the
  // getOps result.
  var d;
  var queue = [];
  while (d = stream.read()) {
    queue.push(d);
  }

  // First send all the operations between v and when we called getOps
  for (var i = 0; i < ops.length; i++) {
    d = ops[i];
    assert.equal(d.v, v);
    v++;
    stream.push(d);
  }
  // Then all the ops between then and now..
  for (i = 0; i < queue.length; i++) {
    d = queue[i];
    if (d.v >= v) {
      assert.equal(d.v, v);
      v++;
      stream.push(d);
    }
  }
};