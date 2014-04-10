var Readable = require('stream').Readable;
var assert = require('assert');
var isError = require('util');
var async = require('async');
var redisLib = require('redis');
var EventEmitter = require('events').EventEmitter;
var bulkSubscribe = require('./bulksubscribe');

var SDC;
try {
  // If statsd isn't found, simply disable it.
  SDC = require('statsd-client');
} catch (e) {}

var ot = require('./ot');

// Export the memory store as livedb.memory
exports.memory = require('./memory');
exports.client = Livedb;

// The client is created using either an options object or a database backend
// which is used as both oplog and snapshot.
//
// Eg:
//  var db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var livedb = require('livedb').client(db);
//
// Or using an options object:
//
//  var db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var livedb = require('livedb').client({db:db});
//
// If you want, you can use a different database for both snapshots and operations:
//
//  var snapshotdb = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var oplog = {writeOp:..., getVersion:..., getOps:...};
//  var livedb = require('livedb').client({snapshotDb:snapshotdb, oplog:oplog});
//
// Other options:
//
// - redis:<redis client>. This can be specified if there is any further
//     configuration of redis that you want to perform. The obvious examples of
//     this are when redis is running on a remote machine, redis requires
//     authentication or you want to use something other than redis db 0.
//
// - redisObserver:<redis client>. Livedb actually needs 2 redis connections,
//     because redis doesn't let you use a connection with pubsub subscriptions
//     to edit data. Livedb will automatically try to clone the first connection
//     to make the observer connection, but we can't copy some options. if you
//     want to do anything thats particularly fancy, you should make 2 redis
//     instances and provide livedb with both of them. Note that because redis
//     pubsub messages aren't constrained to the selected database, the
//     redisObserver doesn't need to select the db you have your data in.
//
// - extraDbs:{}  This is used to register extra database backends which will be
//     notified whenever operations are submitted. They can also be used in
//     queries.
//
// - statsd:{}  Options passed to node-statsd-client for statistics. If this is
//     missing, statsd-based logging is disabled.
function Livedb(options) {
  // Allow usage as
  //   var myClient = client(options);
  // or
  //   var myClient = new livedb.client(options);
  if (!(this instanceof Livedb)) return new Livedb(options);

  if (!options) throw new Error('livedb missing database options');

  // Database which stores the documents.
  this.snapshotDb = options.snapshotDb || options.db || options;

  if (!this.snapshotDb.getSnapshot || !this.snapshotDb.writeSnapshot) {
    throw new Error('Missing or invalid snapshot db');
  }

  // Database which stores the operations.
  this.oplog = options.oplog || options.db || options;

  if (!this.oplog.writeOp || !this.oplog.getVersion || !this.oplog.getOps) {
    throw new Error('Missing or invalid operation log');
  }

  // Redis is used for atomic version incrementing, as an operation cache and for pubsub.
  this.redis = options.redis || redisLib.createClient();

  // Redis doesn't allow the same connection to both listen to channels and do
  // operations. We make an extra redis connection for the streams.
  this.redisObserver = options.redisObserver;
  if (!this.redisObserver) {
    // We can't copy the selected db, but pubsub messages aren't namespaced to their db anyway.
    this.redisObserver = redisLib.createClient(this.redis.port, this.redis.host, this.redis.options);
    if (this.redis.auth_path) this.redisObserver.auth(this.redis.auth_pass);
  }
  this.redisObserver.setMaxListeners(0);

  // This contains any extra databases that can be queried & notified when documents change
  this.extraDbs = options.extraDbs || {};

  // Statsd client. Either accept a statsd client directly via options.statsd
  // or accept statsd options via options.statsd and create a statsd client
  // from them.
  if (options.sdc) {
    this.sdc = options.sdc;
  } else if (options.statsd) {
    if (!SDC) throw Error('statsd not found - `npm install statsd` for statsd support');
    this.sdc = new SDC(options.statsd);
    this.closeSdc = true;
  }

  // Some statsd gauges
  this.numStreams = 0;
  this.numSubscriptions = 0;


  // This is a set of all the outstanding streams that have been subscribed by
  // clients. We need this so we can clean up subscribers properly.
  this.streams = {};
  this.nextStreamId = 0;

  // Emitter for channel messages. Event is the prefixed channel name. Listener is
  // called with (prefixed channel, msg)
  this.subscribers = new EventEmitter();

  // We will be registering a lot of events. Surpress warnings.
  this.subscribers.setMaxListeners(0);

  // This will be rewritten when scaling support is added.
  // this.presenceVersion = {};
  // Map from cd -> {v:_, data:_}
  this.presenceCache = {};

  var self = this;
  this.redisObserver.on('message', function(channel, msg) {
    if (self.sdc) self.sdc.increment('livedb.redis.message');
    
    self.subscribers.emit(channel, channel, JSON.parse(msg));
  });



  bulkSubscribe.mixinSnapshotFn(this.snapshotDb);
};


