'use strict';
var SUPPORTED_METHODS = ['info', 'warn', 'error'];
var Logger = /** @class */ (function () {
  function Logger() {
    var defaultMethods = Object.create(null);
    SUPPORTED_METHODS.forEach(function (method) {
      // Deal with Chrome issue: https://bugs.chromium.org/p/chromium/issues/detail?id=179628
      defaultMethods[method] = console[method].bind(console);
    });
    this.setMethods(defaultMethods);
  }
  Logger.prototype.setMethods = function (overrides) {
    overrides = overrides || {};
    var logger = this;
    SUPPORTED_METHODS.forEach(function (method) {
      if (typeof overrides[method] === 'function') {
        logger[method] = overrides[method];
      }
    });
  };
  return Logger;
})();
module.exports = Logger;
