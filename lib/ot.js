// This contains the master OT functions for the database. They look like
// ot-types style operational transform functions, but they're a bit different.
// These functions understand versions and can deal with out of bound create &
// delete operations.

var otTypes = require('ottypes');

// Default validation function
var defaultValidate = function() {};

// Returns an error string on failure. Rockin' it C style.
exports.checkOpData = function(opData) {
  if (typeof opData !== 'object') return 'Missing opData';
  if (typeof (opData.op || opData.create) !== 'object' && opData.del !== true) return 'Missing op1';
  if (opData.create && typeof opData.create.type !== 'string') return 'Missing create type';
  if (opData.create && otTypes[opData.create.type] == null) return 'Unknown type';

  if ((opData.src != null) && typeof opData.src !== 'string') return 'Invalid src';
  if ((opData.seq != null) && typeof opData.seq !== 'number') return 'Invalid seq';
  if (!!opData.seq !== !!opData.src) return 'seq but not src';

  if (opData.m != null && typeof opData.m !== 'object') return 'opData.m invalid';
};

exports.normalize = function(opData) {
  // I'd love to also normalize opData.op if it exists, but I don't know the
  // type of the operation. And I can't find that out until after transforming
  // the operation anyway.
  if (opData.create) {
    // Store the full URI of the type, not just its short name
    opData.create.type = otTypes[opData.create.type].uri;
  }

  if (opData.m == null) opData.m = {};
  opData.m.ts = Date.now();
};

// This is the super apply function that takes in snapshot data (including the
// type) and edits it in-place.  Returns an error string or null for success.
exports.apply = function(data, opData) {
  var err;

  if (typeof opData !== 'object')
    return 'Missing data';
  if (!(typeof (opData.op || opData.create) === 'object' || opData.del === true))
    return 'Missing op';

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
    data.m = data.m || {};
    data.m.ctime = data.m.mtime = Date.now();

    if ((err = validate(opData, data))) return err;

  } else if (opData.del) { // Delete operations
    if ((err = preValidate(opData, data))) return err;

    opData.prev = {data:data.data, type:data.type};
    delete data.data;
    delete data.type;
    data.v++;

    // Maybe it would make sense to still have a modified time here storing
    // when the document was deleted - but mtime doesn't really make sense for
    // a deleted document, and I want as little leakage as possible.
    delete data.m;

    if ((err = validate(opData, data))) return err;

  } else { // Edit operations
    if (!data.type) return 'Document does not exist';

    var op = opData.op;
    if (typeof op !== 'object') return 'Missing op';
    var type = otTypes[data.type];
    if (!type) return 'Type not found';

    try {
      // This shattering stuff is a little bit dodgy. Its important because it
      // lets the OT type apply the operation incrementally, which means the
      // operation can be validated piecemeal. (Even though the entire
      // operation is accepted or rejected wholesale). Racer uses this, but I'm
      // still not entirely sure its the right API.
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
  }
};

exports.transform = function(type, opData, appliedOpData) {
  // There are 9 cases this function needs to deal with - which are all the
  // combinations of create/delete/op from both opData and appliedOpData.
  //
  // This function has been carefully written to take care of all combinations.
  if ((opData.v != null) && opData.v !== appliedOpData.v)
    return 'Version mismatch';

  if (appliedOpData.del) {
    if (!opData.del) return 'Document was deleted';
  } else if (appliedOpData.create || opData.create) {
    // If appliedOpData.create is not true, appliedOpData contains an op - which
    // also means the document exists remotely.
    return 'Document created remotely';
  } else if (!opData.del) {
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

