// This has some helper methods for implementing projections.

var json0 = require('ot-json0').type;

function projectSnapshot(fields, data) {
  // If data is not an object, the projected version just looks like null.
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return null;

  var result = {};

  // Shallow copy of each field
  for (var k in fields) {
    if (data[k] !== undefined) {
      result[k] = data[k];
    }
  }

  return result;
}

exports.projectSnapshot = function(type, fields, data) {
  // Only json0 supported right now.
  if (type !== json0.uri)
    throw Error("Cannot project snapshots of type " + type);

  return projectSnapshot(fields, data);
};

// Basically, would the projected version of this data be the same as the original?
function isSnapshotAllowed(fields, data) {
  // Data must be an object.
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return false;

  for (var k in data) {
    if (!fields[k]) return false;
  }

  return true;
}

exports.isSnapshotAllowed = function(type, fields, data) {
  if (type !== json0.uri)
    throw Error("Cannot project snapshots of type " + type);

  return isSnapshotAllowed(fields, data);
};

function projectOp(fields, op) {
  // So, we know the op is a JSON op
  var result = [];

  for (var i = 0; i < op.length; i++) {
    var c = op[i];

    var path = c.p;

    if (path.length === 0) {
      var newC = {p:[]};

      if (c.od !== undefined || c.oi !== undefined) {
        if (c.od !== undefined)
          newC.od = projectSnapshot(fields, c.od);

        if (c.oi !== undefined)
          newC.oi = projectSnapshot(fields, c.oi);

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

exports.projectOpData = function(knownType, fields, opData) {
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
        result.create.data = projectSnapshot(fields, opData.create.data);
      }
    }
  } else if (opData.del) {
    // Deletes are safe. Just pass it through.
    result.del = true;
  } else if (opData.op) {
    // This is a bit of a mess - if you're calling getOps, we don't honestly know the type of the
    // document you're getting ops from, so we might just send you totally invalid operations.
    if (knownType && knownType !== json0.uri)
      throw Error("Cannot project ops of type " + knownType);

    result.op = projectOp(fields, opData.op);
  }

  return result;
};

function isOpAllowed(fields, op) {
  for (var i = 0; i < op.length; i++) {
    var c = op[i];

    if (c.p.length === 0)
      return false;
    else if (!fields[c.p[0]])
      return false;
  }
  return true;
}

exports.isOpDataAllowed = function(knownType, fields, opData) {
  if (opData.create) {
    if (opData.create.type !== json0.uri)
      return false;
    var data = opData.create.data;
    if (data !== undefined && !isSnapshotAllowed(fields, data))
      return false;

    return true;
  } else if (opData.op) {
    if (knownType !== json0.uri) return false;
    return isOpAllowed(fields, opData.op);
  } else {
    // Noop and del are both ok.
    return true;
  }
};



