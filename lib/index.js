var Readable = require('stream').Readable;
var EventEmitter = require('events').EventEmitter;
var readFileSync = require('fs').readFileSync;
var joinPath = require('path').join;
var assert = require('assert');
var isError = require('util');
var deepEquals = require('deep-is');
var redisLib = require('redis');
var arraydiff = require('arraydiff');

var ot = require('./ot');
var rateLimit = require('./ratelimit');

// Load the lua scripts
var scriptsPath = joinPath(__dirname, 'scripts');
var submitCode = readFileSync(joinPath(scriptsPath, 'submit.lua'), 'utf8');
var getOpsCode = readFileSync(joinPath(scriptsPath, 'getOps.lua'), 'utf8');
var setExpireCode = readFileSync(joinPath(scriptsPath, 'setExpire.lua'), 'utf8');
var bulkGetOpsSinceCode = readFileSync(joinPath(scriptsPath, 'bulkGetOpsSince.lua'), 'utf8');

// Export the memory store as livedb.memory
exports.memory = require('./memory');

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
var Livedb = exports.client = function(options) {
  // Allow usage as
  //   var myClient = client(options);
  // or
  //   var myClient = new livedb.client(options);
  if (!(this instanceof Livedb)) return new Livedb(options);

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


  // This is a set of all the outstanding streams that have been subscribed by
  // clients. We need this so we can clean up subscribers properly.
  this.streams = {};
  this.nextStreamId = 0;

  // Emitter for channel messages. Event is the prefixed channel name. Listener is
  // called with (prefixed channel, msg)
  this.subscribers = new EventEmitter();

  var self = this;
  this.redisObserver.on('message', function(channel, msg) {
    self.subscribers.emit(channel, channel, JSON.parse(msg));
  });


  // This function is optional in snapshot dbs, so monkey-patch in a replacement
  // if its missing
  if (this.snapshotDb.bulkGetSnapshot == null) {
    this.snapshotDb.bulkGetSnapshot = function(requests, callback) {
      var results = {};

      var pending = 1;
      var done = function() {
        pending--;
        if (pending === 0) {
          callback(null, results);
        }
      };
      for (var cName in requests) {
        var docs = requests[cName];
        var cResults = results[cName] = {};

        pending += docs.length;

        // Hoisted by coffeescript... clever rabbit.
        var _fn = function(cResults, docName) {
          self.snapshotDb.getSnapshot(cName, docName, function(err, data) {
            if (err) return callback(err);

            if (data) {
              cResults[docName] = data;
            }
            done();
          });
        };
        for (var i = 0; i < docs.length; i++) {
          _fn(cResults, docs[i]);
        }
      }
      done();
    };
  }
};

Livedb.prototype._addStream = function(stream) {
  stream._id = this.nextStreamId++;
  this.streams[stream._id] = stream;
};

Livedb.prototype._removeStream = function(stream) {
  delete this.streams[stream._id];
};


// Redis has different databases, which are namespaced separately. But the
// namespacing is completely ignored by redis's pubsub system. We need to
// make sure our pubsub messages are constrained to the database where we
// published the op.
Livedb.prototype._prefixChannel = function(channel) {
  return (this.redis.selected_db || 0) + ' ' + channel;
};

var getVersionKey = function(cName, docName) {
  return cName+ '.' + docName + ' v';
};

var getOpLogKey = function(cName, docName) {
  return cName + '.' + docName+ ' ops';
};

var getDocOpChannel = function(cName, docName) {
  return cName + '.' + docName;
};

var processRedisOps = function(docV, to, result) {
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

var logEntryForData = function(opData) {
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
    var _ref = [null, to];
    to = _ref[0];
    callback = _ref[1];
  }

  if (to !== null && to >= 0 && from > to)  return callback(null, []);

  if (from === null) return callback('Invalid from field in getOps');

  //console.trace('getOps', getOpLogKey(cName, docName), from, to);
  this._getOps(cName, docName, from, to, callback);
};

