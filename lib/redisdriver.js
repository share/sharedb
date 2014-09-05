var redisLib = require('redis');
var async = require('async');
var EventEmitter = require('events').EventEmitter;
var readFileSync = require('fs').readFileSync;
var joinPath = require('path').join;
var assert = require('assert');

// Load the lua scripts
var scriptsPath = joinPath(__dirname, 'scripts');
var submitCode = readFileSync(joinPath(scriptsPath, 'submit.lua'), 'utf8');
var getOpsCode = readFileSync(joinPath(scriptsPath, 'getOps.lua'), 'utf8');
var setExpireCode = readFileSync(joinPath(scriptsPath, 'setExpire.lua'), 'utf8');
var bulkGetOpsSinceCode = readFileSync(joinPath(scriptsPath, 'bulkGetOpsSince.lua'), 'utf8');

var util = require('./util');

function doNothing() {};

// Redis driver for livedb.
//
// This driver is used to distribute livedb requests across multiple frontend servers.
//
// Initialize the driver by passing in your persistant oplog. Usually this will be the same as your snapshot database - eg:
//
//   var db = livedbMongo(...);
//   var driver = livedb.redisDriver(db);
//   var livedb = livedb.createClient({driver:driver, db:db})
//
// You don't need this if you are only using one server.
//
// The redis driver requires two redis clients (a single redis client can't do
// both pubsub and normal messaging). These clients will be created
// automatically if you don't provide them. We'll clone the first client if you
// don't provide the second one.
function RedisDriver(oplog, client, observer) {
  if (!(this instanceof RedisDriver)) return new RedisDriver(oplog, client, observer);

  // Redis is used for atomic version incrementing, as an operation cache and for pubsub.
  this.redis = client || redisLib.createClient();

  // Persistant oplog.
  this.oplog = oplog;
  if (!oplog.writeOp || !oplog.getVersion || !oplog.getOps) {
    throw new Error('Missing or invalid operation log');
  }

  // Redis doesn't allow the same connection to both listen to channels and do
  // operations. We make an extra redis connection for the streams.
  this.redisObserver = observer;
  if (!this.redisObserver) {
    // We can't copy the selected db, but pubsub messages aren't namespaced to their db anyway.
    // port and host are stored inside connectionOption object in redis >= 0.12. previously they
    // were stored directly on the redis client itself.
    var port = this.redis.connectionOption ? this.redis.connectionOption.port : this.redis.port;
    var host = this.redis.connectionOption ? this.redis.connectionOption.host : this.redis.host;
    this.redisObserver = redisLib.createClient(this.redis.options, port, host);
    if (this.redis.auth_path) this.redisObserver.auth(this.redis.auth_pass);
    this.redisObserverCreated = true;
  }

  var self = this;
  this.redisObserver.on('message', function(channel, msg) {
    if (self.sdc) self.sdc.increment('livedb.redis.message');
    
    self.subscribers.emit(channel, channel, JSON.parse(msg));
  });

  // Emitter for channel messages. Event is the prefixed channel name. Listener is
  // called with (prefixed channel, msg)
  this.subscribers = new EventEmitter();
  // We will be registering a lot of events. Surpress warnings.
  this.subscribers.setMaxListeners(0);


  this.nextStreamId = 0;
  this.numStreams = 0;
  this.streams = {};
}
module.exports = RedisDriver;

RedisDriver.prototype.distributed = true;

RedisDriver.prototype.destroy = function() {
  if (this.redisObserverCreated) this.redisObserver.quit();

  for (var id in this.streams) {
    var stream = this.streams[id];
    stream.destroy();
  }
}

function getDocOpChannel(cName, docName) {
  return cName + '.' + docName;
};

function getVersionKey(cName, docName) {
  return cName+ '.' + docName + ' v';
};

function getOpLogKey(cName, docName) {
  return cName + '.' + docName + ' ops';
};

function getDirtyListKey(name) {
  return name + ' dirty';
};

RedisDriver.prototype._addStream = function(stream) {
  this.numStreams++;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  stream._id = this.nextStreamId++;
  this.streams[stream._id] = stream;
};

RedisDriver.prototype._removeStream = function(stream) {
  this.numStreams--;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  delete this.streams[stream._id];
};

// Redis has different databases, which are namespaced separately. But the
// namespacing is completely ignored by redis's pubsub system. We need to
// make sure our pubsub messages are constrained to the database where we
// published the op.
RedisDriver.prototype._prefixChannel = function(channel) {
  return (this.redis.selected_db || 0) + ' ' + channel;
};

