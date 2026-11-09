var emitter = require('../emitter');
var OpStream = require('../op-stream');
var ShareDBError = require('../error');
var util = require('../util');

var ERROR_CODE = ShareDBError.CODES;

function PubSub(options) {
  if (!(this instanceof PubSub)) return new PubSub(options);
  emitter.EventEmitter.call(this);

  this.prefix = options && options.prefix;
  this.nextStreamId = 1;
  this.streamsCount = 0;
  // Maps channel -> id -> stream
  this.streams = Object.create(null);
  // Maps channel -> true
  this.subscribed = Object.create(null);
  // Maps channel -> callbacks waiting on _subscribe
  this._subscribing = Object.create(null);
  // Maps channel -> true while _unsubscribe is in flight
  this._unsubscribing = Object.create(null);

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
  if (callback) util.nextTick(callback);
};

PubSub.prototype._subscribe = function(channel, callback) {
  util.nextTick(function() {
    callback(new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      '_subscribe PubSub method unimplemented'
    ));
  });
};

PubSub.prototype._unsubscribe = function(channel, callback) {
  util.nextTick(function() {
    callback(new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      '_unsubscribe PubSub method unimplemented'
    ));
  });
};

PubSub.prototype._publish = function(channels, data, callback) {
  util.nextTick(function() {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, '_publish PubSub method unimplemented'));
  });
};

PubSub.prototype.subscribe = function(channel, callback) {
  if (!callback) callback = this._defaultCallback;
  if (this.prefix) {
    channel = this.prefix + ' ' + channel;
  }

  if (this.subscribed[channel]) {
    var stream = this._createStream(channel);
    util.nextTick(function() {
      callback(null, stream);
    });
    return;
  }
  if (this._subscribing[channel]) {
    this._subscribing[channel].push(callback);
    return;
  }
  this._subscribing[channel] = [callback];
  if (this._unsubscribing[channel]) return;
  this._startSubscribe(channel);
};

PubSub.prototype._startSubscribe = function(channel) {
  var pubsub = this;
  var callbacks = this._subscribing[channel];
  this._subscribe(channel, function(err) {
    delete pubsub._subscribing[channel];
    if (err) return util.callEach(callbacks, err);
    pubsub.subscribed[channel] = true;
    var streams = callbacks.map(function() {
      return pubsub._createStream(channel);
    });
    callbacks.forEach(function(callback, i) {
      callback(null, streams[i]);
    });
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
      channelStreams[id].pushData(data);
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
  var map = this.streams[channel] || (this.streams[channel] = Object.create(null));
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
  // until some unknown time in the future. If subscribe is called in this
  // period, it waits for the unsubscribe to complete before calling
  // _subscribe, since an adapter may drop a subscription made while an
  // unsubscribe from the same channel is still pending
  delete this.subscribed[channel];

  var pubsub = this;
  this._unsubscribing[channel] = true;
  this._unsubscribe(channel, function(err) {
    delete pubsub._unsubscribing[channel];
    if (pubsub._subscribing[channel]) pubsub._startSubscribe(channel);
    pubsub._defaultCallback(err);
  });
};
