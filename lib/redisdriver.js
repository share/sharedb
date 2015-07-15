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

    var data = JSON.parse(msg);

    var channelStreams = self.streams[channel];
    if (channelStreams) {
      for (var id in channelStreams) {
        channelStreams[id].pushOp(data);
      }
    }
    self.subscribers.emit(channel, channel, data);
  });

  // Emitter for channel messages. Event is the prefixed channel name. Listener is
  // called with (prefixed channel, msg)
  // TODO: This is only being used by the dirty queue now. It could probably
  // be removed and replaced with a simple map that would have less overhead
  this.subscribers = new EventEmitter();
  // Surpress max listener warnings
  this.subscribers.setMaxListeners(0);

  // For keeping track of streams
  this.nextStreamId = 0;
  this.numStreams = 0;
  // Maps channel -> id -> stream
  this.streams = {};

  // State for tracking subscriptions. We track this.subscribed separately from
  // the streams, since the stream gets added synchronously, and the subscribe
  // isn't complete until the callback returns from Redis
  // Maps channel -> true
  this.subscribed = {};
}
module.exports = RedisDriver;

RedisDriver.prototype.distributed = true;

RedisDriver.prototype.destroy = function() {
  if (this.redisObserverCreated) this.redisObserver.quit();

  for (var channel in this.streams) {
    var map = this.streams[channel];
    for (var id in map) {
      map[id].destroy();
    }
  }
}

RedisDriver.prototype._getCollectionChannel = function(cName) {
  return this._prefixChannel(cName);
};

RedisDriver.prototype._getDocChannel = function(cName, docName) {
  return this._prefixChannel(cName + '.' + docName);
};

function getVersionKey(cName, docName) {
  return cName + '.' + docName + ' v';
}

function getOpLogKey(cName, docName) {
  return cName + '.' + docName + ' ops';
}

function getDirtyListKey(name) {
  return name + ' dirty';
}

// It might turn out that the right architecture is to reuse the stream, but
// filter in ShareJS (or wherever) when things pop out of the stream, but that's
// more complicated to implement. Node.js Stream objects are lightweight
// enough--they cost about 340 bytes each.

RedisDriver.prototype._createStream = function(channel, version) {
  var stream = new util.OpStream(version);
  var self = this;
  stream.once('close', function() {
    self._removeStream(channel, stream);
  });

  this.numStreams++;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  var map = this.streams[channel] || (this.streams[channel] = {});
  stream.id = this.nextStreamId++;
  map[stream.id] = stream;

  return stream;
};

RedisDriver.prototype._removeStream = function(channel, stream) {
  var map = this.streams[channel];
  if (!map) return;

  this.numStreams--;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  delete map[stream.id];

  // Cleanup if this was the last subscribed stream for the channel
  if (util.hasKeys(map)) return;
  delete this.streams[channel];
  this._redisUnsubscribe(channel);
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
          // The oplog is basically corrupted - the snapshot database is
          // further in the future than the oplog.
          //
          // In this case, we could write a no-op ramp to the snapshot version,
          // followed by a delete & a create to fill in the missing ops.
          var err = 'Missing oplog data: ' + cName + ' ' + docName +
            ' Version: ' + version + ' Op version: ' + opData.v;
          return callback(err);
        }
        self._redisSubmitScript(cName, docName, opData, dirtyData, version, callbackWrapper);
      });
    } else {
      if (self.sdc) self.sdc.increment('livedb.redis.cacheHit');
      callbackWrapper(null, result);
    }
  });
};

RedisDriver.prototype.postSubmit = function(cName, docName, opData, snapshot, options) {
  opData.collection = cName;
  opData.docName = docName;

  var msg = JSON.stringify(opData);
  var docChannel = this._getDocChannel(cName, docName);
  this.redis.publish(docChannel, msg);

  // Publish the change to the collection name (not the doc name!) for queries.
  if (options && !options.suppressCollectionPublish) {
    var collectionChannel = this._getCollectionChannel(cName);
    this.redis.publish(collectionChannel, msg);
  }

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
    if (ops.length && ops[0].v !== from) {
      var err = 'Oplog missing requested op: ' + cName + ' ' + docName +
        ' From: ' + from + ' To: ' + to + ' First oplog version: ' + ops[0].v;
      return callback(err);
    }

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
    } else {
      self.oplog.writeOp(cName, docName, entry, callback);
    }
  });
};


// *** Subscriptions

RedisDriver.prototype._redisSubscribe = function(channel, callback) {
  var self = this;
  this.redisObserver.subscribe(channel, function(err) {
    if (err) return callback(err);
    self.subscribed[channel] = true;
    callback();
  });
};