RedisDriver.prototype.atomicSubmit = function(cName, docName, opData, options, callback) {
  if (!callback) throw 'Callback missing in atomicSubmit'
  var self = this;

  // The passed callback function expects (err) where err == 'Transform needed'
  // if we need to transform before applying. The callback passed to
  // _redisSubmitScript takes (err, redisResult). redisResult is an error string
  // passed back from redis (although to make things more complicated, some
  // error strings are actually fine and simply mean redis is missing data).
  //
  // Specifically, result is one of the following:
  //
  // 'Missing data': Redis is not populated for this document. Repopulate and
  //      retry.
  // 'Version from the future': Probably an error. Data in redis has been
  //      dumped. Reload from oplog redis and retry.
  // 'Op already submitted': Return this error back to the user.
  // 'Transform needed': Operation is old. Transform and retry. Retry handled in
  //      livedb proper.
  var callbackWrapper = function(err, result) {
    if (err) return callback(err); // Error communicating with redis
    if (result) return callback(result);

    self._writeOpToLog(cName, docName, opData, callback)
  };

  var dirtyData = options && options.dirtyData;
  this._redisSubmitScript(cName, docName, opData, dirtyData, null, function(err, result) {
    if (err) return callback(err);

    if (result === 'Missing data' || result === 'Version from the future') {
      if (self.sdc) self.sdc.increment('livedb.redis.cacheMiss');
      // The data in redis has been dumped. Fill redis with data from the oplog and retry.
      self.oplog.getVersion(cName, docName, function(err, version) {
        if (err) return callback(err);

        if (version < opData.v) {
          // This is nate's awful hell error state. The oplog is basically
          // corrupted - the snapshot database is further in the future than
          // the oplog.
          //
          // In this case, we should write a no-op ramp to the snapshot
          // version, followed by a delete & a create to fill in the missing
          // ops.
          throw Error('Missing oplog for ' + cName + ' ' + docName);
        }
        self._redisSubmitScript(cName, docName, opData, dirtyData, version, callbackWrapper);
      });
    } else {
      if (self.sdc) self.sdc.increment('livedb.redis.cacheHit');
      callbackWrapper(null, result);
    }
  });
};

RedisDriver.prototype.postSubmit = function(cName, docName, opData, snapshot) {
  opData.docName = docName;

  // Publish the change to the collection name (not the doc name!) for queries.
  this.redis.publish(this._prefixChannel(cName), JSON.stringify(opData));

  // Set the TTL on the document now that it has been written to the oplog.
  this._redisSetExpire(cName, docName, opData.v, function(err) {
    // This shouldn't happen, but its non-fatal. It just means ops won't get flushed from redis.
    if (err) console.trace(err);
  });
};

RedisDriver.prototype.consumeDirtyData = function(listName, options, consumeFn, callback) {
  var limit = options.limit || 1024;
  var wait = options.wait;
  var key = getDirtyListKey(listName);
  var self = this;
  this.redis.lrange(key, 0, limit - 1, function(err, data) {
    if (err) return callback(err);

    var num = data.length;
    if (num === 0) {
      if (!wait) return callback();

      // In this case, we're waiting for data and there's no data to be read.
      // We'll subscribe to the dirty data channel and retry when there's data.
      // I could use some of the fancy subscribe functions below, but we're
      // guaranteed that we won't subscribe to the same channel multiple times
      // anyway, so I can subscribe directly.
      var retried = false;

      self.redisObserver.subscribe(key, function(err) {
        if (err) return callback(err);

        self.subscribers.once(key, function() {
          if (retried) return; else retried = true;
          self.redisObserver.unsubscribe(key, function() {
            self.consumeDirtyData(listName, options, consumeFn, callback);
          });
        });

        // Ok, between when we called lrange and now, there might actually be
        // data added (*tear*).
        self.redis.exists(key, function(err, result) {
          if (err) return callback(err);
          if (result) {
            if (retried) return; else retried = true;
            self.subscribers.removeAllListeners(key);
            self.redisObserver.unsubscribe(key, function() {
              self.consumeDirtyData(listName, options, consumeFn, callback);
            });
          }
        });
      });
      return;
    }

    for (var i = 0; i < data.length; i++) {
      data[i] = JSON.parse(data[i]);
    }
    consumeFn(data, function(err) {
      // Should we do anything else here?
      if (err) return callback(err);

      self.redis.ltrim(key, num, -1);
      callback();
    })
  });
};


// **** Oplog


// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops. Due to certain
// race conditions, its possible that this misses operations at the end of the
// range. Callers have to deal with this case (semantically it should be the
// same as an operation being submitted right after a getOps call)
RedisDriver.prototype.getOps = function(cName, docName, from, to, callback) {
  //console.log('getOps', from, to)
  var self = this;
  // First try to get the ops from redis.
  this._redisGetOps(cName, docName, from, to, function(err, ops, v) {
    // There are sort of three cases here:
    //
    // - Redis has no data at all: v is null
    // - Redis has some of the ops, but not all of them. v is set, and ops
    //   might not contain everything we want.
    // - Redis has all of the operations we need
    if (err) return callback(err);

    // What should we do in this case, when redis returns ops but is missing
    // ops at the end of the requested range? It shouldn't be possible, but
    // we should probably detect that case at least.
    // if (to !== null && ops[ops.length - 1].v !== to)

    if ((v != null && from >= v) || (ops.length > 0 && ops[0].v === from)) {
      // redis has all the ops we wanted.
      if (self.sdc) self.sdc.increment('livedb.getOps.cacheHit');
      callback(null, ops, v);
    } else if (ops.length > 0) {
      // The ops we got from redis are at the end of the list of ops we need.
      if (self.sdc) self.sdc.increment('livedb.getOps.cacheMissPartial');
      self._oplogGetOps(cName, docName, from, ops[0].v, function(err, firstOps) {
        if (err)
          callback(err);
        else
          callback(null, firstOps.concat(ops), v);
      });
    } else {
      if (self.sdc) self.sdc.increment('livedb.getOps.cacheMiss');
      // No ops in redis. Just get all the ops from the oplog.
      self._oplogGetOps(cName, docName, from, to, function(err, ops) {
        if (err) return callback(err);

        // I'm going to do a sneaky cache here if its not in redis.
        if (v == null && to == null) {
          self.oplog.getVersion(cName, docName, function(err, version) {
            if (err) return;
            self._redisCacheVersion(cName, docName, version);
          });
        }
        callback(null, ops, v); // v could be null.
      });
    }
  });
};

// Wrapper around the oplog to insert versions.
RedisDriver.prototype._oplogGetOps = function(cName, docName, from, to, callback) {
  if (to != null && to <= from) return callback(null, []);

  var start = Date.now();
  var self = this;
  this.oplog.getOps(cName, docName, from, to, function(err, ops) {
    if (err) return callback(err);
    if (ops.length && ops[0].v !== from) throw Error('Oplog is returning incorrect ops');

    for (var i = 0; i < ops.length; i++) {
      ops[i].v = from++;
    }

    if (self.sdc) self.sdc.timing('livedb.db.getOps', Date.now() - start);
    callback(null, ops);
  });
};

function logEntryForData(opData) {
  // Only put the op itself and the op's id in redis's log. The version can be inferred via the version field.
  var entry = {};

  if (opData.src) entry.src = opData.src;
  if (opData.seq) entry.seq = opData.seq;
  if (opData.op) {
    entry.op = opData.op;
  } else if(opData.del) {
    entry.del = opData.del;
  } else if (opData.create) {
    entry.create = opData.create;
  }
  if (opData.m != null) entry.m = opData.m; // Metadata.
  return entry;
};

// Internal method for updating the persistant oplog. This should only be
// called after atomicSubmit (above).
RedisDriver.prototype._writeOpToLog = function(cName, docName, opData, callback) {
  // Shallow copy the important fields from opData
  var entry = logEntryForData(opData);
  entry.v = opData.v; // The oplog API needs the version too.

  var self = this;
  if (this.sdc) this.sdc.increment('livedb.db.getVersion');
  this.oplog.getVersion(cName, docName, function(err, version) {
    if (err) return callback(err);
    // Its possible (though unlikely) that ops will be missing from the oplog if the redis script
    // succeeds but the process crashes before the persistant oplog is given the new operations. In
    // this case, backfill the persistant oplog with the data in redis.
    if (version < opData.v) {
      //console.log('populating oplog', version, opData.v);
      self._redisGetOps(cName, docName, version, opData.v, function(err, results, docV) {
        if (err) return callback(err);

        results.push(entry);

        var next = function() {
          if (results.length === 0) return callback();

          if (self.sdc) self.sdc.increment('livedb.db.writeOp');
          self.oplog.writeOp(cName, docName, results.shift(), function(err) {
            if (err) return callback(err);
            // In a nexttick to prevent stack overflows with syncronous oplog
            // implementations
            process.nextTick(next);
          });
        };
        next();
      });
    } else if (version === opData.v) {
      self.oplog.writeOp(cName, docName, entry, callback);
    }
  });
};


