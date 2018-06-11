var emitter = require('../emitter');
var OpStream = require('../op-stream');
var ShareDBError = require('../error');
var util = require('../util');

function PubSub(options) {
  if (!(this instanceof PubSub)) return new PubSub(options);
  emitter.EventEmitter.call(this);

  this.prefix = options && options.prefix;
  this.nextStreamId = 1;
  this.streamsCount = 0;
  // Maps channel -> id -> stream
  this.streams = {};
  // State for tracking subscriptions. We track this.subscribed separately from
  // the streams, since the stream gets added synchronously, and the subscribe
  // isn't complete until the callback returns from Redis
  // Maps channel -> true
  this.subscribed = {};

  var pubsub = this;
  this._defaultCallback = function(err) {
    if (err) return pubsub.emit('error', err);
  };
}
module.exports = PubSub;
emitter.mixin(PubSub);

PubSub.prototype.close = function(callback) {
  for (var channel in this.streams) {
    var map = this.streams[channel];
    for (var id in map) {
      map[id].destroy();
    }
  }
  if (callback) process.nextTick(callback);
};

PubSub.prototype._subscribe = function(channel, callback) {
  process.nextTick(function() {
    callback(new ShareDBError(5015, '_subscribe PubSub method unimplemented'));
  });
};

PubSub.prototype._unsubscribe = function(channel, callback) {
  process.nextTick(function() {
    callback(new ShareDBError(5016, '_unsubscribe PubSub method unimplemented'));
  });
};

PubSub.prototype._publish = function(channels, data, callback) {
  process.nextTick(function() {
    callback(new ShareDBError(5017, '_publish PubSub method unimplemented'));
  });
};

PubSub.prototype.subscribe = function(channel, callback) {
  if (!callback) callback = this._defaultCallback;
  if (this.prefix) {
    channel = this.prefix + ' ' + channel;
  }

  var pubsub = this;
  if (this.subscribed[channel]) {
    process.nextTick(function() {
      var stream = pubsub._createStream(channel);
      callback(null, stream);
    });
    return;
  }
  this._subscribe(channel, function(err) {
    if (err) return callback(err);
    pubsub.subscribed[channel] = true;
    var stream = pubsub._createStream(channel);
    callback(null, stream);
  });
};

PubSub.prototype.publish = function(channels, data, callback) {
  if (!callback) callback = this._defaultCallback;
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
      var copy = shallowCopy(data);
      channelStreams[id].pushOp(copy.c, copy.d, copy);
    }
  }
};

PubSub.prototype._createStream = function(channel) {
  var stream = new OpStream();
  var pubsub = this;
  stream.once('close', function() {
    pubsub._removeStream(channel, stream);
  });

  this.streamsCount++;
  var map = this.streams[channel] || (this.streams[channel] = {});
  stream.id = this.nextStreamId++;
  map[stream.id] = stream;

  return stream;
};

PubSub.prototype._removeStream = function(channel, stream) {
  var map = this.streams[channel];
  if (!map) return;

  this.streamsCount--;
  delete map[stream.id];

  // Cleanup if this was the last subscribed stream for the channel
  if (util.hasKeys(map)) return;
  delete this.streams[channel];
  // Synchronously clear subscribed state. We won't actually be unsubscribed
  // until some unkown time in the future. If subscribe is called in this
  // period, we want to send a subscription message and wait for it to
  // complete before we can count on being subscribed again
  delete this.subscribed[channel];

  this._unsubscribe(channel, this._defaultCallback);
};

function shallowCopy(object) {
  var out = {};
  for (var key in object) {
    out[key] = object[key];
  }
  return out;
}
