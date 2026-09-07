var EventEmitter = require('../lib/emitter').EventEmitter;
var util = require('../lib/util');
var expect = require('chai').expect;

describe('util.callbackOrEmit', function() {
  var emitter;
  var error;

  beforeEach(function() {
    emitter = new EventEmitter();
    error = new Error('some error');
  });

  it('calls back synchronously with the error', function() {
    var calledWith = 'not called';
    util.callbackOrEmit(emitter, error, function(err) {
      calledWith = err;
    });
    expect(calledWith).to.equal(error);
  });

  it('calls back synchronously when there is no error', function() {
    var calledWith = 'not called';
    util.callbackOrEmit(emitter, null, function(err) {
      calledWith = err;
    });
    expect(calledWith).to.equal(null);
  });

  it('does not emit when a callback is provided', function() {
    var emitted = false;
    emitter.on('error', function() {
      emitted = true;
    });
    util.callbackOrEmit(emitter, error, function() {});
    expect(emitted).to.equal(false);
  });

  it('emits the error when there is no callback', function() {
    var emittedWith = 'not emitted';
    emitter.on('error', function(err) {
      emittedWith = err;
    });
    util.callbackOrEmit(emitter, error);
    expect(emittedWith).to.equal(error);
  });

  it('does nothing when there is no error and no callback', function() {
    var emitted = false;
    emitter.on('error', function() {
      emitted = true;
    });
    util.callbackOrEmit(emitter, null);
    expect(emitted).to.equal(false);
  });
});
