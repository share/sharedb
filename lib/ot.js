// This contains the master OT functions for the database. They look like
// ot-types style operational transform functions, but they're a bit different.
// These functions understand versions and can deal with out of bound create &
// delete operations.

var otTypes = require('./types').map;

// Default validation function
var defaultValidate = function() {};

// Returns an error string on failure. Rockin' it C style.
exports.checkOpData = function(opData) {
  if (opData == null || typeof opData !== 'object') return 'Missing opData';

  if (opData.op != null) {
    if (!Array.isArray(opData.op)) return 'op must be an array';

  } else if (opData.create != null) {
    if (typeof opData.create !== 'object') return 'create data must be an object';
    var typeName = opData.create.type;
    if (typeof typeName !== 'string') return 'Missing create type';
    var type = otTypes[typeName];
    if (type == null || typeof type !== 'object') return 'Unknown type';

  } else if (opData.del != null) {
    if (opData.del !== true) return 'del value must be true'

  } else {
    return 'Missing op, create, or del'
  }

  if ((opData.src != null) && typeof opData.src !== 'string') return 'Invalid src';
  if ((opData.seq != null) && typeof opData.seq !== 'number') return 'Invalid seq';
  if (!!opData.seq !== !!opData.src) return 'seq but not src';

  if (opData.m != null && typeof opData.m !== 'object') return 'opData.m invalid';
};

// Takes in a string (type name or URI) and returns the normalized name (uri)
var normalizeType = exports.normalizeType = function(typeName) {
  return otTypes[typeName].uri;
};

exports.normalize = function(opData) {
  // I'd love to also normalize opData.op if it exists, but I don't know the
  // type of the operation. And I can't find that out until after transforming
  // the operation anyway.
  if (opData.create) {
    // Store the full URI of the type, not just its short name
    opData.create.type = normalizeType(opData.create.type);
  }

  if (opData.m == null) opData.m = {};
  if (!opData.src) opData.src = '';
  opData.m.ts = Date.now();
};

// This is the super apply function that takes in snapshot data (including the
// type) and edits it in-place.  Returns an error string or null for success.
var apply = exports.apply = function(data, opData) {
  var err;

  if (typeof opData !== 'object')
    return 'Missing data';

  if ((data.v != null) && (opData.v != null) && data.v !== opData.v)
    return 'Version mismatch';

  var validate = opData.validate || defaultValidate;
  var preValidate = opData.preValidate || defaultValidate;

  // Create operation
  if (opData.create) {
    if (data.type) return 'Document already exists';

    // The document doesn't exist, although it might have once existed.
    var create = opData.create;
    var type = otTypes[create.type];
    if (!type) return "Type not found";

    if ((err = preValidate(opData, data))) return err;

    var snapshot = type.create(create.data);
    data.data = snapshot;
    data.type = type.uri;
    data.v++;

    // metadata
    if (create.m != null && typeof create.m !== 'object')
      return 'Invalid metadata in create'

    var meta = create.m || {};
    meta.ctime = meta.mtime = Date.now();
    data.m = meta;

    if ((err = validate(opData, data))) return err;

  // Delete operation
  } else if (opData.del) {
    if ((err = preValidate(opData, data))) return err;

    // Delete the snapshot and make it available to the validation function
    // as the prev property to indicate what was deleted
    opData.prev = {data:data.data, type:data.type};
    delete data.data;
    delete data.type;
    data.v++;

    if ((err = validate(opData, undefined))) return err;

    // Don't expose the prev property beyond this function, since it could
    // have access control implications and we don't want to save it in the op
    delete opData.prev;

  // Edit operations
  } else if (opData.op) {
    if (!data.type) return 'Document does not exist';

    var op = opData.op;
    if (typeof op !== 'object') return 'Missing op';
    var type = otTypes[data.type];
    if (!type) return 'Type not found';

    try {
      // This shattering stuff is a little bit dodgy. Its important because it
      // lets the OT type apply the operation incrementally, which means the
      // operation can be validated piecemeal. (Even though the entire
      // operation is accepted or rejected wholesale). Racer uses this, but
      // I'm convinced its not the right API. I want to remove / rewrite this
      // when I think of something to replace it with.
      var atomicOps = type.shatter ? type.shatter(op) : [op];
      for (var i = 0; i < atomicOps.length; i++) {
        var atom = atomicOps[i];
        opData.op = atom;
        if ((err = preValidate(opData, data))) {
          opData.op = op;
          return err;
        }

        // !! The money line.
        data.data = type.apply(data.data, atom);

        if ((err = validate(opData, data))) {
          opData.op = op;
          return err;
        }
      }
      // Make sure to restore the operation before returning.
      opData.op = op;

    } catch (err) {
      console.log(err.stack);
      return err.message;
    }

    data.m = data.m || {};
    data.m.mtime = Date.now();
    data.v++;
  } else {
    // Its a no-op, and we don't have to do anything.
    data.v++;
  }
};

// This is a helper function to catchup a document by a list of operations.
exports.applyAll = function(data, ops) {
  var err;
  if (ops.length) {
    for (var i = 0; i < ops.length; i++) {
      if ((err = apply(data, ops[i]))) return err;
    }
  }
};

exports.transform = function(type, opData, appliedOpData) {
  // There are 16 cases this function needs to deal with - which are all the
  // combinations of create/delete/op/noop from both opData and appliedOpData.
  //
  // This function was carefully written before noop, but now its a bit of a mess. I want schematic
  // tables!
  if ((opData.v != null) && opData.v !== appliedOpData.v)
    return 'Version mismatch';

  if (appliedOpData.del) {
    if (opData.create || opData.op) return 'Document was deleted';
  } else if ((appliedOpData.create && (opData.op || opData.create || opData.del))
      || (appliedOpData.op && opData.create)) {
    // If appliedOpData.create is not true, appliedOpData contains an op - which
    // also means the document exists remotely.
    return 'Document created remotely';
  } else if (appliedOpData.op && opData.op) {
    // If we reach here, they both have a .op property.
    if (!type) return 'Document does not exist';

    if (typeof type === 'string') {
      type = otTypes[type];
      if (!type) return "Type not found";
    }

    try {
      opData.op = type.transform(opData.op, appliedOpData.op, 'left');
    } catch (e) {
      return e.message;
    }
  }

  if (opData.v != null) opData.v++;
};

function checkKey(key) {
  if (key.charAt(0) === '_' && key !== '_cursor') return 'Cannot set reserved value';
}
