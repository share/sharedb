'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.MAX_SAFE_INTEGER =
  exports.isInteger =
  exports.hasOwn =
  exports.inherits =
  exports.nextTick =
    void 0;
exports.doNothing = doNothing;
exports.hasKeys = hasKeys;
exports.isValidVersion = isValidVersion;
exports.isValidTimestamp = isValidTimestamp;
exports.dig = dig;
exports.digOrCreate = digOrCreate;
exports.digAndRemove = digAndRemove;
exports.supportsPresence = supportsPresence;
exports.callEach = callEach;
exports.truthy = truthy;
exports.clone = clone;
exports.isDangerousProperty = isDangerousProperty;
var nextTickImpl = require('./next-tick');
function doNothing() {}
function hasKeys(object) {
  for (var key in object) return true;
  return false;
}
exports.hasOwn =
  Object.hasOwn ||
  function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger#Polyfill
exports.isInteger =
  Number.isInteger ||
  function (value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  };
function isValidVersion(version) {
  if (version === null) return true;
  return exports.isInteger(version) && version >= 0;
}
function isValidTimestamp(timestamp) {
  return exports.isValidVersion(timestamp);
}
exports.MAX_SAFE_INTEGER = 9007199254740991;
function dig() {
  var obj = arguments[0];
  for (var i = 1; i < arguments.length; i++) {
    var key = arguments[i];
    obj = (0, exports.hasOwn)(obj, key)
      ? obj[key]
      : i === arguments.length - 1
        ? undefined
        : Object.create(null);
  }
  return obj;
}
function digOrCreate() {
  var obj = arguments[0];
  var createCallback = arguments[arguments.length - 1];
  for (var i = 1; i < arguments.length - 1; i++) {
    var key = arguments[i];
    obj = (0, exports.hasOwn)(obj, key)
      ? obj[key]
      : (obj[key] = i === arguments.length - 2 ? createCallback() : Object.create(null));
  }
  return obj;
}
function digAndRemove() {
  var obj = arguments[0];
  var objects = [obj];
  for (var i = 1; i < arguments.length - 1; i++) {
    var key = arguments[i];
    if (!(0, exports.hasOwn)(obj, key)) break;
    obj = obj[key];
    objects.push(obj);
  }
  for (var i = objects.length - 1; i >= 0; i--) {
    var parent = objects[i];
    var key = arguments[i + 1];
    var child = parent[key];
    if (i === objects.length - 1 || !exports.hasKeys(child)) delete parent[key];
  }
}
function supportsPresence(type) {
  return type && typeof type.transformPresence === 'function';
}
function callEach(callbacks, error) {
  var called = false;
  callbacks.forEach(function (callback) {
    if (callback) {
      callback(error);
      called = true;
    }
  });
  return called;
}
function truthy(arg) {
  return !!arg;
}
if (typeof process !== 'undefined' && typeof process.nextTick === 'function') {
  exports.nextTick = process.nextTick;
} else if (typeof MessageChannel !== 'undefined') {
  exports.nextTick = nextTickImpl.messageChannel;
} else {
  exports.nextTick = nextTickImpl.setTimeout;
}
function clone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}
var objectProtoPropNames = Object.create(null);
Object.getOwnPropertyNames(Object.prototype).forEach(function (prop) {
  if (prop !== '__proto__') {
    objectProtoPropNames[prop] = true;
  }
});
function isDangerousProperty(propName) {
  return propName === '__proto__' || objectProtoPropNames[propName];
}
try {
  var util = require('util');
  if (typeof util.inherits !== 'function') throw new Error('Could not find util.inherits()');
  exports.inherits = util.inherits;
} catch (e) {
  try {
    exports.inherits = require('inherits');
  } catch (e) {
    throw new Error(
      'If running sharedb in a browser, please install the "inherits" or "util" package',
    );
  }
}
