var redis = require('redis');
var PubSub = require('./pubsub');

// Redis pubsub driver for ShareDB.
//
// The redis driver requires two redis clients (a single redis client can't do
// both pubsub and normal messaging). These clients will be created
// automatically if you don't provide them. We'll clone the first client if you
// don't provide the second one.
function PubSubRedis(options) {
  if (!(this instanceof PubSubRedis)) return new PubSubRedis(options);
  PubSub.call(this, options);
  options || (options = {});

  this.client = options.client;
  if (!this.client) {
    var port = options.port || 6379;
    var host = options.host || '127.0.0.1';
    this.client = redis.createClient(port, host, options);
  }

  // Redis doesn't allow the same connection to both listen to channels and do
  // operations. We make an extra redis connection for subscribing.
  this.observer = options.observer;
  if (!this.observer) {
    // Port and host are stored inside connectionOption object in redis >= 0.12
    // Previously they were stored directly on the redis client itself
    var port = (this.client.connectionOption) ? this.client.connectionOption.port : this.client.port;
    var host = (this.client.connectionOption) ? this.client.connectionOption.host : this.client.host;
    this.observer = redis.createClient(port, host, this.client.options);
  }

  var pubsub = this;
  this.observer.on('message', function(channel, message) {
    var data = JSON.parse(message);
    pubsub._emit(channel, data);
  });
}
module.exports = PubSubRedis;

PubSubRedis.prototype = Object.create(PubSub.prototype);

PubSubRedis.prototype.close = function() {
  this.client.quit();
  this.observer.quit();
  PubSub.prototype.close.call(this);
};

PubSubRedis.prototype._subscribe = function(channel, callback) {
  this.observer.subscribe(channel, callback);
};

PubSubRedis.prototype._unsubscribe = function(channel, callback) {
  this.observer.unsubscribe(channel, callback);
};

PubSubRedis.prototype.publish = function(channels, data, callback) {
  var message = JSON.stringify(data);
  var args = [PUBLISH_SCRIPT, 0, message].concat(channels);
  this.client.eval(args, callback);
};

var PUBLISH_SCRIPT =
  'for i = 2, #ARGV do ' +
    'redis.call("publish", ARGV[i], ARGV[1]) ' +
  'end';
