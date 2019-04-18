
exports.doNothing = doNothing;
function doNothing() {}

exports.hasKeys = function(object) {
  for (var key in object) return true;
  return false;
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger#Polyfill
exports.isInteger = Number.isInteger || function (value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value;
};

exports.isValidVersion = function (version) {
  if (version === null) return true;
  return exports.isInteger(version) && version >= 0;
};

exports.isValidTimestamp = function (timestamp) {
  return exports.isValidVersion(timestamp);
};

exports.callEach = function (callbacks, err) {
  var called = false;
  for (var i = 0; i < callbacks.length; i++) {
    var callback = callbacks[i];
    if (callback) {
      callback(err);
      called = true;
    }
  }
  return called;
};
