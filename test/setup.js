var logger = require('../lib/logger');

if (process.env.LOGGING !== 'true') {
  // Silence the logger for tests by setting all its methods to no-ops
  logger.setMethods({
    info: function() {},
    warn: function() {},
    error: function() {}
  });
}
