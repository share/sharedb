var json0 = require('ot-json0').type;
var ShareDBError = require('./error');
var util = require('./util');

var ERROR_CODE = ShareDBError.CODES;

exports.projectSnapshot = projectSnapshot;
exports.projectSnapshots = projectSnapshots;
exports.projectOp = projectOp;
exports.isSnapshotAllowed = isSnapshotAllowed;
exports.isOpAllowed = isOpAllowed;
exports.hasSubFields = hasSubFields;
exports.validateFields = validateFields;

// Projection fields are given as a flat object, where a key can be a
// top-level field (`{name: true}`) or a dot-separated path to a sub-field
// (`{'address.city': true}`). Internally, they're turned into a tree, where
// `true` means "include everything at and below this path", and an object
// means "only include the listed children".
//
// Sub-field paths only descend through objects. If a value on the way to a
// projected sub-field isn't an object (eg it's an array or a string), it's
// left out of the projection entirely.

// Throws if the fields can't be used as a projection. Keys without a dot are
// top-level fields, and keep their existing rules: any key is allowed, since
// it's just a key on the (always object) root. Keys with a dot are sub-field
// paths, which must:
//  - not have empty segments (eg 'address.' or 'address..city')
//  - not have numeric segments (eg 'tags.0'), since json0 uses numbers for
//    array indexes, and sub-field paths don't go through arrays
//  - not overlap with another path (eg {owner: true, 'owner.name': true}),
//    which MongoDB 4.4+ rejects as a path collision
function validateFields(fields) {
  var tree = Object.create(null);
  for (var key in fields) {
    if (fields[key] !== true) {
      throw new Error('Invalid field ' + key + ' - fields must be {somekey: true} or {\'some.subfield\': true}.');
    }
    var segments = key.split('.');
    if (segments.length > 1) {
      for (var i = 0; i < segments.length; i++) {
        if (segments[i] === '') {
          throw new Error('Invalid field ' + key + ' - sub-field paths must not have empty segments.');
        }
        if (/^[0-9]+$/.test(segments[i])) {
          throw new Error('Invalid field ' + key + ' - sub-field paths must not have numeric segments.');
        }
      }
    }
    var node = tree;
    for (var j = 0; j < segments.length; j++) {
      var segment = segments[j];
      var isLast = j === segments.length - 1;
      if (node[segment] === true || (isLast && node[segment])) {
        throw new Error('Invalid field ' + key + ' - fields must not overlap with other fields.');
      }
      if (isLast) {
        node[segment] = true;
      } else {
        if (!node[segment]) node[segment] = Object.create(null);
        node = node[segment];
      }
    }
  }
}

// Builds the field tree. This assumes the fields have passed
// `validateFields()`, so no path goes through another projected path.
function fieldTree(fields) {
  var tree = Object.create(null);
  for (var key in fields) {
    if (!util.hasOwn(fields, key) || !fields[key]) continue;
    var segments = key.split('.');
    var node = tree;
    for (var i = 0; i < segments.length - 1; i++) {
      var segment = segments[i];
      if (!node[segment]) node[segment] = Object.create(null);
      node = node[segment];
    }
    node[segments[segments.length - 1]] = true;
  }
  return tree;
}

function hasSubFields(fields) {
  for (var key in fields) {
    if (util.hasOwn(fields, key) && key.indexOf('.') !== -1) return true;
  }
  return false;
}

// Project a snapshot in place to only include specified fields
function projectSnapshot(fields, snapshot) {
  projectSnapshotWithTree(fieldTree(fields), snapshot);
}

function projectSnapshotWithTree(tree, snapshot) {
  // Only json0 supported right now
  if (snapshot.type && snapshot.type !== json0.uri) {
    throw new Error(ERROR_CODE.ERR_TYPE_CANNOT_BE_PROJECTED, 'Cannot project snapshots of type ' + snapshot.type);
  }
  snapshot.data = projectData(tree, snapshot.data);
}

function projectSnapshots(fields, snapshots) {
  var tree = fieldTree(fields);
  for (var i = 0; i < snapshots.length; i++) {
    var snapshot = snapshots[i];
    projectSnapshotWithTree(tree, snapshot);
  }
}

function projectOp(fields, op) {
  var tree = fieldTree(fields);
  if (op.create) {
    projectSnapshotWithTree(tree, op.create);
  }
  if ('op' in op) {
    op.op = projectEdit(tree, op.op);
  }
}

