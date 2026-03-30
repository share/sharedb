var logger = require('../lib/logger');
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var chai = require('chai');

chai.use(sinonChai.default);

if (process.env.LOGGING !== 'true') {
  // Silence the logger for tests by setting all its methods to no-ops
  logger.setMethods({
    info: function() {},
    warn: function() {},
    error: function() {}
  });
}

afterEach(function() {
  if (sinon.clock) {
    sinon.clock.uninstall();
  }
  sinon.restore();
});
