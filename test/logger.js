var Logger = require('../lib/logger/logger');
var expect = require('expect.js');
var sinon = require('sinon');

describe('Logger', function () {
  describe('Stubbing console.warn', function () {
    beforeEach(function () {
      sinon.stub(console, 'warn');
    });

    afterEach(function () {
      sinon.restore();
    });

    it('logs to console by default', function () {
      var logger = new Logger();
      logger.warn('warning');
      expect(console.warn.calledOnceWithExactly('warning')).to.be(true);
    });

    it('overrides console', function () {
      var customWarn = sinon.stub();
      var logger = new Logger();
      logger.setMethods({
        warn: customWarn
      });

      logger.warn('warning');

      expect(console.warn.notCalled).to.be(true);
      expect(customWarn.calledOnceWithExactly('warning')).to.be(true);
    });

    it('only overrides if provided with a method', function () {
      var badWarn = 'not a function';
      var logger = new Logger();
      logger.setMethods({
        warn: badWarn
      });

      logger.warn('warning');

      expect(console.warn.calledOnceWithExactly('warning')).to.be(true);
    });
  });
});