// The ASCII unit separator!
var SEPARATOR = '\x1f';

// Rather than passing around 2 arguments (which results in extra objects in a
// bunch of cases), we're joining the collection & docname together using the
// ASCII unit separator.
Livedb.encodeCD = function(cName, docName) {
  return cName + SEPARATOR + docName;
};
// Returns [cName, docName]
Livedb.decodeCD = function(cd) {
  return cd.split(SEPARATOR);
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
  entry.m = opData.m; // Metadata.
  return entry;
};
Livedb.logEntryForData = logEntryForData;

Livedb.prototype._addStream = function(stream) {
  this.numStreams++;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  stream._id = this.nextStreamId++;
  this.streams[stream._id] = stream;
};

Livedb.prototype._removeStream = function(stream) {
  this.numStreams--;
  if (this.sdc) this.sdc.gauge('livedb.streams', this.numStreams);

  delete this.streams[stream._id];
};

Livedb.prototype._atomicSubmit = function(cName, docName, opData, callback) {
  var self = this;

  this._redisSubmitScript(cName, docName, opData, null, function(err, result) {
    if (err) return callback(err);

    if (result === 'Missing data' || result === 'Version from the future') {
      // The data in redis has been dumped. Fill redis with data from the oplog and retry.
      self.oplog.getVersion(cName, docName, function(err, version) {
        if (err) return callback(err);

        // if (version > 0) {
        //   console.warn('Repopulating redis for ' + cName + '.' + docName + ' ' + opData.v + version, result);
        // }

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
        self._redisSubmitScript(cName, docName, opData, version, callback);
      });
    } else {
      // The result here will contain more errors (for example we might still be at an early version).
      // Thats totally ok.
      callback(null, result);
    }
  });
};

// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops.
Livedb.prototype.getOps = function(cName, docName, from, to, callback) {
  // Make to optional.
  if (typeof to === 'function') {
    callback = to;
    to = null;
  }

  var self = this;

  if (from == null) return callback('Invalid from field in getOps');

  if (to != null && to >= 0 && from > to) return callback(null, []);

  var start = Date.now();
  this._getOps(cName, docName, from, to, function(err, ops) {
    if (self.sdc) self.sdc.timing('livedb.getOps', Date.now() - start);
    callback(err, ops);
  });
};

// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops. Due to certain
// race conditions, its possible that this misses operations at the end of the
// range. Callers have to deal with this case (semantically it should be the
// same as an operation being submitted right after a getOps call)
Livedb.prototype._getOps = function(cName, docName, from, to, callback) {
  //console.log('getOps', from, to)
  var self = this;

  // First try to get the ops from redis.
  this._redisGetOps(cName, docName, from, to, function(err, v, ops) {
    //console.log('redisGetOps ' + from + '-' + to + ' returned ' + 'v ' + (ops ? ops.length : ''));

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
      // Yay!
      if (self.sdc) self.sdc.increment('livedb.getOps.cacheHit');
      callback(null, ops);
    } else if (ops.length > 0) {
      if (self.sdc) self.sdc.increment('livedb.getOps.cacheMissPartial');
      // The ops we got from redis are at the end of the list of ops we need.
      self._oplogGetOps(cName, docName, from, ops[0].v, function(err, firstOps) {
        callback(err, err ? null : firstOps.concat(ops));
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
        callback(null, ops);
      });
    }
  });
};


