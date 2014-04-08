// This module contains the redis implementation of 
var EventEmitter = require('events').EventEmitter;
var redisLib = require('redis');
var async = require('async');

var readFileSync = require('fs').readFileSync;
var joinPath = require('path').join;

// Load the lua scripts
var scriptsPath = joinPath(__dirname, 'scripts');
var submitCode = readFileSync(joinPath(scriptsPath, 'submit.lua'), 'utf8');
var getOpsCode = readFileSync(joinPath(scriptsPath, 'getOps.lua'), 'utf8');
var setExpireCode = readFileSync(joinPath(scriptsPath, 'setExpire.lua'), 'utf8');
var bulkGetOpsSinceCode = readFileSync(joinPath(scriptsPath, 'bulkGetOpsSince.lua'), 'utf8');


function processRedisOps(docV, to, result) {
  // The ops are stored in redis as JSON strings without versions. They're
  // returned with the final version at the end of the lua table.

  // version of the document
  var v = (to === -1) ?
    docV - result.length
  :
    to - result.length + 1 // the 'to' argument here is the version of the last op.

  var results = [];

  for (var i = 0; i < result.length; i++) {
    var op = JSON.parse(result[i]);
    op.v = v++;
    results.push(op);
  }
  return results;
};

function getDocOpChannel(cName, docName) {
  return cName + '.' + docName;
};

function getVersionKey(cName, docName) {
  return cName+ '.' + docName + ' v';
};

function getOpLogKey(cName, docName) {
  return cName + '.' + docName+ ' ops';
};

function doNothing() {};

