var logger = require('../lib/logger');
var sinon = require('sinon');

if (process.env.LOGGING !== 'true') {
  // Silence the logger for tests by setting all its methods to no-ops
  logger.setMethods({
    info: function() {},
    warn: function() {},
    error: function() {}
  });
}

afterEach(function() {
  sinon.restore();
});
