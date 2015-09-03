exports.Connection = require('./connection').Connection;
exports.Doc = require('./doc').Doc;

var types = require('../types');
exports.otTypes = types.map;
exports.registerType = types.registerType;
