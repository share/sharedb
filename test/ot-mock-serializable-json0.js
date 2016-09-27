var ot_json0 = require('ot-json0').type;
var HEADER = '!HEADER!';

// ot-mock-serializable-json0 is an ot type identical in
//  behavior to the ot-json0 type when it is deserialized
//  but will fail if serialized.
//  For example calling ot-json.apply() on a serialized
//  snapshot will fail.
var ot_mock_serializable_json0 = {
    name: 'ot_mock_serializable_json0',
    uri: 'http://sharejs.org/types/ot_mock_serializable_json0',

    create: function( initialData ) {
        return initialData;
    },

    createDeserialized: function(initialData) {
        return ot_mock_serializable_json0.deserialize(initialData)
    },

    apply: function( data, op ) {
        if(isSerialized(data)) {
            throw new Error('cannot call apply on a serialized ot type instance');
        }

        return ot_json0.apply(data, op);
    },

    transform: ot_json0.transform,
    compose: ot_json0.compose,
    invert: ot_json0.invert,
    normalize: ot_json0.normalize,

    serialize: function( data ) {
        if(isSerialized(data)) {
            throw new Error('cannot serialize an already serialized ot type instance');
        }
        return HEADER + JSON.stringify(data);
    },

    deserialize: function( data ) {
        if(!isSerialized(data)) {
            throw new Error('cannot deserialize an already deserialized ot type instance');
        }
        return JSON.parse( data.substring(HEADER.length) );
    },

};

exports.type = ot_mock_serializable_json0;

function isSerialized( data ) {
    return typeof data == 'string' && data.substring(0, HEADER.length) === HEADER;
}