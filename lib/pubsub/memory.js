var PubSub = require('./index');

// In-memory ShareDB pub/sub
//
// This is a fully functional implementation. Since ShareDB does not require
// persistence of pub/sub state, it may be used in production environments
// requiring only a single stand alone server process. Additionally, it is
// easy to swap in an external pub/sub adapter if/when additional server
// processes are desired. No pub/sub APIs are adapter specific.

function MemoryPubSub(options) {
  if (!(this instanceof MemoryPubSub)) return new MemoryPubSub(options);
  PubSub.call(this, options);
}
module.exports = MemoryPubSub;

MemoryPubSub.prototype = Object.create(PubSub.prototype);

MemoryPubSub.prototype._subscribe = function(channel, callback) {
  process.nextTick(callback);
};

MemoryPubSub.prototype._unsubscribe = function(channel, callback) {
  process.nextTick(callback);
};

MemoryPubSub.prototype._publish = function(channels, data, callback) {
  var pubsub = this;
  process.nextTick(function() {
    for (var i = 0; i < channels.length; i++) {
      var channel = channels[i];
      if (pubsub.subscribed[channel]) {
        pubsub._emit(channel, data);
      }
    }
    callback();
  });
};
