
exports.defaultType = require('ot-json0').type;

exports.map = Object.create(null);

exports.register = function(type) {
  if (type.name) exports.map[type.name] = type;
  if (type.uri) exports.map[type.uri] = type;
};

exports.register(exports.defaultType);
