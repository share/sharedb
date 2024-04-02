var nextTickImpl = require('../lib/next-tick');
var expect = require('chai').expect;

describe('nextTick', function() {
  ['messageChannel', 'setTimeout'].forEach(function(name) {
    var tick = nextTickImpl[name];

    it('passes args', function(done) {
      tick(function(arg1, arg2, arg3) {
        expect(arg1).to.equal('foo');
        expect(arg2).to.equal(123);
        expect(arg3).to.be.undefined;
        done();
      }, 'foo', 123);
    });

    it('calls asynchronously', function(done) {
      var called = false;
      tick(function() {
        called = true;
        done();
      });
      expect(called).to.be.false;
    });
  });
});
