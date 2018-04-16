
// In-memory ShareDB pub/sub
//
// This is a fully functional implementation. Since ShareDB does not require
// persistence of pub/sub state, it may be used in production environments
// requiring only a single stand alone server process. Additionally, it is
// easy to swap in an external pub/sub adapter if/when additional server
// processes are desired. No pub/sub APIs are adapter specific.

import {PubSub} from "./pubsub";

class MemoryPubSub extends PubSub {


  constructor(options) {
    super(options);
    if (!(this instanceof MemoryPubSub)) return new MemoryPubSub(options);

  }


  public _subscribe(channel, callback) {
    if (callback) process.nextTick(callback);
  };

  public _unsubscribe(channel, callback) {
    if (callback) process.nextTick(callback);
  };

  public _publish(channels, data, callback) {
    var pubsub = this;
    process.nextTick(function () {
      for (var i = 0; i < channels.length; i++) {
        var channel = channels[i];
        if (pubsub.subscribed[channel]) {
          pubsub._emit(channel, data);
        }
      }
      if (callback) callback();
    });
  };

}

module.exports = MemoryPubSub;
