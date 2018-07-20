// A simple type for testing undo/redo, where:
//
// - snapshot is an integer
// - operation is an integer
exports.type = {
  name: 'invertible-type',
  uri: 'http://sharejs.org/types/invertible-type',
  create: create,
  apply: apply,
  transform: transform,
  invert: invert
};

exports.typeWithDiff = {
  name: 'invertible-type-with-diff',
  uri: 'http://sharejs.org/types/invertible-type-with-diff',
  create: create,
  apply: apply,
  transform: transform,
  invert: invert,
  diff: diff
};

exports.typeWithDiffX = {
  name: 'invertible-type-with-diffX',
  uri: 'http://sharejs.org/types/invertible-type-with-diffX',
  create: create,
  apply: apply,
  transform: transform,
  invert: invert,
  diffX: diffX
};

exports.typeWithDiffAndDiffX = {
  name: 'invertible-type-with-diff-and-diffX',
  uri: 'http://sharejs.org/types/invertible-type-with-diff-and-diffX',
  create: create,
  apply: apply,
  transform: transform,
  invert: invert,
  diff: diff,
  diffX: diffX
};

exports.typeWithTransformX = {
  name: 'invertible-type-with-transformX',
  uri: 'http://sharejs.org/types/invertible-type-with-transformX',
  create: create,
  apply: apply,
  transformX: transformX,
  invert: invert
};

function create(data) {
  return data | 0;
}

function apply(snapshot, op) {
  return snapshot + op;
}

function transform(op1, op2, side) {
  return op1;
}

function transformX(op1, op2) {
  return [ op1, op2 ];
}

function invert(op) {
  return -op;
}

function diff(oldSnapshot, newSnapshot) {
  return newSnapshot - oldSnapshot;
}

function diffX(oldSnapshot, newSnapshot) {
  return [ oldSnapshot - newSnapshot, newSnapshot - oldSnapshot ];
}
