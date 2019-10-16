var MemoryPubSub = require('../lib/pubsub/memory');
var PubSub = require('../lib/pubsub');
var expect = require('chai').expect;

require('./pubsub')(function(callback) {
  callback(null, new MemoryPubSub());
});
require('./pubsub')(function(callback) {
  callback(null, new MemoryPubSub({prefix: 'foo'}));
});

describe('PubSub base class', function() {
  it('returns an error if _subscribe is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub.subscribe('x', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error if _subscribe is unimplemented and callback is not provided', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
    pubsub.subscribe('x');
  });

  it('emits an error if _unsubscribe is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      pubsub.on('error', function(err) {
        expect(err).instanceOf(Error);
        expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
        done();
      });
      stream.destroy();
    });
  });

  it('returns an error if _publish is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', done);
    pubsub.publish(['x', 'y'], {test: true}, function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error if _publish is unimplemented and callback is not provided', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
    pubsub.publish(['x', 'y'], {test: true});
  });

  it('can emit events', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.message).equal('test error');
      done();
    });
    pubsub.emit('error', new Error('test error'));
  });
});