Livedb.prototype.publish = function(channel, data) {
  if (data) data = JSON.stringify(data);

  return this.redis.publish(this._prefixChannel(channel), data);
};

// callback called with (err, version, ops, snapshot)
Livedb.prototype.submit =  function(cName, docName, opData, options, callback) {
  // This changed recently. We'll support the old API for now.
  if (typeof options === 'function') {
    var _ref = [{}, options];
    options = _ref[0];
    callback = _ref[1];
  }

  //console.log('submit', opData);

  //options.channelPrefix
  //console.log('submit opdata ', opData);
  var err = ot.checkOpData(opData);

  if (err) return callback(err);

  var transformedOps = [];
  ot.normalize(opData);

  var self = this;

  var retry = function() {
    // Get doc snapshot. We don't need it for transform, but we will
    // try to apply the operation locally before saving it.
    return self.fetch(cName, docName, function(err, snapshot) {
      if (err) return callback(err);
      if (snapshot.v < opData.v) return callback('Invalid version');
      if (opData.v == null) opData.v = snapshot.v;

      var trySubmit = function() {
        // Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
        // transform by.
        return self._atomicSubmit(cName, docName, opData, function(err, result) {
          if (err) return callback(err);

          if (result === 'Transform needed') {
            return self._getOps(cName, docName, opData.v, null, function(err, ops) {
              if (err) return callback(err);
              if (ops.length === 0) return callback('Intermediate operations missing - cannot apply op');

              // There are ops that should be applied before our new operation.
              var op, old;
              for (op in ops) {
                old = ops[op];
                transformedOps.push(old);

                err = ot.transform(snapshot.type, opData, old);

                if (err) return callback(err);

                // If we want to remove the need to @fetch again when we retry, do something
                // like this, but with the original snapshot object:
                //err = ot.apply(snapshot, old);
                //if (err) return callback(err);
              }
              //console.log('retry');
              return retry();
            });
          }

          if (typeof result === 'string') return callback(result);
          // Call callback with op submit version
          //if (snapshotDb.closed) return callback(null, opData.v, transformedOps, snapshot) // Happens in the tests sometimes. Its ok.

          return self._writeOpToLog(cName, docName, opData, function(err) {
            // Its kinda too late for this to error out - we've committed.
            if (err) return callback(err);

            // Update the snapshot for queries
            return self.snapshotDb.writeSnapshot(cName, docName, snapshot, function(err) {
              if (err) return callback(err);

              // And SOLR or whatever. Not entirely sure of the timing here.
              var name, db, message;
              for (name in self.extraDbs) {
                db = self.extraDbs[name];

                if (typeof db.submit === 'function') {
                  db.submit(cName, docName, opData, options, snapshot, this, function(err) {
                    if (err) {
                      message = ['Error updating db ', name, ' ', cName, '.', docName, ' with new snapshot data: '].join('');
                      console.warn(message, err);
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
              return (typeof callback === 'function') ? callback(null, opData.v, transformedOps, snapshot) : void 0;
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

      return trySubmit();
    });
  };
  retry();
};

// Subscribe to a redis pubsub channel and get a nodejs stream out
Livedb.prototype.subscribeChannels =  function(channels, callback) {
  var stream = new Readable({objectMode: true});
  var self = this;

  // This function is for notifying us that the stream is empty and needs data.
  // For now, we'll just ignore the signal and assume the reader reads as fast
  // as we fill it. I could add a buffer in this function, but really I don't think
  // that is any better than the buffer implementation in nodejs streams themselves.
  stream._read = function() {};

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
      return stream.push(data);
    };
  } else {
    listener = function(msgChannel, data) {
      // We shouldn't get messages after unsubscribe, but it's happened.
      if (!open || msgChannel !== self._prefixChannel(channels)) return;
      return stream.push(data);
    };
  }

  stream.destroy = function() {
    if (!open) return;

    stream.push(null);
    open = false;
    self._removeStream(stream);

    self._redisRemoveChannelListeners(channels, listener);

    stream.emit('close');
    stream.emit('end');
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
// with a future v is undefined (because I don't think thats an interesting case).
Livedb.prototype.subscribe = function(cName, docName, v, callback) {
  var opChannel = getDocOpChannel(cName, docName);
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
      callback(null, stream);
    });
  });
};


// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
Livedb.prototype.bulkSubscribe = function(requests, callback) {
  var self = this;
  // So, I'm not sure if this is slow, but for now I'll use
  // subscribeChannels to subscribe to all the channels for all the
  // documents, then make a stream for each document that has been
  // subscribed. It might turn out that the right architecture is to reuse
  // the stream, but filter in ShareJS (or wherever) when things pop out of
  // the stream, but thats more complicated to implement. So fingers crossed
  // that nodejs Stream objects are lightweight.

  var docStreams = {};
  var channels = [];
  var listener = function(channel, msg) {
    if (docStreams[channel] != null) {
      docStreams[channel].push(msg);
    }
  };

  var cName, docName, docs, version;
  for (cName in  requests) {
    docs = requests[cName];
    for (docName in docs) {
      version = docs[docName];
      var channelName = getDocOpChannel(cName, docName);
      var prefixedName = this._prefixChannel(channelName);

      channels.push(channelName);

      // TODO: Also register this stream in the streams set for cleanup.
      var docStream = docStreams[prefixedName] = new Readable({objectMode:true});
      docStream._read = function() {};
      docStream.channelName = channelName;
      docStream.prefixedName = prefixedName;
      docStream.destroy = function() {
        self._removeStream(docStream);
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
      callback(err);
    }
  };

  // Could just use Object.keys(docStreams) here....
  this._redisAddChannelListeners(channels, listener, function  (err) {
    if (err) return onError(err);
    self.bulkGetOpsSince(requests, function(err, ops) {
      if (err) return onError(err);
      // Map from cName -> docName -> stream.
      var result = {};
      var cName, docs, docName, version;
      for (cName in requests) {
        docs = requests[cName];
        result[cName] = {};
        for (docName in docs) {
          version = docs[docName];
          var channelName = getDocOpChannel(cName, docName);
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
  this.snapshotDb.getSnapshot(cName, docName, function(err, snapshot) {
    if (err) return callback(err);

    snapshot = snapshot || {v:0};
    if (snapshot.v == null) return callback('Invalid snapshot data');

    self.getOps(cName, docName, snapshot.v, function(err, results) {
      if (err) return callback(err);
      var i;
      for (i in results) {
        err = ot.apply(snapshot, results[i]);
      }
      // I don't actually care if the caching fails - so I'm ignoring the error callback.
      //
      // We could call our callback immediately without waiting for the
      // cache to be warmed, but that causes basically all the livedb tests
      // to fail. ... Eh.
      self._redisCacheVersion(cName, docName, snapshot.v, function() {
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
Livedb.prototype.bulkFetch =  function(requests, callback) {
  this.snapshotDb.bulkGetSnapshot(requests, function(err, results) {
    if (err) return callback(err);

    // We need to add {v:0} for missing snapshots in the results.
    var cName, docs, i, docName;
    for (cName in requests) {
      docs = requests[cName];
      for (i in docs) {
        docName = docs[i];
        if (results[cName][docName] == null) results[cName][docName] = {v:0};
      }
    }

    callback(null, results);
  });
};

// DEPRECATED - use bulkFetch.
  //
// Bulk fetch documents from the snapshot db. This function assumes that the
// latest version of all the document snaphots are in the snapshot DB - it
// doesn't get any missing operations from the oplog.
Livedb.prototype.bulkFetchCached = function(cName, docNames, callback) {
  var self = this;

  if (this.snapshotDb.getBulkSnapshots) {
    this.snapshotDb.getBulkSnapshots(cName, docNames, function(err, results) {
      if (err) return callback(err);

      // Results is unsorted and contains any documents that exist in the
      // snapshot database.
      var map = {}; // Map from docName -> data

      var i, r;
      for (i in results) {
        map[r.docName] = r;
      }

      var list, j;
      for (j in docNames) {
        list.push(map[docNames[j]] || {v: 0});
      }
      callback(null, list);
    });
  } else {
    // Call fetch on all the documents.
    var results = new Array(docNames.length);
    var pending = docNames.length + 1;
    var abort = false;

    var k;
    for (k in docNames) {
      self.fetch(cName, docNames[k], function(err, data) {
        if (abort) return;
        if (err) {
          abort = true;
          return callback(err);
        }
        results[k] = data;
        pending--;
        if (pending === 0) callback(results);
      });

    }

    pending--;
    if (pending === 0) callback(results);
  }
};

Livedb.prototype.fetchAndSubscribe = function(cName, docName, callback) {
  var self = this;
  this.fetch(cName, docName, function(err, data) {
    if (err) return callback(err);
    self.subscribe(cName, docName, data.v, function(err, stream) {
      callback(err, data, stream);
    });
  });
};


// ------ Queries


Livedb.prototype.queryFetch =  function(cName, query, opts, callback) {
  if (typeof opts === 'function') {
    var _ref = [{}, opts];
    opts = _ref[0];
    callback = _ref[1];
  }

  var db;

  if (opts.backend) {
    if (!this.extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
    db = this.extraDbs[opts.backend];
  } else {
    db = this.snapshotDb;
  }

  db.query(this, cName, query, function(err, resultset) {
    if (err) {
      callback(err);
    } else if (Array.isArray(resultset)) {
      callback(null, resultset);
    } else {
      callback(null, resultset.results, resultset.extra);
    }
  });
};


// For mongo, the index is just the collection itself. For something like
// SOLR, the index refers to the core we're actually querying.
//
// Options can contain:
// backend: the backend to use, or the name of the backend (if the backend
//  is specified in the otherDbs when the livedb instance is created)
// poll: true, false or undefined. Set true/false to force enable/disable
//  polling mode. Undefined will let the database decide.
// shouldPoll: function(collection, docName, opData, index, query) {return true or false; }
//  this is a syncronous function which can be used as an early filter for
//  operations going through the system to reduce the load on the backend.
// pollDelay: Minimum delay between subsequent database polls. This is used
//  to batch updates to reduce load on the database at the expense of
//  liveness.
Livedb.prototype.query =  function(index, query, opts, callback) {

  if (typeof opts === 'function') {
    var _ref = [{}, opts];
    opts = _ref[0];
    callback = _ref[1];
  }

  var db;

  if (opts.backend) {
    if (!this.extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
    db = this.extraDbs[opts.backend];
  } else if (this.snapshotDb.query) {
    db = this.snapshotDb;
  } else {
    return callback('Backend not specified and database does not support queries');
  }
  var poll = opts.poll;
  if (!db.queryDoc) poll = true;
  if (opts.poll === void 0 && db.queryNeedsPollMode) poll = opts.poll = db.queryNeedsPollMode(index, query);

  // Default to 2 seconds
  var delay = typeof opts.pollDelay === 'number' ? opts.pollDelay : 2000;

  // console.log('poll mode:', !!poll);

  var channels = db.subscribedChannels ? db.subscribedChannels(index, query, opts) : [index];

  var self = this;
  // subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
  // so if we get notified about an op here, the document's been saved.
  this.subscribeChannels(channels, function(err, stream) {
    if (err) return callback(err);

    // Issue query on db to get our initial result set.
    // console.log('snapshotdb query', cName, query);
    db.query(self, index, query, function(err, resultset) {
      //console.log('-> pshotdb query', query, resultset);
      if (err) {
        stream.destroy();
        return callback(err);
      }
      var emitter = new EventEmitter();
      emitter.destroy = function() {
        stream.destroy();
      };

      var results, extra;
      if (!Array.isArray(resultset)) {
        // Resultset is an object. It should look like {results:[..], data:....}
        emitter.extra = extra = resultset.extra;
        results = resultset.results;
      } else {
        results = resultset;
      }
      emitter.data = results;

      // Maintain a map from docName -> index for constant time tests
      var docIdx = {};

      var i, d;
      for (i in results) {
        d = results[i];
        d.c = d.c || index;
        var key = d.c + '.' + d.docName;
        docIdx[key] = i;
      }

      if (poll) {
        var runQuery = rateLimit(delay, function() {
          // We need to do a full poll of the query, because the query uses limits or something.
          return db.query(self, index, query, function(err, newResultset) {
            if (err) return emitter.emit('error', new Error(err));

            var newResults;
            if (!Array.isArray(newResultset)) {
              if (newResultset.extra !== void 0) {
                if (!deepEquals(extra, newResultset.extra)) {
                  emitter.emit('extra', newResultset.extra);
                  emitter.extra = extra = newResultset.extra;
                }
              }
              newResults = newResultset.results;
            } else {
              newResults = newResultset;
            }
            var i, r;
            for (i in newResults) {
              r = newResults[i];
              r.c = r.c || index;
            }
            var diff = arraydiff(results, newResults, function(a, b) {
              if (!a || !b) return false;
              return a.docName === b.docName && a.c === b.c;
            });
            if (diff.length) {
              emitter.data = results = newResults;

              var j, data;
              for (j in diff) {
                data = diff[j];
                // ???
                data.type = data.type;
              }
              emitter.emit('diff', diff);
            }
          });
        });
      }

      var f = function() {
        var d;
        while (d = stream.read()) {
          // Collection name.
          d.c = d.channel;

          // We have some data from the channel stream about an updated document.
          //console.log(d.docName, docIdx, results);
          var name = d.c + '.' + d.docName;
          var cachedData = results[docIdx[name]];

          // Ignore ops that are older than our data. This is possible because we subscribe before
          // issuing the query.
          if (cachedData && cachedData.v > d.v) return;

          // Hook here to do syncronous tests for query membership. This will become an important
          // way to speed this code up.
          var modifies = void 0; //snapshotDb.willOpMakeDocMatchQuery(cachedData, query, d.op);

          if (opts.shouldPoll && !opts.shouldPoll(d.c, d.docName, d, index, query)) return;

          // Not sure whether the changed document should be in the result set
          if (modifies === void 0) {
            if (poll) {
              runQuery();
            } else {
              db.queryDoc(self, index, d.c, d.docName, query, function(err, result) {
                if (err) return emitter.emit('error', new Error(err));

                if (result && !cachedData) {
                  // Add doc to the collection. Order isn't important, so
                  // we'll just whack it at the end.
                  result.c = d.c;
                  results.push(result);
                  emitter.emit('diff', [{
                    type:'insert',
                    index:results.length - 1,
                    values:[result]
                  }]);
                  //emitter.emit('add', result, results.length - 1);
                  docIdx[result.c + '.' + result.docName] = results.length - 1;
                } else if (!result && cachedData) {
                  // Remove doc from collection
                  var idx = docIdx[name];
                  delete docIdx[name];
                  //emitter.emit('remove', results[idx], idx);
                  emitter.emit('diff', [{type:'remove', index:idx, howMany:1}]);
                  results.splice(idx, 1);
                  while (idx < results.length) {
                    var r = results[idx++];
                    name = r.c + '.' + r.docName;
                    docIdx[name]--;
                  }
                }
              });
            }
          }
          //if modifies is true and !cachedData?
          // Add document. Not sure how to han
        }

        // for each op in cache + firehose when op not older than query result
        //   check if op modifies collection.
        //     if yes or no: broadcast
        //     if unknown: issue mongo query with {_id:X}

        //console.log data
      };

      f();
      stream.on('readable', f);
      callback(null, emitter);
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

Livedb.prototype.destroy =  function() {
  //snapshotDb.close();
  this.redis.quit();
  this.redisObserver.quit();

  // ... and close any remaining subscription streams.
  var i;
  for (i in this.streams) {
    this.streams[i].destroy();
  }
};



// Redis


// docVersion is optional - if specified, this is set & used if redis doesn't know the doc's version
Livedb.prototype._redisSubmitScript = function(cName, docName, opData, docVersion, callback) {
  this.redis.eval([
    submitCode,
    // num keys
    4,
    // KEYS
    opData.src,
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName),
    this._prefixChannel(getDocOpChannel(cName, docName)),
    // ARGV
    opData.seq,
    opData.v,
    JSON.stringify(logEntryForData(opData)), // oplog entry
    JSON.stringify(opData), // publish entry
    docVersion
  ], callback);
};

// Follows same semantics as getOps elsewhere - returns ops [from, to). May
// not return all operations in this range.
Livedb.prototype._redisGetOps = function(cName, docName, from, to, callback) {
  if (to === null) to = -1;

  if (to >= 0) {
    // Early abort if the range is flat.
    if (from >= to || to === 0) return callback(null, null, []);
    to--;
  }
  //console.log('redisGetOps', from, to);
  var self = this;

  this.redis.eval([
    getOpsCode,
    2,
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName),
    from,
    to
  ], function(err, result) {
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
  this.redis.eval([
    setExpireCode,
    2,
    getVersionKey(cName, docName),
    getOpLogKey(cName, docName),
    v
  ], callback);
};

Livedb.prototype._redisCacheVersion = function(cName, docName, v, callback) {
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

// Wrapper around the oplog to insert versions.
Livedb.prototype._oplogGetOps = function(cName, docName, from, to, callback) {
  this.oplog.getOps(cName, docName, from, to, function(err, ops) {
    if (err) return callback(err);
    if (ops.length && ops[0].v !== from) throw Error('Oplog is returning incorrect ops');

    for (var i = 0; i < ops.length; i++) {
      ops[i].v = from++;
    }

    callback(null, ops);
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
      callback(null, ops);
    } else if (ops.length > 0) {
      // The ops we got from redis are at the end of the list of ops we need.
      self._oplogGetOps(cName, docName, from, ops[0].v, function(err, firstOps) {
        callback(err, err ? null : firstOps.concat(ops));
      });
    } else {
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


// requests is an object from {cName: {docName:v, ...}, ...}. This function
// returns all operations since the requested version for each specified
// document. Calls callback with
// (err, {cName: {docName:[...], docName:[...], ...}}). Results are allowed to
// be missing in the result set. If they are missing, that means there are no
// operations since the specified version. (Ie, its the same as returning an
// empty list. This is the 99% case for this method, so reducing the memory
// usage is nice).
Livedb.prototype.bulkGetOpsSince = function(requests, callback) {
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

  this.redis.eval(redisArgs, function(err, redisResults) {
    if (err) return callback(err);
    if (redisResults.length !== cNames.length) return callback('Invalid data from redis');

    var results = {};
    var pending = 1;
    var done = function() {
      pending--;
      if (pending === 0) callback(null, results);
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

// Internal method for updating the persistant oplog. This should only be
// called after atomicSubmit (above).
Livedb.prototype._writeOpToLog = function(cName, docName, opData, callback) {
  // Shallow copy the important fields from opData
  var entry = logEntryForData(opData);
  entry.v = opData.v; // The oplog API needs the version too.

  var self = this;
  this.oplog.getVersion(cName, docName, function(err, version) {
    if (err) return callback(err);

    if (version < opData.v) {
      //console.log('populating oplog', version, opData.v);
      self._redisGetOps(cName, docName, version, opData.v, function(err, docV, results) {
        if (err) return callback(err);

        results.push(entry);

        var next = function() {
          if (results.length === 0) return callback();

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
    this.redisObserver.subscribe(needsSubscribe, callback);
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

    if (EventEmitter.listenerCount(this.subscribers, channel) == 0) {
      needsUnsubscribe.push(channel);
    }
  }
  if (needsUnsubscribe.length > 0) {
    this.redisObserver.unsubscribe(needsUnsubscribe, callback);
  } else {
    if (callback) callback();
  }
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