function projectEdit(tree, op) {
  // So, we know the op is a JSON op
  var result = [];

  for (var i = 0; i < op.length; i++) {
    var c = op[i];
    var path = c.p;

    if (path.length === 0) {
      var newC = {p: []};

      if (c.od !== undefined || c.oi !== undefined) {
        if (c.od !== undefined) {
          newC.od = projectData(tree, c.od);
        }
        if (c.oi !== undefined) {
          newC.oi = projectData(tree, c.oi);
        }
        result.push(newC);
      }
      continue;
    }

    var node = projectedNode(tree, targetPath(c));
    if (node === true) {
      // The component only touches projected data
      result.push(c);
    } else if (node) {
      // The component replaces an object that contains projected sub-fields,
      // so keep the projected parts of the inserted and removed values
      var projected = projectObjectReplace(node, c);
      if (projected) result.push(projected);
    }
  }
  return result;
}

// The path to the value that a json0 component changes. For string inserts
// and deletes, the last element of `p` is an offset into the string.
function targetPath(c) {
  if (c.si !== undefined || c.sd !== undefined) return c.p.slice(0, -1);
  return c.p;
}

// Walks a path through the field tree. Returns:
//  - `true` if the path is at or below a projected field
//  - a subtree if the path is an object that contains projected sub-fields
//  - `null` if the path is not projected at all
function projectedNode(tree, path) {
  var node = tree;
  for (var i = 0; i < path.length; i++) {
    if (node === true) return true;
    var key = path[i];
    if (typeof key !== 'string' && typeof key !== 'number') return null;
    if (!util.hasOwn(node, key)) return null;
    node = node[key];
  }
  return node;
}

function projectObjectReplace(node, c) {
  // Only object inserts and deletes can replace an object. Anything else
  // (eg a number add or string edit) applies to a value which isn't an
  // object, and so isn't in the projection.
  if (c.oi === undefined && c.od === undefined) return null;
  var newC = {p: c.p};
  if (isPlainObject(c.oi)) {
    newC.oi = projectData(node, c.oi);
    if (isPlainObject(c.od)) newC.od = projectData(node, c.od);
  } else {
    // The new value isn't an object, so it has no projected sub-fields, and
    // the parent drops out of the projection. json0 doesn't require `od`, so
    // we can't rely on it to know what the client has. Always send a delete,
    // which json0 is happy to apply to a key the client doesn't have.
    newC.od = isPlainObject(c.od) ? projectData(node, c.od) : {};
  }
  return newC;
}

function isOpAllowed(knownType, fields, op) {
  if (op.create) {
    return isSnapshotAllowed(fields, op.create);
  }
  if ('op' in op) {
    if (knownType && knownType !== json0.uri) return false;
    return isEditAllowed(fieldTree(fields), op.op);
  }
  // Noop and del are both ok.
  return true;
}

// Basically, would the projected version of this data be the same as the original?
function isSnapshotAllowed(fields, snapshot) {
  if (snapshot.type && snapshot.type !== json0.uri) {
    return false;
  }
  if (snapshot.data == null) {
    return true;
  }
  return isDataAllowed(fieldTree(fields), snapshot.data);
}

function isDataAllowed(node, data) {
  if (node === true) return true;
  // Data must be an object if not null
  if (!isPlainObject(data)) return false;
  for (var k in data) {
    if (!util.hasOwn(node, k)) return false;
    if (!isDataAllowed(node[k], data[k])) return false;
  }
  return true;
}

function isEditAllowed(tree, op) {
  if (!Array.isArray(op)) return false;
  for (var i = 0; i < op.length; i++) {
    var c = op[i];
    var path = c && c.p;
    if (!Array.isArray(path)) return false;
    // Only allow edits at or below a projected field. Replacing an object
    // that holds projected sub-fields could also overwrite fields that the
    // client can't see, so that isn't allowed.
    if (projectedNode(tree, targetPath(c)) !== true) return false;
  }
  return true;
}

function isPlainObject(data) {
  return data != null && typeof data === 'object' && !Array.isArray(data);
}

function projectData(node, data) {
  // Return back null or undefined
  if (data == null) {
    return data;
  }
  // If data is not an object, the projected version just looks like null.
  if (!isPlainObject(data)) {
    return null;
  }
  var result = {};
  for (var key in node) {
    if (!util.hasOwn(data, key)) continue;
    var child = node[key];
    if (child === true) {
      // Shallow copy of the field
      result[key] = data[key];
    } else if (isPlainObject(data[key])) {
      result[key] = projectData(child, data[key]);
    }
  }
  return result;
}
