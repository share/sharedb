var json0 = require('ot-json0').type;

exports.projectSnapshot = projectSnapshot;
exports.projectSnapshots = projectSnapshots;
exports.projectOp = projectOp;
exports.isSnapshotAllowed = isSnapshotAllowed;
exports.isOpAllowed = isOpAllowed;


// Project a snapshot in place to only include specified fields
function projectSnapshot(fields, snapshot) {
  // Only json0 supported right now
  if (snapshot.type && snapshot.type !== json0.uri) {
    throw new Error(4023, 'Cannot project snapshots of type ' + snapshot.type);
  }
  snapshot.data = projectData(fields, snapshot.data);
}

function projectSnapshots(fields, snapshots) {
  for (var i = 0; i < snapshots.length; i++) {
    var snapshot = snapshots[i];
    projectSnapshot(fields, snapshot);
  }
}

function projectOp(fields, op) {
  if (op.create) {
    projectSnapshot(fields, op.create);
  }
  if (op.op) {
    op.op = projectEdit(fields, op.op);
  }
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
  }
  if (op.op) {
    if (knownType && knownType !== json0.uri) return false;
    return isEditAllowed(fields, op.op);
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
  // Data must be an object if not null
  if (typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) {
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
  // Return back null or undefined
  if (data == null) {
    return data;
  }
  // If data is not an object, the projected version just looks like null.
  if (typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  // Shallow copy of each field
  var result = {};
  for (var key in fields) {
    if (data.hasOwnProperty(key)) {
      result[key] = data[key];
    }
  }
  return result;
}
