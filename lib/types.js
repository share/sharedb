'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.map = exports.defaultType = void 0;
exports.register = register;
exports.defaultType = require('ot-json0').type;
exports.map = Object.create(null);
function register(type) {
  if (type.name) exports.map[type.name] = type;
  if (type.uri) exports.map[type.uri] = type;
}
exports.register(exports.defaultType);
