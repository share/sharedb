// This contains the master OT functions for the database. They look like
// ot-types style operational transform functions, but they're a bit different.
// These functions understand versions and can deal with out of bound create &
// delete operations.

var types = require('./types').map;

// Returns an error string on failure. Rockin' it C style.
exports.checkOp = function(op) {
  if (op == null || typeof op !== 'object') return {message: 'Missing op'};

  if (op.op != null) {
    if (!Array.isArray(op.op)) return {message: 'op must be an array'};

  } else if (op.create != null) {
    if (typeof op.create !== 'object') return {message: 'create data must be an object'};
    var typeName = op.create.type;
    if (typeof typeName !== 'string') return {message: 'Missing create type'};
    var type = types[typeName];
    if (type == null || typeof type !== 'object') return {message: 'Unknown type'};

  } else if (op.del != null) {
    if (op.del !== true) return {message: 'del value must be true'};

  } else {
    return {message: 'Missing op, create, or del'};
  }

  if (op.src != null && typeof op.src !== 'string') return {message: 'Invalid src'};
  if (op.seq != null && typeof op.seq !== 'number') return {message: 'Invalid seq'};
  if (!op.seq !== !op.src) return {message: 'seq but not src'};

  if (op.m != null && typeof op.m !== 'object') return {message: 'op.m invalid'};
};

// Takes in a string (type name or URI) and returns the normalized name (uri)
exports.normalizeType = function(typeName) {
  return types[typeName] && types[typeName].uri;
};

// This is the super apply function that takes in snapshot data (including the
// type) and edits it in-place. Returns an error or null for success.
exports.apply = function(snapshot, op) {
  if (typeof snapshot !== 'object') {
    return {message: 'Missing snapshot'};
  }
  if (snapshot.v != null && op.v != null && snapshot.v !== op.v) {
    return {message: 'Version mismatch'};
  }

  // Create operation
  if (op.create) {
    if (snapshot.type) return {message: 'Document already exists'};

    // The document doesn't exist, although it might have once existed
    var create = op.create;
    var type = types[create.type];
    if (!type) return {message: 'Type not found'};

    try {
      snapshot.data = type.create(create.data);
      snapshot.type = type.uri;
      snapshot.v++;
    } catch (err) {
      return err;
    }

  // Delete operation
  } else if (op.del) {
    snapshot.data = undefined;
    snapshot.type = null;
    snapshot.v++;

  // Edit operation
  } else if (op.op) {
    var err = applyOpEdit(snapshot, op.op);
    if (err) return err;
    snapshot.v++;

  // No-op, and we don't have to do anything
  } else {
    snapshot.v++;
  }
};

function applyOpEdit(snapshot, edit) {
  if (!snapshot.type) return {message: 'Document does not exist'};

  if (typeof edit !== 'object') return {message: 'Missing op'};
  var type = types[snapshot.type];
  if (!type) return {message: 'Type not found'};

  try {
    snapshot.data = type.apply(snapshot.data, edit);
  } catch (err) {
    return err;
  }
}

exports.transform = function(type, op, appliedOp) {
  // There are 16 cases this function needs to deal with - which are all the
  // combinations of create/delete/op/noop from both op and appliedOp
  if (op.v != null && op.v !== appliedOp.v) {
    return {message: 'Version mismatch'};
  }

  if (appliedOp.del) {
    if (op.create || op.op) return {message: 'Document was deleted'};
  } else if (
    (appliedOp.create && (op.op || op.create || op.del)) ||
    (appliedOp.op && op.create)
  ) {
    // If appliedOp.create is not true, appliedOp contains an op - which
    // also means the document exists remotely.
    return {message: 'Document created remotely'};
  } else if (appliedOp.op && op.op) {
    // If we reach here, they both have a .op property.
    if (!type) return {message: 'Document does not exist'};

    if (typeof type === 'string') {
      type = types[type];
      if (!type) return {message: 'Type not found'};
    }

    try {
      op.op = type.transform(op.op, appliedOp.op, 'left');
    } catch (err) {
      return err;
    }
  }

  if (op.v != null) op.v++;
};
