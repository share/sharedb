var Promise = require('es6-promise').Promise;

exports.doNothing = doNothing;
function doNothing() {}

exports.hasKeys = function(object) {
  for (var key in object) return true;
  return false;
};

exports.promisify = function(callback) {
  var promise;

  // Don't create a Promise if a callback was provided, to avoid unnecessary confusion with logic forks
  if (typeof callback !== 'function') {
    promise = new Promise(function (resolve, reject) {
      callback = function (error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }

        // Return the promise from the callback so that we can have early exits from functions like:
        // return callback()
        return promise;
      };
    });
  }

  return {
    promise: promise,
    callback: callback
  };
};
