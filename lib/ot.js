// This contains the master OT functions for the database. They look like
// ot-types style operational transform functions, but they're a bit different.
// These functions understand versions and can deal with out of bound create &
// delete operations.

var otTypes = {};

// Default validation function
var defaultValidate = function() {};

// Register the specified type in the bundled ottypes module.
var registerType = exports.registerType = function(type) {
  if (typeof type === 'string') type = require(type).type;
  if (type.name) otTypes[type.name] = type;
  if (type.uri) otTypes[type.uri] = type;
};

registerType('ot-json0');
registerType('ot-text');
registerType('ot-text-tp2');

// Returns an error string on failure. Rockin' it C style.
exports.checkOpData = function(opData) {
  if (typeof opData !== 'object') return 'Missing opData';

  if (typeof (opData.op || opData.create) !== 'object' && opData.del !== true) return 'Missing op1';

  if (opData.create) {
    var typeStr = opData.create.type;
    if (typeof typeStr !== 'string') return 'Missing create type';
    var type = otTypes[typeStr];
    if (type == null || typeof type !== 'object') return 'Unknown type';
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
  // if (!(typeof (opData.op || opData.create) === 'object' || opData.del === true))
  //   return 'Missing op';

  if ((data.v != null) && (opData.v != null) && data.v !== opData.v)
    return 'Version mismatch';

  var validate = opData.validate || defaultValidate;
  var preValidate = opData.preValidate || defaultValidate;

  if (opData.create) { // Create operations
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

  } else if (opData.del) { // Delete operations
    if ((err = preValidate(opData, data))) return err;

    opData.prev = {data:data.data, type:data.type};
    delete data.data;
    delete data.type;
    data.v++;

    // Previously we were deleting the metadata by default. We should include it
    // by default for consistancy with other ops and allow users to remove it in the
    // post validation phase if they really don't want it to stay in the snapshot
    //delete data.m
    var meta = data.m || {};
    meta.mtime = Date.now();
    data.m = meta;

    if ((err = validate(opData, data))) return err;

    // Don't leak prev past this function - it has security implications with projections.
    delete opData.prev;

  } else if (opData.op) { // Edit operations
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

// Apply a presence op to the presence data.
exports.applyPresence = function(p, pOp) {
  var container = p;
  var key = 'data';
  var value = pOp.val;
  var err;

  if (pOp.p) {
    if (!Array.isArray(pOp.p)) return 'Path must be an array';

    // This is really gross...... :/
    if (pOp.p.length >= 2) {
      if ((err = checkKey(pOp.p[1]))) return err;
    } else if (pOp.p.length === 1) {
      // Setting an entire user's presence data
      for (var k in value) {
        if ((err = checkKey(k))) return err;
      }
    }
  }

  // Not checking keys for ops with no path - I figure only the server will be
  // allowed to wholesale overwrite the presence data of a document, and in
  // that case I'm not overly concerned.

  if (pOp.p) for (var i = 0; i < pOp.p.length; i++) {
    if (container[key] == null) {
      if (value == null) return;
      container[key] = {};
    }
    container = container[key];
    key = pOp.p[i];

    if (typeof key !== 'string') return 'Cannot use non-string key';
  }
  if (value == null) {
    if (container === p) {
      // Don't delete the root object, just replace it with {}.
      container.data = {};
    } else {
      delete container[key];
    }
  } else {
    container[key] = value;
  }
};

// Transform pOp by opData
exports.transformPresence = function(type, p, pOp, opData) {
  if (typeof type === 'string') {
    type = otTypes[type];
    if (!type) return "Type not found";
  }

  if (!type.transformCursor) return;

  // This is not complete. .... ........
  if (pOp.p && pOp.p.length === 2 && pOp.p[1] === 'cursor' && opData.op) {
    // Gasp...
    pOp.val = type.transformCursor(pOp.val, opData.op, pOp.p[0] === opData.src);
  }
};

// Apply a normal op to the presence data. Probably a bad name.
exports.updatePresence = function(type, p, opData) {
  if (!p) return;
  if (typeof type === 'string') {
    type = otTypes[type];
    if (!type) return "Type not found";
  }

  if (opData.op != null && !type.transformCursor) return;
  if (opData.create) return; // Nothing to do!

  for (var id in p.data) {
    var d = p.data[id];
    if (d._cursor != null) {
      if (opData.op) {
        d._cursor = type.transformCursor(d._cursor, opData.op, id === opData.src);
      } else if (opData.del) {
        delete d._cursor;
      }
    }
  }
}

