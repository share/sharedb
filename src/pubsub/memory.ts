import PubSub = require('./index');
import util = require('../util');

/**
 * In-memory ShareDB pub/sub
 *
 * This is a fully functional implementation. Since ShareDB does not require
 * persistence of pub/sub state, it may be used in production environments
 * requiring only a single stand alone server process. Additionally, it is
 * easy to swap in an external pub/sub adapter if/when additional server
 * processes are desired. No pub/sub APIs are adapter specific.
 */
class MemoryPubSub extends PubSub {
  constructor(options) {
    super(options);
  }

  _subscribe(channel, callback) {
    util.nextTick(callback);
  }

  _unsubscribe(channel, callback) {
    util.nextTick(callback);
  }

  _publish(channels, data, callback) {
    var pubsub = this;
    util.nextTick(function() {
      for (var i = 0; i < channels.length; i++) {
        var channel = channels[i];
        if (pubsub.subscribed[channel]) {
          pubsub._emit(channel, data);
        }
      }
      callback();
    });
  }
}

export = MemoryPubSub;
