// This contains the master OT functions for the database. They look like
// ot-types style operational transform functions, but they're a bit different.
// These functions understand versions and can deal with out of bound create &
// delete operations.

var types = require('./types').map;
var ShareDBError = require('./error');

var ERROR_CODE = ShareDBError.code;

// Returns an error string on failure. Rockin' it C style.
exports.checkOp = function(op) {
  if (op == null || typeof op !== 'object') {
    return {code: ERROR_CODE.MISSING_OP, message: 'Missing op'};
  }

  if (op.create != null) {
    if (typeof op.create !== 'object') {
      return {code: ERROR_CODE.CREATE_DATA_MUST_BE_AN_OBJECT, message: 'create data must be an object'};
    }
    var typeName = op.create.type;
    if (typeof typeName !== 'string') {
      return {code: ERROR_CODE.MISSING_CREATE_TYPE, message: 'Missing create type'};
    }
    var type = types[typeName];
    if (type == null || typeof type !== 'object') {
      return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};
    }
  } else if (op.del != null) {
    if (op.del !== true) return {code: ERROR_CODE.DEL_MUST_BE_TRUE, message: 'del value must be true'};
  } else if (op.op == null) {
    return {code: ERROR_CODE.MISSING_OP, message: 'Missing op, create, or del'};
  }

  if (op.src != null && typeof op.src !== 'string') {
    return {code: ERROR_CODE.INVALID_SRC, message: 'Invalid src'};
  }
  if (op.seq != null && typeof op.seq !== 'number') {
    return {code: ERROR_CODE.INVALID_SEQ, message: 'Invalid seq'};
  }
  if (
    (op.src == null && op.seq != null) ||
    (op.src != null && op.seq == null)
  ) {
    return {code: ERROR_CODE.SRC_AND_SEQ_MUST_BE_SET_TOGETHER, message: 'Both src and seq must be set together'};
  }

  if (op.m != null && typeof op.m !== 'object') {
    return {code: ERROR_CODE.INVALID_METADATA, message: 'op.m invalid'};
  }
};

// Takes in a string (type name or URI) and returns the normalized name (uri)
exports.normalizeType = function(typeName) {
  return types[typeName] && types[typeName].uri;
};

// This is the super apply function that takes in snapshot data (including the
// type) and edits it in-place. Returns an error or null for success.
exports.apply = function(snapshot, op) {
  if (typeof snapshot !== 'object') {
    return {code: ERROR_CODE.MISSING_SNAPSHOT, message: 'Missing snapshot'};
  }
  if (snapshot.v != null && op.v != null && snapshot.v !== op.v) {
    return {code: ERROR_CODE.VERSION_MISMATCH, message: 'Version mismatch'};
  }

  // Create operation
  if (op.create) {
    if (snapshot.type) return {code: ERROR_CODE.DOCUMENT_ALREADY_CREATED, message: 'Document already exists'};

    // The document doesn't exist, although it might have once existed
    var create = op.create;
    var type = types[create.type];
    if (!type) return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};

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
  if (!snapshot.type) return {code: ERROR_CODE.DOCUMENT_DOES_NOT_EXIST, message: 'Document does not exist'};

  if (edit == null) return {code: ERROR_CODE.MISSING_OP, message: 'Missing op'};
  var type = types[snapshot.type];
  if (!type) return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};

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
    return {code: ERROR_CODE.VERSION_MISMATCH, message: 'Version mismatch'};
  }

  if (appliedOp.del) {
    if (op.create || op.op) {
      return {code: ERROR_CODE.DOCUMENT_WAS_DELETED, message: 'Document was deleted'};
    }
  } else if (
    (appliedOp.create && (op.op || op.create || op.del)) ||
    (appliedOp.op && op.create)
  ) {
    // If appliedOp.create is not true, appliedOp contains an op - which
    // also means the document exists remotely.
    return {code: ERROR_CODE.DOCUMENT_CREATED_REMOTELY, message: 'Document was created remotely'};
  } else if (appliedOp.op && op.op) {
    // If we reach here, they both have a .op property.
    if (!type) return {code: ERROR_CODE.DOCUMENT_DOES_NOT_EXIST, message: 'Document does not exist'};

    if (typeof type === 'string') {
      type = types[type];
      if (!type) return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};
    }

    try {
      op.op = type.transform(op.op, appliedOp.op, 'left');
    } catch (err) {
      return err;
    }
  }

  if (op.v != null) op.v++;
};

/**
 * Apply an array of ops to the provided snapshot.
 *
 * @param snapshot - a Snapshot object which will be mutated by the provided ops
 * @param ops - an array of ops to apply to the snapshot
 * @return an error object if applicable
 */
exports.applyOps = function(snapshot, ops) {
  var type = null;

  if (snapshot.type) {
    type = types[snapshot.type];
    if (!type) return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};
  }

  for (var index = 0; index < ops.length; index++) {
    var op = ops[index];

    snapshot.v = op.v + 1;

    if (op.create) {
      type = types[op.create.type];
      if (!type) return {code: ERROR_CODE.UNKNOWN_TYPE, message: 'Unknown type'};
      snapshot.data = type.create(op.create.data);
      snapshot.type = type.uri;
    } else if (op.del) {
      snapshot.data = undefined;
      type = null;
      snapshot.type = null;
    } else {
      snapshot.data = type.apply(snapshot.data, op.op);
    }
  }
};