Livedb.prototype.publish = function(channel, data) {
  if (this.sdc) this.sdc.increment('livedb.redis.publish');

  if (data) data = JSON.stringify(data);
  this.redis.publish(this._prefixChannel(channel), data);
};

function doNothing() {};

// Submit an operation on the named collection/docname. opData should contain a
// {op:}, {create:} or {del:} field. It should probably contain a v: field (if
// it doesn't, it defaults to the current version).
//
// callback called with (err, version, ops, snapshot)
Livedb.prototype.submit = function(cName, docName, opData, options, callback) {
  // Options is optional.
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var start = Date.now();
  
  if (!options) options = {};
  if (!callback) callback = doNothing;

  //console.log('submit', opData);

  //options.channelPrefix
  //console.log('submit opdata ', opData);
  var err = ot.checkOpData(opData);
  if (err) return callback(err);

  ot.normalize(opData);
  var transformedOps = [];

  var self = this;

  var retry = function() {
    // Get doc snapshot. We don't need it for transform, but we will
    // try to apply the operation locally before saving it.
    self.fetch(cName, docName, function(err, snapshot) {
      if (err) return callback(err);

      // always false if opData.v is null (which is valid)
      if (snapshot.v < opData.v) return callback('Invalid version');

      // Version is optional in opData. If its missing, it defaults to the current version.
      if (opData.v == null) opData.v = snapshot.v;

      var trySubmit = function() {
        // Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
        // transform by.
        self._atomicSubmit(cName, docName, opData, function(err, result) {
          if (err) return callback(err);

          var type = snapshot.type;
          if (result === 'Transform needed') {
            if (self.sdc) self.sdc.increment('livedb.submit.transformNeeded');

            self._getOps(cName, docName, opData.v, null, function(err, ops) {
              if (err) return callback(err);
              if (ops.length === 0) return callback('Intermediate operations missing - cannot apply op');

              // There are ops that should be applied before our new operation.
              for (var i = 0; i < ops.length; i++) {
                var old = ops[i];
                transformedOps.push(old);

                err = ot.transform(snapshot.type, opData, old);
                if (err) return callback(err);

                // If we want to remove the need to @fetch again when we retry, do something
                // like this, but with the original snapshot object:
                //err = ot.apply(snapshot, old);
                //if (err) return callback(err);
              }
              retry();
            });

            return;
          }

          // Any other string result is an unrecoverable error. Abort.
          if (typeof result === 'string') return callback(result);

          self._writeOpToLog(cName, docName, opData, function(err) {
            // Its kinda too late for this to error out - we've committed.
            if (err) return callback(err);

            // Update the snapshot for queries
            self.snapshotDb.writeSnapshot(cName, docName, snapshot, function(err) {
              if (err) return callback(err);

              // And SOLR or whatever. Not entirely sure of the timing here.
              for (var name in self.extraDbs) {
                var db = self.extraDbs[name];

                if (db.submit) {
                  db.submit(cName, docName, opData, options, snapshot, self, function(err) {
                    if (err) {
                      console.warn("Error updating db " + name + " " +
                        cName + "." + docName + " with new snapshot data: ", err);
                    }
                  });
                }
              }

              opData.docName = docName;
              // Publish the change to the collection for queries and set
              // the TTL on the document now that it has been written to the
              // oplog.
              self.redis.publish(self._prefixChannel(cName), JSON.stringify(opData));
              self._redisSetExpire(cName, docName, opData.v, function(err) {
                // This shouldn't happen, but its non-fatal. It just means ops won't get flushed from redis.
                if (err) console.error(err);
              });

              // Aaaand success. Call the callback with the final result.
              if (self.sdc) self.sdc.timing('livedb.submit', Date.now() - start);
              self._updateCursors(cName, docName, type, opData);
              callback(null, opData.v, transformedOps, snapshot);
            });
          });
        });
      };

      // If there's actually a chance of submitting, try applying the operation to make sure
      // its valid.
      if (snapshot.v === opData.v) {
        err = ot.apply(snapshot, opData);
        if (err) {
          if (typeof err !== 'string' && !isError(err)) {
            console.warn('INVALID VALIDATION FN!!!!');
            console.warn('Your validation function must return null/undefined, a string or an error object.');
            console.warn('Instead we got', err);
          }
          return callback(err);
        }
      }

      trySubmit();
    });
  };
  retry();
};

