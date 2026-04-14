
export const defaultType = require('ot-json0').type;
export const map = Object.create(null);

export function register(type) {
  if (type.name) exports.map[type.name] = type;
  if (type.uri) exports.map[type.uri] = type;
}

exports.register(exports.defaultType);
