var MemoryPubSub = require('../lib/pubsub/memory');
var PubSub = require('../lib/pubsub');
var expect = require('expect.js');

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
      expect(err).an(Error);
      done();
    });
  });

  it('throws an error if _unsubscribe is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      expect(function() {
        stream.destroy();
      }).throwException();
      done();
    });
  });

  it('returns an error if _publish is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub.publish(['x', 'y'], {test: true}, function(err) {
      expect(err).an(Error);
      done();
    });
  });
});