// *** Subscriptions

// Subscribe to changes on a set of collections. This is used by livedb's polling query code.
RedisDriver.prototype.subscribeChannels = function(collections, callback) {
  this._subscribeChannels(collections, null, callback);
};

// Subscribe to a redis pubsub channel and get a nodejs stream out
RedisDriver.prototype._subscribeChannels = function(channels, v, callback) {
  var stream = new util.OpStream(v);
  var self = this;

  // Registered so we can clean up the stream if the livedb instance is destroyed.
  this._addStream(stream);

  var listener;

  if (Array.isArray(channels)) {
    listener = function(msgChannel, data) {
      // Unprefix the channel name
      msgChannel = msgChannel.slice(msgChannel.indexOf(' ') + 1);
      if (channels.indexOf(msgChannel) === -1) return;

      // Unprefix database name from the channel and add it to the message.
      data.channel = msgChannel;
      stream.pushOp(data);
    };
  } else {
    listener = function(msgChannel, data) {
      // console.log("listener", msgChannel, data);
      if (msgChannel !== self._prefixChannel(channels)) return;

      // console.log("stream push from publish", data);

      stream.pushOp(data);
    };
  }

  stream.once('close', function() {
    self._removeStream(this);
    self._redisRemoveChannelListeners(channels, listener);
  });

  this._redisAddChannelListeners(channels, listener, function(err) {
    if (err) {
      stream.destroy();
      return callback(err);
    }

    callback(null, stream);
  });
};


