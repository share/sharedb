var ot_json0 = require('ot-json0').type;
var HEADER = '!HEADER!';

/** ot-mock-serializable-json0 is a simple wrapper around 
 *  the ot-json0 type providing support for custom serialization
 */
var ot_mock_serializable_json0 = {
  name: 'ot_mock_serializable_json0',
  uri: 'http://sharejs.org/types/ot_mock_serializable_json0',

  create: function( initialData ) {
    if(!isSerialized(initialData)) {
      throw new Error('SerializableJson0: initialData must be serialized');
    }
    return initialData;
  },

  createDeserialized: function(initialData) {
    if(!isSerialized(initialData)) {
      throw new Error('SerializableJson0: initialData must be serialized');
    }
    return ot_mock_serializable_json0.deserialize(initialData);
  },

  apply: function( data, op ) {
    var is_serialized = isSerialized(data);
    if(is_serialized) {
      data = ot_mock_serializable_json0.deserialize(data);
    }
    data = ot_json0.apply(data, op);
    if(is_serialized) {
      data = ot_mock_serializable_json0.serialize(data);
    }
    return data;
  },

  transform: ot_json0.transform,
  compose: ot_json0.compose,
  invert: ot_json0.invert,
  normalize: ot_json0.normalize,

  serialize: function( data ) {
    if(isSerialized(data)) {
      throw new Error('SerializableJson0: cannot serialize an already serialized ot type instance');
    }
    return HEADER + JSON.stringify(data);
  },

  deserialize: function( data ) {
    if(!isSerialized(data)) {
      throw new Error('SerializableJson0: cannot deserialize an already deserialized ot type instance');
    }
    return JSON.parse( data.substring(HEADER.length) );
  },

};

exports.type = ot_mock_serializable_json0;

function isSerialized( data ) {
  return typeof data === 'string' && data.substring(0, HEADER.length) === HEADER;
}