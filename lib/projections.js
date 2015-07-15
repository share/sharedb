// This has some helper methods for implementing projections. This should
// probably be moved into the implementation of the type itself

var json0 = require('ot-json0').type;

exports.projectSnapshot = projectSnapshot;
exports.projectOpData = projectOpData;
exports.isSnapshotAllowed = isSnapshotAllowed;
exports.isOpDataAllowed = isOpDataAllowed;


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

function projectOpData(fields, opData) {
  var result = {}; // default to be noop.
  if (opData.v != null) result.v = opData.v;
  if (opData.m != null) result.m = opData.m;
  if (opData.src != null) result.src = opData.src;
  if (opData.seq != null) result.seq = opData.seq;

  if (opData.create) {
    // If its not a JSON op, rewrite the create to be a noop.
    if (opData.create.type === json0.uri) {
      result.create = {type:opData.create.type};
      if (opData.create.data !== undefined) {
        result.create.data = projectData(fields, opData.create.data);
      }
    }
  } else if (opData.del) {
    // Deletes are safe. Just pass it through.
    result.del = true;
  } else if (opData.op) {
    // This is a bit of a mess--if you're calling getOps, we don't honestly
    // know the type of the document you're getting ops from, so we might just
    // send you totally invalid operations. Ignore for now and assume the type
    // is valid
    result.op = projectOp(fields, opData.op);
  }
  return result;
}

function projectOp(fields, op) {
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

function isOpDataAllowed(knownType, fields, opData) {
  if (opData.create) {
    return isSnapshotAllowed(fields, opData.create);
  } else if (opData.op) {
    if (knownType !== json0.uri) return false;
    return isOpAllowed(fields, opData.op);
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

function isOpAllowed(fields, op) {
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
