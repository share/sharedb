var json0 = require('ot-json0').type;

exports.projectSnapshot = projectSnapshot;
exports.projectOp = projectOp;
exports.isSnapshotAllowed = isSnapshotAllowed;
exports.isOpAllowed = isOpAllowed;


// Project a snapshot in place to only include specified fields
function projectSnapshot(fields, snapshot) {
  // Nothing to project if there isn't any data
  if (snapshot.data == null) return;

  // Only json0 supported right now
  if (snapshot.type !== json0.uri) {
    throw new Error('Cannot project snapshots of type ' + snapshot.type);
  }
  snapshot.data = projectData(fields, snapshot.data);
}

function projectOp(fields, op) {
  var result = {}; // default to be noop.
  if (op.v != null) result.v = op.v;
  if (op.m != null) result.m = op.m;
  if (op.src != null) result.src = op.src;
  if (op.seq != null) result.seq = op.seq;

  if (op.create) {
    // If its not a JSON op, rewrite the create to be a noop.
    if (op.create.type === json0.uri) {
      result.create = {type:op.create.type};
      if (op.create.data !== undefined) {
        result.create.data = projectData(fields, op.create.data);
      }
    }
  } else if (op.del) {
    // Deletes are safe. Just pass it through.
    result.del = true;
  } else if (op.op) {
    // This is a bit of a mess--if you're calling getOps, we don't honestly
    // know the type of the document you're getting ops from, so we might just
    // send you totally invalid operations. Ignore for now and assume the type
    // is valid
    result.op = projectEdit(fields, op.op);
  }
  return result;
}

function projectEdit(fields, op) {
  // So, we know the op is a JSON op
  var result = [];

  for (var i = 0; i < op.length; i++) {
    var c = op[i];
    var path = c.p;

    if (path.length === 0) {
      var newC = {p:[]};

      if (c.od !== undefined || c.oi !== undefined) {
        if (c.od !== undefined) {
          newC.od = projectData(fields, c.od);
        }
        if (c.oi !== undefined) {
          newC.oi = projectData(fields, c.oi);
        }
        result.push(newC);
      }
    } else {
      // The path has a first element. Just check it against the fields.
      if (fields[path[0]]) {
        result.push(c);
      }
    }
  }
  return result;
}

function isOpAllowed(knownType, fields, op) {
  if (op.create) {
    return isSnapshotAllowed(fields, op.create);
  } else if (op.op) {
    if (knownType !== json0.uri) return false;
    return isEditAllowed(fields, op.op);
  } else {
    // Noop and del are both ok.
    return true;
  }
}

// Basically, would the projected version of this data be the same as the original?
function isSnapshotAllowed(fields, snapshot) {
  if (snapshot.type !== json0.uri) {
    return false;
  }
  if (snapshot.data === undefined) {
    return true;
  }
  // Data must be an object if not undefined
  if (!snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) {
    return false;
  }
  for (var k in snapshot.data) {
    if (!fields[k]) return false;
  }
  return true;
}

function isEditAllowed(fields, op) {
  for (var i = 0; i < op.length; i++) {
    var c = op[i];
    if (c.p.length === 0) {
      return false;
    } else if (!fields[c.p[0]]) {
      return false;
    }
  }
  return true;
}

function projectData(fields, data) {
  // If data is not an object, the projected version just looks like null.
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  // Shallow copy of each field
  var result = {};
  for (var k in fields) {
    if (data[k] !== undefined) {
      result[k] = data[k];
    }
  }
  return result;
}