// Subscribe to a redis pubsub channel and get a nodejs stream out
Livedb.prototype.subscribeChannels = function(channels, callback) {
  var stream = new Readable({objectMode: true});
  var self = this;

  // This function is for notifying us that the stream is empty and needs data.
  // For now, we'll just ignore the signal and assume the reader reads as fast
  // as we fill it. I could add a buffer in this function, but really I don't think
  // that is any better than the buffer implementation in nodejs streams themselves.
  stream._read = doNothing;

  var open = true;

  // Registered so we can clean up the stream if the livedb instance is destroyed.
  this._addStream(stream);

  var listener;

  if (Array.isArray(channels)) {
    listener = function(msgChannel, data) {
      // Unprefix the channel name
      msgChannel = msgChannel.slice(msgChannel.indexOf(' ') + 1);

      // We shouldn't get messages after unsubscribe, but it's happened.
      if (!open || channels.indexOf(msgChannel) === -1) return;

      // Unprefix database name from the channel and add it to the message.
      data.channel = msgChannel;
      stream.push(data);
    };
  } else {
    listener = function(msgChannel, data) {
      // console.log("listener", msgChannel, data);
      // We shouldn't get messages after unsubscribe, but it's happened.
      if (!open || msgChannel !== self._prefixChannel(channels)) return;

      stream.push(data);
    };
  }

  stream.destroy = function() {
    if (!open) return;

    open = false;
    stream.push(null);
    self._removeStream(stream);

    self._redisRemoveChannelListeners(channels, listener);
    stream.destroy = doNothing;

    stream.emit('close');
  };

  this._redisAddChannelListeners(channels, listener, function(err) {
    if (err) {
      stream.destroy();
      return callback(err);
    }

    callback(null, stream);
  });
};

// Callback called with (err, op stream). v must be in the past or present. Behaviour
// with a future v is undefined. (Don't do that.)
Livedb.prototype.subscribe = function(cName, docName, v, options, callback) {
  // Support old option-less subscribe semantics
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  if (this.sdc) {
    this.sdc.increment('livedb.subscribe');
    this.sdc.increment('livedb.subscribe.raw');
  }

  var opChannel = Livedb.getDocOpChannel(cName, docName);
  var self = this;

  // Subscribe redis to the stream first so we don't miss out on any operations
  // while we're getting the history
  this.subscribeChannels(opChannel, function(err, stream) {
    if (err) callback(err);

    // From here on, we need to call stream.destroy() if there are errors.
    self.getOps(cName, docName, v, function(err, ops) {
      if (err) {
        stream.destroy();
        return callback(err);
      }
      self._packOpStream(v, stream, ops);

      // Better to call fetchPresence here
      var presence;
      if (options.wantPresence) {
        var cd = Livedb.encodeCD(cName, docName);
        presence = self.presenceCache[cd] || {data:{}};
      }
      callback(null, stream, presence.data);
    });
  });
};


// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
Livedb.prototype.bulkSubscribe = function(requests, callback) {
  if (this.sdc) this.sdc.increment('livedb.subscribe.bulk');

  var self = this;
  // So, I'm not sure if this is slow, but for now I'll use subscribeChannels
  // to subscribe to all the channels for all the documents, then make a stream
  // for each document that has been subscribed. It might turn out that the
  // right architecture is to reuse the stream, but filter in ShareJS (or
  // wherever) when things pop out of the stream, but thats more complicated to
  // implement. So fingers crossed that nodejs Stream objects are lightweight.

  var docStreams = {};
  var channels = [];
  var listener = function(channel, msg) {
    if (docStreams[channel]) {
      docStreams[channel].push(msg);
    }
  };

  for (var cName in requests) {
    var docs = requests[cName];
    for (var docName in docs) {
      if (this.sdc) this.sdc.increment('livedb.subscribe');

      var version = docs[docName];
      var channelName = Livedb.getDocOpChannel(cName, docName);
      var prefixedName = this._prefixChannel(channelName);

      channels.push(channelName);

      var docStream = docStreams[prefixedName] = new Readable({objectMode:true});
      docStream._read = doNothing;
      docStream.channelName = channelName;
      docStream.prefixedName = prefixedName;
      docStream.destroy = function() {
        self._removeStream(this);
        delete docStreams[this.prefixedName];
        self._redisRemoveChannelListeners(this.channelName, listener);
      };
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
          var channelName = Livedb.getDocOpChannel(cName, docName);
          var prefixedName = self._prefixChannel(channelName)

          var stream = result[cName][docName] = docStreams[prefixedName];

          self._packOpStream(version, stream, ops[cName][docName]);
        }
      }
      callback(null, result);
    });
  });
};

// Callback called with (err, {v, data})
Livedb.prototype.fetch = function(cName, docName, callback) {
  var self = this;
  var start = Date.now();

  this.snapshotDb.getSnapshot(cName, docName, function(err, snapshot) {
    if (err) return callback(err);

    snapshot = snapshot || {v:0};
    if (snapshot.v == null) return callback('Invalid snapshot data');

    self.getOps(cName, docName, snapshot.v, function(err, results) {
      if (err) return callback(err);

      if (results.length) {
        if (self.sdc) self.sdc.timing('livedb.fetch.catchup', Date.now() - start);

        for (var i = 0; i < results.length; i++) {
          err = ot.apply(snapshot, results[i]);
          if (err) return callback(err);
        }
      }

      // I don't actually care if the caching fails - so I'm ignoring the error callback.
      //
      // We could call our callback immediately without waiting for the
      // cache to be warmed, but that causes basically all the livedb tests
      // to fail. ... Eh.
      self._redisCacheVersion(cName, docName, snapshot.v, function() {
        if (self.sdc) self.sdc.timing('livedb.fetch', Date.now() - start);
        callback(null, snapshot);
      });
    });
  });
};

// requests is a map from collection name -> list of documents to fetch. The
// callback is called with a map from collection name -> map from docName ->
// data.
//
// I'm not getting ops in redis here for all documents - I certainly could.
// But I don't think it buys us anything in terms of concurrency for the extra
// redis calls.
Livedb.prototype.bulkFetch = function(requests, callback) {
  var start = Date.now();
  var self = this;

  this.snapshotDb.bulkGetSnapshot(requests, function(err, results) {
    if (err) return callback(err);

    // We need to add {v:0} for missing snapshots in the results.
    for (var cName in requests) {
      var docs = requests[cName];
      for (var i = 0; i < docs.length; i++) {
        var docName = docs[i];

        if (!results[cName][docName]) results[cName][docName] = {v:0};
      }
    }

    if (self.sdc) self.sdc.timing('livedb.bulkFetch', Date.now() - start);
    callback(null, results);
  });
};

