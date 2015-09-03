var PubSub = require('./pubsub');

// In memory pubsub driver for ShareDB
function PubSubMemory(options) {
  if (!(this instanceof PubSubMemory)) return new PubSubMemory(options);
  PubSub.call(this, options);
}
module.exports = PubSubMemory;

PubSubMemory.prototype = Object.create(PubSub.prototype);

PubSubMemory.prototype._subscribe = function(channel, callback) {
  process.nextTick(callback);
};

PubSubMemory.prototype._unsubscribe = function() {};

PubSubMemory.prototype.publish = function(channels, data, callback) {
  var pubsub = this;
  process.nextTick(function() {
    for (var i = 0; i < channels.length; i++) {
      var channel = channels[i];
      if (pubsub.subscribed[channel]) {
        pubsub._emit(channel, data);
      }
    }
  });
};
