
// A basic type that uses a custom linked list object type as its snapshot
// data and therefore requires custom serialization into JSON
exports.type = {
  name: 'test-deserialized-type',
  uri: 'http://sharejs.org/types/test-deserialized-type',
  create: create,
  deserialize: deserialize,
  apply: apply,
  transform: transform
};

// Type that additionally defines createDeserialized and supports passing
// deserialized data to doc.create()
exports.type2 = {
  name: 'test-deserialized-type2',
  uri: 'http://sharejs.org/types/test-deserialized-type2',
  create: create,
  createDeserialized: createDeserialized,
  deserialize: deserialize,
  apply: apply,
  transform: transform
};

// A node of a singly linked list to demonstrate use of a non-JSON type as
// snapshot data
exports.Node = Node;

// When type.createDeserialized is defined, it will be called on the client
// instead of type.create, and type.create will be called on the server. Only
// serialized data should be passed to type.create
function create(array) {
  return array || [];
}

// If type.deserialize is defined and type.createDeserialized is not,
// type.create + type.deserialize will be called in the client Doc class when
// a create operation is created locally or received from the server. The type
// may implement this method to support creating doc data in the deserialized
// format directly in addition to creating from the serialized form
function createDeserialized(data) {
  if (data instanceof Node) {
    return data;
  }
  if (data == null) {
    return null;
  }
  return deserialize(data);
}

// Method called when a snapshot is ingested to cast it into deserialized type
// before setting on doc.data
function deserialize(array) {
  var node = null;
  for (var i = array.length; i--;) {
    var value = array[i];
    node = new Node(value, node);
  }
  return node;
}

// When deserialized is defined, apply must do type checking on the input and
// return deserialized data when passed deserialized data or serialized data
// when passed serialized data
function apply(data, op) {
  return (data instanceof Node) ?
    deserializedApply(data, op) :
    serializedApply(data, op);
}

// Deserialized apply is used in the client for all client submitted and
// incoming ops. It should apply with the snapshot in the deserialized format
function deserializedApply(node, op) {
  if (typeof op.insert === 'number') {
    return node.insert(op.insert, op.value);
  }
  throw new Error('Op not recognized');
}

// Serialized apply is needed for applying ops on the server to the snapshot
// data stored in the database. For maximum efficiency, the serialized apply
// can implement the equivalent apply method on JSON data directly, though for
// a simpler implementation, it can also call deserialize its input, use the
// same deserialized apply, and serialize again before returning
function serializedApply(array, op) {
  if (typeof op.insert === 'number') {
    array.splice(array.insert, 0, op.value);
    return array;
  }
  throw new Error('Op not recognized');
}

function transform(op1, op2, side) {
  if (
    typeof op1.insert === 'number' &&
    typeof op2.insert === 'number'
  ) {
    var index = op1.insert;
    if (op2.insert < index || (op2.insert === index && side === 'left')) {
      index++;
    }
    return {
      insert: index,
      value: op1.value
    };
  }
  throw new Error('Op not recognized');
}

// A custom linked list object type to demonstrate custom deserialization
function Node(value, next) {
  this.value = value;
  this.next = next || null;
}
Node.prototype.at = function(index) {
  var node = this;
  while (index--) {
    node = node.next;
  }
  return node;
};
Node.prototype.insert = function(index, value) {
  if (index === 0) {
    return new Node(value, this);
  }
  var previous = this.at(index - 1);
  var node = new Node(value, previous.next);
  previous.next = node;
  return this;
};
// Implementing a toJSON serialization method for the doc.data object is
// needed if doc.create() is called with deserialized data
Node.prototype.toJSON = function() {
  var out = [];
  for (var node = this; node; node = node.next) {
    out.push(node.value);
  }
  return out;
};
