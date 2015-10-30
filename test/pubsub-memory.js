var MemoryPubSub = require('../lib/pubsub/memory');
var PubSub = require('../lib/pubsub');
var expect = require('expect.js');

require('./pubsub')(function(callback) {
  callback(null, MemoryPubSub());
});
require('./pubsub')(function(callback) {
  callback(null, MemoryPubSub({prefix: 'foo'}));
});

describe('PubSub base class', function() {
  it('returns an error if _subscribe is unimplemented', function() {
    var pubsub = new PubSub();
    pubsub.subscribe('x', function(err) {
      expect(err).an(Error);
    });
  });

  it('throws an error if _unsubscribe is unimplemented', function() {
    var pubsub = new PubSub();
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) throw err;
      expect(function() {
        stream.destroy();
      }).throwException();
    });
  });

  it('returns an error if _publish is unimplemented', function() {
    var pubsub = new PubSub();
    pubsub.publish(['x', 'y'], {test: true}, function(err) {
      expect(err).an(Error);
    });
  });
});