RedisDriver.prototype._redisUnsubscribe = function(channel, callback) {
  // Synchronously clear subscribed state, since we'll actually be unsubscribed
  // at some point in the future, but it will be before the callback. If
  // subscribe is called in this period, we want to send a subscription message
  // and wait for it to complete before we can count on being subscribed again
  delete this.subscribed[channel];
  // Send the unsubscribe message to Redis
  this.redisObserver.unsubscribe(channel, callback);
};

// Subscribe to changes on a set of collections. This is used by livedb's
// polling query code.
RedisDriver.prototype.subscribeCollection = function(cName, callback) {
  if (this.sdc) this.sdc.increment('livedb.subscribe.collection');

  // From here on, we need to call stream.destroy() if there are errors
  var channel = this._getCollectionChannel(cName);
  var stream = this._createStream(channel);

  if (this.subscribed[channel]) {
    process.nextTick(function() {
      callback(null, stream);
    });
    return;
  }
  var self = this;
  this._redisSubscribe(channel, function(err) {
    if (err) {
      stream.destroy();
      return callback(err);
    }
    callback(null, stream);
  });
};

// Call back called with (err, op stream). v must be in the past or present. Behaviour
// with a future v is undefined. (Don't do that.)
RedisDriver.prototype.subscribe = function(cName, docName, version, options, callback) {
  if (this.sdc) this.sdc.increment('livedb.subscribe.doc');

  // Subscribe to the stream first so we don't miss out on any operations
  // while we're getting the history
  var channel = this._getDocChannel(cName, docName);
  var stream = this._createStream(channel, version);

  if (this.subscribed[channel]) {
    this._finishSubscribe(stream, cName, docName, version, callback);
    return;
  }
  var self = this;
  this._redisSubscribe(channel, function(err) {
    if (err) {
      stream.destroy();
      return callback(err);
    }
    self._finishSubscribe(stream, cName, docName, version, callback);
  });
};
RedisDriver.prototype._finishSubscribe = function(stream, cName, docName, version, callback) {
  this.getOps(cName, docName, version, null, function(err, ops) {
    if (err) {
      stream.destroy();
      return callback(err);
    }
    stream.pack(version, ops);
    callback(null, stream);
  });
};

// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
RedisDriver.prototype.bulkSubscribe = function(requests, callback) {
  if (this.sdc) this.sdc.increment('livedb.subscribe.bulk');

  // List of Redis channels to subscribe (if any)
  var channels = [];
  // Map from cName -> docName -> stream
  var streams = {};

  for (var cName in requests) {
    var docs = requests[cName];
    var collectionStreams = streams[cName] = {};
    for (var docName in docs) {
      var channel = this._getDocChannel(cName, docName);
      if (!this.subscribed[channel]) {
        channels.push(channel);
      }
      var version = docs[docName];
      collectionStreams[docName] = this._createStream(channel, version);
    }
  }

  if (!channels.length) {
    this._finishBulkSubscribe(streams, requests, callback);
    return;
  }
  // Redis supports sending multiple channels to subscribe in one command,
  // but the node client doesn't handle replies correctly.
  // See https://github.com/mranney/node_redis/issues/577
  var self = this;
  async.each(channels, function(channel, eachCallback) {
    self._redisSubscribe(channel, eachCallback);
  }, function(err) {
    if (err) {
      destroyBulkStreams(streams);
      return callback(err);
    }
    self._finishBulkSubscribe(streams, requests, callback);
  });
};
RedisDriver.prototype._finishBulkSubscribe = function(streams, requests, callback) {
  this.bulkGetOpsSince(requests, function(err, ops) {
    if (err) {
      destroyBulkStreams(streams);
      return callback(err);
    }
    for (var cName in requests) {
      var docs = requests[cName];
      for (var docName in docs) {
        var version = docs[docName];
        var stream = streams[cName][docName];
        stream.pack(version, ops[cName][docName]);
      }
    }
    callback(null, streams);
  });
};
function destroyBulkStreams(streams) {
  for (var cName in streams) {
    var docs = streams[cName];
    for (var docName in docs) {
      docs[docName].destroy();
    }
  }
}

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
            if (err) return callback(err);
            results[cName][docName] = ops;

            // I'm going to do a sneaky cache here if its not in redis.
            self.oplog.getVersion(cName, docName, function(err, version) {
              if (err) return;
              self._redisCacheVersion(cName, docName, version);
            });
            done();
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
    2,
    // KEYS
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName)
  ];

  if (dirtyData) {
    for (var list in dirtyData) {
      args.push(getDirtyListKey(list));
      args[1]++; // num keys
    }
  }

  // ARGV
  args.push.apply(args, [
    opData.v,
    JSON.stringify(logEntryForData(opData)), // oplog entry
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
