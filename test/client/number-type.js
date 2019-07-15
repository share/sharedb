// A simple number type, where:
//
// - snapshot is an integer
// - operation is an integer
exports.type = {
  name: 'number-type',
  uri: 'http://sharejs.org/types/number-type',
  create: create,
  apply: apply,
  transform: transform
};

function create(data) {
  return data | 0;
}

function apply(snapshot, op) {
  return snapshot + op;
}

function transform(op1) {
  return op1;
}
