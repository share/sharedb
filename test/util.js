
exports.sortById = function(docs) {
  return docs.slice().sort(function(a, b) {
    if (a.id > b.id) return 1;
    if (b.id > a.id) return -1;
    return 0;
  });
};

exports.pluck = function(docs, key) {
  var values = [];
  for (var i = 0; i < docs.length; i++) {
    values.push(docs[i][key]);
  }
  return values;
};

// Wrap a done function to call back only after a specified number of calls.
// For example, `var callbackAfter = callAfter(1, callback)` means that if
// `callbackAfter` is called once, it won't call back. If it is called twice
// or more, it won't call back for the first time, but it will call back for
// each following time. Calls back immediately if called with an error.
//
// Return argument is a function with the property `calls`. This property
// starts at zero and increments for each call.
exports.callAfter = function(calls, callback) {
  if (typeof calls !== 'number') {
    throw new Error('Required `calls` argument must be a number');
  }
  if (typeof callback !== 'function') {
    throw new Error('Required `callback` argument must be a function');
  }
  var callbackAfter = function(err) {
    callbackAfter.called++;
    if (err) return callback(err);
    if (callbackAfter.called <= calls) return;
    callback();
  };
  callbackAfter.called = 0;
  return callbackAfter;
};

exports.errorHandler = function(callback) {
  return function(error) {
    if (error) callback(error);
  };
};

exports.errorHandler = function(callback) {
  return function(error) {
    if (error) callback(error);
  };
};