// DEPRECATED - use bulkFetch.
//
// Bulk fetch documents from the snapshot db. This function assumes that the
// latest version of all the document snaphots are in the snapshot DB - it
// doesn't get any missing operations from the oplog.
Livedb.prototype.bulkFetchCached = function(cName, docNames, callback) {
  if (this.sdc) this.sdc.increment('livedb.bulkFetchCached');
  var self = this;

  if (this.snapshotDb.getBulkSnapshots) {
    this.snapshotDb.getBulkSnapshots(cName, docNames, function(err, results) {
      if (err) return callback(err);
      
      // Results is unsorted and contains any documents that exist in the
      // snapshot database.
      var map = {}; // Map from docName -> data
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        map[r.docName] = r;
      }

      var list = [];
      for (i = 0; i < docNames.length; i++) {
        list.push(map[docNames[i]] || {v:0});
      }
      callback(null, list);
    });
  } else {
    // Call fetch on all the documents.
    var results = new Array(docNames.length);
    var pending = docNames.length + 1;
    var abort = false;
    var _fn = function(i) {
      self.fetch(cName, docNames[i], function(err, data) {
        if (abort) return;
        if (err) {
          abort = true;
          return callback(err);
        }
        results[i] = data;
        pending--;
        if (pending === 0) {
          callback(null, results);
        }
      });
    };
    for (i = 0; i < docNames.length; i++) {
      _fn(i);
    }

    pending--;
    if (pending === 0) {
      callback(null, results);
    }
  }
}

Livedb.prototype.fetchAndSubscribe = function(cName, docName, callback) {
  var self = this;
  this.fetch(cName, docName, function(err, data) {
    if (err) return callback(err);
    self.subscribe(cName, docName, data.v, {wantPresence:true}, function(err, stream, presence) {
      callback(err, data, stream, presence);
    });
  });
};

Livedb.prototype.collection = function(cName) {
  return {
    submit: this.submit.bind(this, cName),
    subscribe: this.subscribe.bind(this, cName),
    getOps: this.getOps.bind(this, cName),
    fetch: this.fetch.bind(this, cName),
    //fetchAndObserve: this.fetchAndObserve.bind(this, cName),
    queryFetch: this.queryFetch.bind(this, cName),
    query: this.query.bind(this, cName),
  };
};

Livedb.prototype.destroy = function() {
  //snapshotDb.close();
  this.redis.quit();
  this.redisObserver.quit();

  // ... and close any remaining subscription streams.
  for (var id in this.streams) {
    this.streams[id].destroy();
  }

  if (this.closeSdc) this.sdc.close();
};



// Wrapper around the oplog to insert versions.
Livedb.prototype._oplogGetOps = function(cName, docName, from, to, callback) {
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

// Internal method for updating the persistant oplog. This should only be
// called after atomicSubmit (above).
Livedb.prototype._writeOpToLog = function(cName, docName, opData, callback) {
  // Shallow copy the important fields from opData
  var entry = logEntryForData(opData);
  entry.v = opData.v; // The oplog API needs the version too.

  var self = this;
  if (this.sdc) this.sdc.increment('livedb.db.getVersion');
  this.oplog.getVersion(cName, docName, function(err, version) {
    if (err) return callback(err);

    if (version < opData.v) {
      //console.log('populating oplog', version, opData.v);
      self._redisGetOps(cName, docName, version, opData.v, function(err, docV, results) {
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
      self.oplog.writeOp(cName, docName, entry, function(err) {
        callback(err);
      });
    }
  });
};

// Helper for subscribe & bulkSubscribe to repack the start of a stream given
// potential operations which happened while the listeners were getting
// established
Livedb.prototype._packOpStream = function(v, stream, ops) {
  // Ok, so if there's anything in the stream right now, it might overlap with the
  // historical operations. We'll pump the reader and (probably!) prefix it with the
  // getOps result.
  var d;
  var queue = [];
  while (d = stream.read()) {
    queue.push(d);
  }

  // First send all the operations between v and when we called getOps
  for (var i = 0; i < ops.length; i++) {
    d = ops[i];
    assert.equal(d.v, v);
    v++;
    stream.push(d);
  }
  // Then all the ops between then and now..
  for (i = 0; i < queue.length; i++) {
    d = queue[i];
    if (d.v >= v) {
      assert.equal(d.v, v);
      v++;
      stream.push(d);
    }
  }
};

// Mixin external modules
require('./livedb-redis')(Livedb);
require('./queries')(Livedb);
require('./presence')(Livedb);
bulkSubscribe.mixin(Livedb);