module.exports = function(Livedb) {
  Livedb.getDocOpChannel = getDocOpChannel;
  Livedb.getVersionKey = getVersionKey;
  Livedb.getOpLogKey = getOpLogKey;

  // Redis has different databases, which are namespaced separately. But the
  // namespacing is completely ignored by redis's pubsub system. We need to
  // make sure our pubsub messages are constrained to the database where we
  // published the op.
  Livedb.prototype._prefixChannel = function(channel) {
    return (this.redis.selected_db || 0) + ' ' + channel;
  };

  // Register a listener (or many listeners) on redis channels. channels can be
  // just a single channel or a list. listeners should be either a function or
  // an array of the same length as channels.
  Livedb.prototype._redisAddChannelListeners = function(channels, listeners, callback) {
    // Not the most efficient way to do this, but I bet its not a bottleneck.
    if (!Array.isArray(channels)) channels = [channels];

    if (Array.isArray(listeners)) assert(listeners.length === channels.length);

    var needsSubscribe = [];

    for (var i = 0; i < channels.length; i++) {
      var channel = this._prefixChannel(channels[i]);
      var listener = listeners[i] || listeners;

      if (EventEmitter.listenerCount(this.subscribers, channel) === 0) {
        needsSubscribe.push(channel);
      }
      this.subscribers.on(channel, listener);
    }
    if (needsSubscribe.length > 0) {
      this.numSubscriptions += needsSubscribe.length;
      if (this.sdc) this.sdc.gauge('livedb.redis.subscriptions', this.numSubscriptions);

      // Redis supports sending multiple channels to subscribe in one command,
      // but the node client doesn't handle replies correctly. For now, sending
      // each command separately is a workaround
      var redisObserver = this.redisObserver;
      async.each(needsSubscribe, function(channel, eachCallback) {
        redisObserver.subscribe(channel, eachCallback);
      }, callback);
    } else {
      if (callback) callback();
    }
  };

  // Register the removal of a listener or a list of listeners on the given
  // channel(s).
  Livedb.prototype._redisRemoveChannelListeners = function(channels, listeners, callback) {
    if (!Array.isArray(channels)) channels = [channels];
    if (Array.isArray(listeners)) assert(listeners.length === channels.length);

    var needsUnsubscribe = [];

    for (var i = 0; i < channels.length; i++) {
      var channel = this._prefixChannel(channels[i]);
      var listener = listeners[i] || listeners;

      this.subscribers.removeListener(channel, listener);

      if (EventEmitter.listenerCount(this.subscribers, channel) === 0) {
        needsUnsubscribe.push(channel);
      }
    }

    if (needsUnsubscribe.length > 0) {
      this.numSubscriptions -= needsUnsubscribe.length;
      if (this.sdc) this.sdc.gauge('livedb.redis.subscriptions', this.numSubscriptions);

      // See note about use of async above in subscribe
      var redisObserver = this.redisObserver;
      async.each(needsUnsubscribe, function(channel, eachCallback) {
        redisObserver.unsubscribe(channel, eachCallback);
      }, callback);
    } else {
      if (callback) callback();
    }
  };

  // docVersion is optional - if specified, this is set & used if redis doesn't know the doc's version
  Livedb.prototype._redisSubmitScript = function(cName, docName, opData, docVersion, callback) {
    if (this.sdc) this.sdc.increment('livedb.redis.submit');
    this.redis.eval(
      submitCode,
      // num keys
      4,
      // KEYS
      opData.src,
      getVersionKey(cName, docName),
      getOpLogKey(cName, docName),
      this._prefixChannel(Livedb.getDocOpChannel(cName, docName)),
      // ARGV
      opData.seq,
      opData.v,
      JSON.stringify(Livedb.logEntryForData(opData)), // oplog entry
      JSON.stringify(opData), // publish entry
      docVersion
    , callback);
  };

  // Follows same semantics as getOps elsewhere - returns ops [from, to). May
  // not return all operations in this range.
  Livedb.prototype._redisGetOps = function(cName, docName, from, to, callback) {
    // TODO: Make this a timing request.
    if (this.sdc) this.sdc.increment('livedb.redis.getOps');
    if (to === null) to = -1;

    if (to >= 0) {
      // Early abort if the range is flat.
      if (from >= to || to === 0) return callback(null, null, []);
      to--;
    }
    //console.log('redisGetOps', from, to);
    var self = this;

    this.redis.eval(
      getOpsCode,
      2,
      getVersionKey(cName, docName),
      getOpLogKey(cName, docName),
      from,
      to
    , function(err, result) {
      if (err) return callback(err);
      if (result === null) return callback(null, null, []);  // No data in redis. Punt to the persistant oplog.

      // Version of the document is at the end of the results list.
      var docV = result.pop();
      var ops = processRedisOps(docV, to, result);
      callback(null, docV, ops);
    });
  };

  // After we submit an operation, reset redis's TTL so the data is allowed to expire.
  Livedb.prototype._redisSetExpire = function(cName, docName, v, callback) {
    if (this.sdc) this.sdc.increment('livedb.redis.setExpire');
    this.redis.eval(
      setExpireCode,
      2,
      getVersionKey(cName, docName),
      getOpLogKey(cName, docName),
      v,
      callback || doNothing); // We need to send a callback here to work around a bug in node-redis 0.9
  };

  Livedb.prototype._redisCacheVersion = function(cName, docName, v, callback) {
    if (this.sdc) this.sdc.increment('livedb.redis.cacheVersion');
    var self = this;

    // At some point it'll be worth caching the snapshot in redis as well and
    // checking performance.
    this.redis.setnx(getVersionKey(cName, docName), v, function(err, didSet) {
      if (err || !didSet) return callback ? callback(err) : null;

      // Just in case. The oplog shouldn't be in redis if the version isn't in
      // redis, but whatever.
      self.redis.del(getOpLogKey(cName, docName));
      self._redisSetExpire(cName, docName, v, callback);
    });
  };

  
  // requests is an object from {cName: {docName:v, ...}, ...}. This function
  // returns all operations since the requested version for each specified
  // document. Calls callback with
  // (err, {cName: {docName:[...], docName:[...], ...}}). Results are allowed to
  // be missing in the result set. If they are missing, that means there are no
  // operations since the specified version. (Ie, its the same as returning an
  // empty list. This is the 99% case for this method, so reducing the memory
  // usage is nice).
  Livedb.prototype.bulkGetOpsSince = function(requests, callback) {
    var start = Date.now();
    // Not considering the case where redis has _some_ data but not all of it.
    // The script will just return all the data since the specified version ([]
    // if we know there's no ops) or nil if we don't have enough information to
    // know.

    // First I'll unpack all the things I need to know into these arrays. The
    // indexes all line up. I could use one array of object literals, but I
    // *think* this is faster, and I need the versionKeys, opLogKeys and froms
    // in separate arrays anyway to pass to redis.
    var cNames = [];
    var docNames = [];

    // Its kind of gross to do it like this, but I don't see any other good
    // options. We can't pass JS arrays directly into lua tables in the script,
    // so the arguments list will have to contain a splay of all the values.
    var redisArgs = [bulkGetOpsSinceCode, 0]; // 0 is a sentinal to be replaced with the number of keys

    var froms = [];

    for (var cName in requests) {
      var data = requests[cName];
      for (var docName in data) {
        var version = data[docName];

        cNames.push(cName);
        docNames.push(docName);

        redisArgs.push(getVersionKey(cName, docName));
        redisArgs.push(getOpLogKey(cName, docName));
        froms.push(version);
      }
    }


    // The froms have to come after the version keys and oplog keys because its
    // an argument list rather than a key list.
    redisArgs[1] = redisArgs.length - 2;
    redisArgs = redisArgs.concat(froms);

    var self = this;

    if (this.sdc) this.sdc.increment('livedb.redis.bulkGetOpsSince');

    redisArgs.push(function(err, redisResults) {
      if (err) return callback(err);
      if (redisResults.length !== cNames.length) return callback('Invalid data from redis');

      var results = {};
      var pending = 1;
      var done = function() {
        pending--;
        if (pending === 0) {
          if (self.sdc) self.sdc.timing('livedb.bulkGetOpsSince', Date.now() - start);
          callback(null, results);
        }
      };

      for (var i = 0; i < redisResults.length; i++) {
        var result = redisResults[i];

        var cName = cNames[i];
        var docName = docNames[i];
        var from = froms[i];

        if (results[cName] == null) results[cName] = {};

        if (result === 0) { // sentinal value to mean we should go to the oplog.
          pending++;
          (function(cName, docName, from) {
            // We could have a bulkGetOps in the oplog too, but because we cache
            // anything missing in redis, I'm not super worried about the extra
            // calls here.
            self._oplogGetOps(cName, docName, from, null, function(err, ops) {
              var version;
              if (err) return callback(err);
              results[cName][docName] = ops;

              version = from + ops.length;
              self._redisCacheVersion(cName, docName, version, done);
            });
          })(cName, docName, from);

        } else {
          var v = from;
          // The ops are missing a version field. We'll add it back here. This
          // logic is repeated in processRedisOps, and should be pulled out into
          // a separate function.
          var ops = new Array(result.length);
          for (var j = 0; j < result.length; j++) {
            var op = JSON.parse(result[j]);
            op.v = v++;
            ops[j] = op;
          }
          results[cName][docName] = ops;
        }
      }
      done();
    });
    // Redis 0.9 makes using .apply unnecessary, but whatever.
    this.redis.eval.apply(this.redis, redisArgs);
  };
};