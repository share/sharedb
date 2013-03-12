exports.name = 'json-racer'; // for future ShareJS OT type support
exports.create = function() { return null; };

// Traverse to a particular element in the document. If the path decends
// Nonexistant branches of the document will be created automatically if create
// is true. If create is not true, decending into nonexistant document trees will
// result in a null return value.
//
// Returns an array with {elem, key} where elem[key] is the value that the path
// refers to, or null if create is false and the path doesn't exist.
exports._lookup = lookup; // exported for testing. Remove the _ if you want to use it for real.
function lookup(doc, path, create) {
  if (!path || !Array.isArray(path)) throw new Error('Invalid path')

  var ctx = {root:doc};
  var elem = ctx, key = 'root';

  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (elem[key] === null || elem[key] === void 0) {
      if (create) {
        // Lazily create a path element with either an object or an array.
        elem[key] = (typeof p === 'string' ? {} : []);
      } else {
        // No path to the element, so the element and key are both returned as null.
        return ctx;
      }
    } else if (typeof elem[key] !== 'object') {
      // The element must contain an array or an object. We can't decend into
      // a string or something.
      throw new Error('Invalid path - Attempted to decend into a value type');
    } else {
      // Just verify that the element type is valid for the key.
      if (typeof p === 'number') {
        if (!Array.isArray(elem[key])) {
          throw new Error('Path component is a number where the document contains an object');
        }
        // There's no good reason for this, except that I'm lazy and haven't implemented it.
        // I'm happy to accept pull requests adding this functionality - but you need tests.
        if (key < -1) throw new Error('Counting from the end of an array (key < -1) is not supported');
      } else {
        if (Array.isArray(elem[key])) {
          throw new Error('Path component is a string where the document contains an array');
        }
      }
    }

    elem = elem[key];
    key = p;
  }

  // Its a little inefficient returning multiple values like this, but JS
  // doesn't give you much choice.
  ctx.elem = elem;
  ctx.key = key;
  return ctx;
}

// Lookup a pointer to the property or nested property.
// Originally this returned the old value
exports.set = set;
function set(doc, path, value) {
  var ctx = lookup(doc, path, true);
  ctx.old = ctx.elem[ctx.key];
  ctx.elem[ctx.key] = value;
  return ctx;
}

exports.setNull = setNull;
function setNull(doc, path, value) {
  var ctx = lookup(doc, path, true);
  var old = ctx.elem[ctx.key];
  if (old === null || old === void 0) {
    ctx.elem[ctx.key] = value;
  } else {
    ctx.old = old;
  }
  return ctx;
}

exports.insert = insert;
function insert(doc, path, values) {
  var ctx = lookup(doc, path, true);
  var arr = ctx.elem;
  if (!Array.isArray(arr)) throw new Error('Cannot insert into object');

  var key = (ctx.key === -1 ? arr.length : ctx.key);
  arr.splice.apply(arr, [key, 0].concat(values));
  return ctx;
}

exports.remove = remove;
function remove(doc, path, count) {
  var ctx = lookup(doc, path, false);
  if (!ctx.elem) return ctx; // The element to remove doesn't exist anyway.

  var key = ctx.key;
  if (typeof key === 'number') {
    // Splicing out of an array.
    if (typeof count !== 'number') count = 1;
    
    var arr = ctx.elem;
    key = (key === -1 ? arr.length - count : key);
    ctx.old = arr.splice(key, count)
  } else {
    ctx.old = ctx.elem[key];
    delete ctx.elem[key];
  }

  return ctx;
}

function move(doc, path, to, count) {
  var ctx = lookup(doc, path, false);
  if (!ctx.elem) return ctx; // A move inside a nonexistant object is a no-op.

  var key = ctx.key;
  if (typeof key === 'number') {
    // Splice out count items from one array into another array.
    if (typeof count !== 'number') {
      count = 1;
    } else if (count <= 0) {
      throw new Error('Invalid count');
    }
 
    // Remove from old location
    var arr = ctx.elem;

    var idx = (key === -1 ? arr.length - count : key);
    var values = ctx.old = arr.splice(idx, count);

    // Insert in new location
    arr.splice.apply(arr, [to, 0].concat(values));

    ctx.old = values;
  } else {
    ctx.old = ctx.elem[to] = ctx.elem[key];
    delete ctx.elem[key];
  }

  return ctx;
}

function inc(doc, path, by) {
  var ctx = lookup(doc, path, true);

  var old = ctx.old = ctx.elem[key]

  if (typeof by !== 'number') by = 1;
  if (old === null || old === void 0) {
    ctx.elem[key] = by;
  } else if (typeof old === 'number') {
    ctx.elem[key] += by;
  } else {
    throw new Error('Cannot increment a value of type ' + typeof old);
  }
  return ctx;
}

function get(doc, path) {
  var ctx = lookup(doc, path, false);
  if (ctx.elem) ctx.old = ctx.elem[ctx.key];
  return ctx;
}

function applyComponent(doc, c) {
  switch (c.op) {
    case 'set':     return set(doc, c.p, c.val);
    case 'setNull': return setNull(doc, c.p, c.val);
    case 'ins':     return insert(doc, c.p, c.vals || [c.val]);
    case 'rm':      return remove(doc, c.p, c.count);
    case 'mv':      return move(doc, c.p, c.to, c.count);
    case 'inc':     return inc(doc, c.p, c.by);
    default:
      throw new Error('invalid op component type ' + c.op);
  }
}

exports.apply = apply;
function apply(doc, op) {
  if (!Array.isArray(op)) return applyComponent(doc, op).root;

  for (var i = 0; i < op.length; i++) {
    doc = applyComponent(doc, op[i]).root;
  }

  return doc;
}

