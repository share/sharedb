var SUPPORTED_METHODS = [
  'info',
  'warn',
  'error'
];

function Logger() {
  this.setMethods(console);
}
module.exports = Logger;

Logger.prototype.setMethods = function (overrides) {
  overrides = overrides || {};
  var logger = this;

  SUPPORTED_METHODS.forEach(function (method) {
    if (typeof overrides[method] === 'function') {
      logger[method] = overrides[method];
    }
  });
};
