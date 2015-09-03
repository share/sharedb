var util = require('./util');

function PubSub(options) {
  this.prefix = options && options.prefix;
  this.nextStreamId = 1;
  this.numStreams = 0;
  // Maps channel -> id -> stream
  this.streams = {};
  // State for tracking subscriptions. We track this.subscribed separately from
  // the streams, since the stream gets added synchronously, and the subscribe
  // isn't complete until the callback returns from Redis
  // Maps channel -> true
  this.subscribed = {};
}
module.exports = PubSub;

PubSub.prototype.close = function() {
  for (var channel in this.streams) {
    var map = this.streams[channel];
    for (var id in map) {
      map[id].destroy();
    }
  }
};

PubSub.prototype.subscribe = function(channel, version, callback) {
  if (this.prefix) {
    channel = this.prefix + ' ' + channel;
  }
  channel = this._prefixChannel(channel);
  var stream = this._createStream(channel, version);

  if (this.subscribed[channel]) {
    process.nextTick(function() {
      callback(null, stream);
    });
    return;
  }
  var pubsub = this;
  this._subscribe(channel, function(err) {
    if (err) {
      stream.destroy();
      return callback(err);
    }
    pubsub.subscribed[channel] = true;
    callback(null, stream);
  });
};

PubSub.prototype.publish = function(channels, data, callback) {
  if (this.prefix) {
    for (var i = 0; i < channels.length; i++) {
      channels[i] = this.prefix + ' ' + channels[i];
    }
  }
  this._publish(channels, data, callback);
};

PubSub.prototype._emit = function(channel, data) {
  var channelStreams = this.streams[channel];
  if (channelStreams) {
    for (var id in channelStreams) {
      channelStreams[id].pushOp(data);
    }
  }
};

PubSub.prototype._createStream = function(channel, version) {
  var stream = new util.OpStream(version);
  var pubsub = this;
  stream.once('close', function() {
    pubsub._removeStream(channel, stream);
  });

  this.numStreams++;
  var map = this.streams[channel] || (this.streams[channel] = {});
  stream.id = this.nextStreamId++;
  map[stream.id] = stream;

  return stream;
};

PubSub.prototype._removeStream = function(channel, stream) {
  var map = this.streams[channel];
  if (!map) return;

  this.numStreams--;
  delete map[stream.id];

  // Cleanup if this was the last subscribed stream for the channel
  if (util.hasKeys(map)) return;
  delete this.streams[channel];
  // Synchronously clear subscribed state. We won't actually be unsubscribed
  // until some unkown time in the future. If subscribe is called in this
  // period, we want to send a subscription message and wait for it to
  // complete before we can count on being subscribed again
  delete this.subscribed[channel];

  this._unsubscribe(channel);
};
