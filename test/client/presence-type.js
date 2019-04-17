// A simple type for testing presence, where:
//
// - snapshot is a list
// - operation is { index, value } -> insert value at index in snapshot
// - presence is { index } -> an index in the snapshot
exports.type = {
  name: 'wrapped-presence-no-compare',
  uri: 'http://sharejs.org/types/wrapped-presence-no-compare',
  create: create,
  apply: apply,
  transform: transform,
  createPresence: createPresence,
  transformPresence: transformPresence
};

// The same as `exports.type` but implements `comparePresence`.
exports.type2 = {
  name: 'wrapped-presence-with-compare',
  uri: 'http://sharejs.org/types/wrapped-presence-with-compare',
  create: create,
  apply: apply,
  transform: transform,
  createPresence: createPresence,
  transformPresence: transformPresence,
  comparePresence: comparePresence
};

// The same as `exports.type` but `presence.index` is unwrapped.
exports.type3 = {
  name: 'unwrapped-presence',
  uri: 'http://sharejs.org/types/unwrapped-presence',
  create: create,
  apply: apply,
  transform: transform,
  createPresence: createPresence2,
  transformPresence: transformPresence2
};

function create(data) {
  return data || [];
}

function apply(snapshot, op) {
  snapshot.splice(op.index, 0, op.value);
  return snapshot;
}

function transform(op1, op2, side) {
  return op1.index < op2.index || (op1.index === op2.index && side === 'left') ?
    op1 :
    {
      index: op1.index + 1,
      value: op1.value
    };
}

function createPresence(data) {
  return { index: (data && data.index) | 0 };
}

function transformPresence(presence, op, isOwnOperation) {
  return presence.index < op.index || (presence.index === op.index && !isOwnOperation) ?
    presence :
    {
      index: presence.index + 1
    };
}

function comparePresence(presence1, presence2) {
  return presence1 === presence2 ||
    (presence1 == null && presence2 == null) ||
    (presence1 != null && presence2 != null && presence1.index === presence2.index);
}

function createPresence2(data) {
  return data | 0;
}

function transformPresence2(presence, op, isOwnOperation) {
  return presence < op.index || (presence === op.index && !isOwnOperation) ?
    presence : presence + 1;
}