// Register a listener (or many listeners) on redis channels. channels can be
// just a single channel or a list. listeners should be either a function or
// an array of the same length as channels.
RedisDriver.prototype._redisAddChannelListeners = function(channels, listeners, callback) {
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
    // each command separately is a workaround.
    // See https://github.com/mranney/node_redis/issues/577
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
RedisDriver.prototype._redisRemoveChannelListeners = function(channels, listeners, callback) {
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

// Callback called with (err, op stream). v must be in the past or present. Behaviour
// with a future v is undefined. (Don't do that.)
RedisDriver.prototype.subscribe = function(cName, docName, v, options, callback) {
  if (this.sdc) {
    this.sdc.increment('livedb.subscribe');
    this.sdc.increment('livedb.subscribe.raw');
  }

  var opChannel = getDocOpChannel(cName, docName);
  var self = this;

  // Subscribe redis to the stream first so we don't miss out on any operations
  // while we're getting the history
  this._subscribeChannels(opChannel, v, function(err, stream) {
    if (err) return callback(err);

    // From here on, we need to call stream.destroy() if there are errors.
    self.getOps(cName, docName, v, null, function(err, ops) {
      if (err) {
        stream.destroy();
        return callback(err);
      }
      stream.pack(v, ops);

      // Better to call fetchPresence here
      var presence;
      if (options.wantPresence) {
        var cd = util.encodeCD(cName, docName);
        presence = self.presenceCache[cd] || {};
      }
      callback(null, stream, presence);
    });
  });
};

// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
RedisDriver.prototype.bulkSubscribe = function(requests, callback) {
  if (this.sdc) this.sdc.increment('livedb.subscribe.bulk');

  var self = this;
  // So, I'm not sure if this is slow, but for now I'll use subscribeChannels to
  // subscribe to all the channels for all the documents, then make a stream for
  // each document that has been subscribed. It might turn out that the right
  // architecture is to reuse the stream, but filter in ShareJS (or wherever)
  // when things pop out of the stream, but thats more complicated to implement.
  // Nodejs Stream objects are lightweight enough - they cost about 340 bytea
  // each.

  var docStreams = {};
  var channels = [];
  var listener = function(channel, msg) {
    if (docStreams[channel]) {
      docStreams[channel].pushOp(msg);
    }
  };

  for (var cName in requests) {
    var docs = requests[cName];
    for (var docName in docs) {
      if (this.sdc) this.sdc.increment('livedb.subscribe');

      var version = docs[docName];
      var channelName = getDocOpChannel(cName, docName);
      var prefixedName = this._prefixChannel(channelName);

      channels.push(channelName);

      var docStream = docStreams[prefixedName] = new util.OpStream(version);
      docStream.channelName = channelName;
      docStream.prefixedName = prefixedName;

      docStream.once('close', function() {
        self._removeStream(this);
        delete docStreams[this.prefixedName];
        self._redisRemoveChannelListeners(this.channelName, listener);
      });
      this._addStream(docStream);
    }
  }
  var onError = function(err) {
    var channel;
    for (channel in docStreams) {
      docStreams[channel].destroy();
    }
    callback(err);
  };

  // Could just use Object.keys(docStreams) here....
  this._redisAddChannelListeners(channels, listener, function(err) {
    if (err) return onError(err);

    self.bulkGetOpsSince(requests, function(err, ops) {
      if (err) return onError(err);

      // Map from cName -> docName -> stream.
      var result = {};
      for (var cName in requests) {
        var docs = requests[cName];
        result[cName] = {};
        for (var docName in docs) {
          var version = docs[docName];
          var channelName = getDocOpChannel(cName, docName);
          var prefixedName = self._prefixChannel(channelName)

          var stream = result[cName][docName] = docStreams[prefixedName];
          stream.pack(version, ops[cName][docName]);
        }
      }
      callback(null, result);
    });
  });
};

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

// ****** Script wrappers / entrypoints.

// Follows same semantics as getOps elsewhere - returns ops [from, to). May
// not return all operations in this range.
// callback(error, version or null, ops);
RedisDriver.prototype._redisGetOps = function(cName, docName, from, to, callback) {
  // TODO: Make this a timing request.
  if (this.sdc) this.sdc.increment('livedb.redis.getOps');
  if (to === null) to = -1;

  if (to >= 0) {
    // Early abort if the range is flat.
    if (from >= to || to === 0) return callback(null, [], null);
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
    if (result === null) return callback(null, [], null);  // No data in redis. Punt to the persistant oplog.

    // Version of the document is at the end of the results list.
    var docV = result.pop();
    var ops = processRedisOps(docV, to, result);
    callback(null, ops, docV);
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
RedisDriver.prototype.bulkGetOpsSince = function(requests, callback) {
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

  this.redis.eval(redisArgs, function(err, redisResults) {
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
};

// After we submit an operation, reset redis's TTL so the data is allowed to expire.
RedisDriver.prototype._redisSetExpire = function(cName, docName, v, callback) {
  if (this.sdc) this.sdc.increment('livedb.redis.setExpire');
  this.redis.eval(
    setExpireCode,
    2,
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName),
    v,
    callback || doNothing); // We need to send a callback here to work around a bug in node-redis 0.9
};

RedisDriver.prototype._redisCacheVersion = function(cName, docName, v, callback) {
  if (this.sdc) this.sdc.increment('livedb.redis.cacheVersion');
  var self = this;

  // At some point it'll be worth caching the snapshot in redis as well and
  // checking performance.
  this.redis.setnx(getVersionKey(cName, docName), v, function(err, didSet) {
    if (err || !didSet) return callback ? callback(err) : null;

    // Just in case. The oplog shouldn't be in redis if the version isn't in
    // redis, but whatever.
    self._redisSetExpire(cName, docName, v, callback);
  });
};

// docVersion is optional - if specified, this is set & used if redis doesn't know the doc's version
RedisDriver.prototype._redisSubmitScript = function(cName, docName, opData, dirtyData, docVersion, callback) {
  if (this.sdc) this.sdc.increment('livedb.redis.submit');

  // Sadly, because of the dirty data needing to edit a handful of keys, we need
  // to construct the arguments list here programatically.

  var args = [
    submitCode,
    // num keys
    4,
    // KEYS
    opData.src,
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName),
    this._prefixChannel(getDocOpChannel(cName, docName)),
  ];

  if (dirtyData) {
    for (var list in dirtyData) {
      args.push(getDirtyListKey(list));
      args[1]++; // num keys
    }
  }

  // ARGV
  args.push.apply(args, [
    opData.seq,
    opData.v,
    JSON.stringify(logEntryForData(opData)), // oplog entry
    JSON.stringify(opData), // publish entry
    docVersion
  ]);

  if (dirtyData) {
    for (var list in dirtyData) {
      args.push(JSON.stringify(dirtyData[list]));
    }
  }

  this.redis.eval(args, callback);
};

RedisDriver.prototype._checkForLeaks = function(allowSubscriptions, callback) {
  if (!allowSubscriptions && this.numStreams) {
    throw Error('Leak detected - still ' + this.numStreams + ' outstanding subscriptions');
  }

  if (Object.keys(this.streams).length !== this.numStreams) {
    console.error('numStreams:', this.numStreams, 'this.streams:', this.streams);
    throw Error('this.numStreams does not match this.streams');
  }

  // We should also check the streams we're actually subscribed to on the redis observer.
  if (callback) callback();
};
