var util = require('../lib/util');
var expect = require('chai').expect;

describe('util', function() {
  describe('nextTick', function() {
    it('uses process.nextTick if present', function(done) {
      expect(process.nextTick).to.be.ok;

      util.nextTick(function(arg1, arg2, arg3) {
        expect(arg1).to.equal('foo');
        expect(arg2).to.equal(123);
        expect(arg3).to.be.undefined;
        done();
      }, 'foo', 123);
    });

    describe('without nextTick', function() {
      var nextTick;

      before(function() {
        nextTick = process.nextTick;
        delete process.nextTick;
      });

      after(function() {
        process.nextTick = nextTick;
      });

      it('uses a ponyfill if process.nextTick is not present', function(done) {
        expect(process.nextTick).to.be.undefined;

        util.nextTick(function(arg1, arg2, arg3) {
          expect(arg1).to.equal('foo');
          expect(arg2).to.equal(123);
          expect(arg3).to.be.undefined;
          done();
        }, 'foo', 123);
      });

      it('calls asynchronously', function(done) {
        var called = false;
        util.nextTick(function() {
          called = true;
          done();
        });
        expect(called).to.be.false;
      });
    });
  });
});
