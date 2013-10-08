var Readable = require('stream').Readable;
var EventEmitter = require('events').EventEmitter;
var readFileSync = require('fs').readFileSync;
var assert = require('assert');
var isError = require('util');
var deepEquals = require('deep-is');
var redisLib = require('redis');
var arraydiff = require('arraydiff');

var ot = require('./ot');
var rateLimit = require('./ratelimit');

// Load the lua scripts
var submitCode = readFileSync('./scripts/submit.lua').toString();
var getOpsCode = readFileSync('./scripts/getOps.lua').toString();
var setExpireCode = readFileSync('./scripts/setExpire.lua').toString();

// I'm not really sure how the memory store should be exported...
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
exports.client = function (options) {
  // The client object that will be returned a the end.
  var client = {};

  // Database which stores the documents.
  var snapshotDb = options.snapshotDb || options.db || options;

  if (!snapshotDb.getSnapshot || !snapshotDb.writeSnapshot) {
    throw new Error('Missing or invalid snapshot db');
  }

  // Database which stores the operations.
  var oplog = options.oplog || options.db || options

  if (!oplog.writeOp || !oplog.getVersion || !oplog.getOps) {
    throw new Error('Missing or invalid operation log');
  }

  // Redis is used for submitting canonical operations and pubsub.
  var redis = options.redis || redisLib.createClient();

  // Redis doesn't allow the same connection to both listen to channels and do
  // operations. We make an extra redis connection for the streams.
  var redisObserver = options.redisObserver;
  if (!redisObserver) {
    // We can't copy the selected db, but pubsub messages aren't namespaced to their db anyway.
    redisObserver = redisLib.createClient(redis.port, redis.host, redis.options);
    if (redis.auth_path) redisObserver.auth(redis.auth_pass);
  }
  redisObserver.setMaxListeners(0)

  // This contains any extra databases that can be queried & notified when documents change
  var extraDbs = options.extraDbs || {};


  // This is a set of all the outstanding streams that have been subscribed by clients
  var streams = {};
  var nextStreamId = 0;

  // Map from channel name -> number of subscribers. Used for garbage collection
  // - when the count reaches 0, the listener is abandoned.
  var subscribeCounts = {};

  // Redis has different databases, which are namespaced separately. We need to
  // make sure our pubsub messages are constrained to the database where we
  // published the op.
  var prefixChannel = function (channel) {
    return [redis.selected_db || 0, channel].join(' ');
  };

  var getVersionKey = function (cName, docName) {
    return cName+ '.' + docName + ' v';
  };

  var getOpLogKey = function (cName, docName) {
    return cName + '.' + docName+ ' ops';
  };

  var getDocOpChannel = function (cName, docName) {
    return cName + '.' + docName;
  };

  var processRedisOps = function (docV, to, result) {
    //console.log('processRedisOps', to, result);
    // The ops are stored in redis as JSON strings without versions. They're
    // returned with the final version at the end of the lua table.

    // version of the document
    var v = null;

    if (to === -1) {
      v = docV - result.length;
    } else {
      v = to - result.length + 1; // the 'to' argument here is the version of the last op.
    }

    var results = [];

    for (var key in result) {
      var op = JSON.parse(result[key]);
      op.v = v++;
      results.push(op);
    }
    return results;
  };

  var logEntryForData = function (opData) {
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
    entry.m = opData.m // Metadata.
    return entry;
  };

  // docVersion is optional - if specified, this is set & used if redis doesn't know the doc's version
  var redisSubmitScript = function (cName, docName, opData, docVersion, callback) {
    var logEntry = JSON.stringify(logEntryForData(opData));
    var docPubEntry = JSON.stringify(opData) // Publish everything in opdata to the document's channel.

    redis.eval(
      submitCode,
      4, // num keys
      opData.src,
      getVersionKey(cName, docName),
      getOpLogKey(cName, docName),
      prefixChannel(getDocOpChannel cName, docName), // KEYS table
      opData.seq,
      opData.v,
      logEntry,
      docPubEntry,
      docVersion, // ARGV table
      function (err, result) {
        if (err) return callback(err);
        //result = processRedisOps -1, result if Array.isArray result
        callback(err, result);
      });

  var atomicSubmit = function (cName, docName, opData, callback) {
    redisSubmitScript(cName, docName, opData, null, function (err, result) {
      if (err) return callback(err);

      if (result === 'Missing data' || result === 'Version from the future') {
        // The data in redis has been dumped. Fill redis with data from the oplog and retry.
        oplog.getVersion(cName, docName, function (err, version) {
          if (err) return callback(err);

          if (version > 0) {
            console.warn('Repopulating redis for ' + cName + '.' + docName + ' ' + opData.v + version, result);
          }

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
          redisSubmitScript(cName, docName, opData, version, callback);
        } else {
        // The result here will contain more errors (for example we might still be at an early version).
        // Thats totally ok.
        callback(null, result);
    });
  };

  // Follows same semantics as getOps elsewhere - returns ops [from, to). May
  // not return all operations in this range.
  var redisGetOps = function (cName, docName, from, to, callback) {
    if (to === null)  to = -1;

    if (to >= 0) {
      // Early abort if the range is flat.
      if (if from >= to || to == 0) return callback(null, null, []);
      to--;
    }
    //console.log('redisGetOps', from, to);

    redis.eval(getOpsCode, 2, getVersionKey(cName, docName), getOpLogKey(cName, docName), from, to, function (err, result) {
      if (err) return callback(err);
      if (result === null) return callback(null, null, []);  // No data in redis. Punt to the persistant oplog.

      // Version of the document is at the end of the results list.
      var docV = result.pop();
      var ops = processRedisOps(docV, to, result);
      callback(null, docV, ops);
    });
  };

  // After we submit an operation, reset redis's TTL so the data is allowed to expire.
  var redisSetExpire = function (cName, docName, v, callback) {
    redis.eval(setExpireCode, 2, getVersionKey(cName, docName), getOpLogKey(cName, docName), v, callback);
  };

  var redisCacheVersion = function (cName, docName, v, callback) {
    // At some point it'll be worth caching the snapshot in redis as well and
    // checking performance.
    redis.setnx(getVersionKey(cName, docName), v, function (err, didSet) {
      if (err || !didSet) {
        if (typeof callback === 'function') callback(err);
        return;
      }

      // Just in case. The oplog shouldn't be in redis if the version isn't in
      // redis, but whatever.
      redis.del(getOpLogKey(cName, docName));
      redisSetExpire(cName, docName, v, callback);
    });
  };

  // Wrapper around the oplog to insert versions.
  var oplogGetOps = function (cName, docName, from, to, callback) {
    oplog.getOps(cName, docName, from, to, function (err, ops) {
      if (err) return callback(err);
      if (ops.length && ops[0].v !== from) throw new Error('Oplog is returning incorrect ops');

      for (var i in ops) {
        ops[i].v = from++;
      }

      callback(null, ops);
    });
  });

  // Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
  // not defined (null or undefined) then it returns all ops. Due to certain
  // race conditions, its possible that this misses operations at the end of the
  // range. Callers have to deal with this case (semantically it should be the
  // same as an operation being submitted right after a getOps call)
  var getOps = function (cName, docName, from, to, callback) {
    //console.log('getOps', from, to)

    // First try to get the ops from redis.
    redisGetOps(cName, docName, from, to, function (err, v, ops) {
      //console.log('redisGetOps ' + from + '-' + to + ' returned ' + 'v ' + (ops ? ops.length : '');

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

      if ((v !== null && from >= v) || (ops.length > 0 && ops[0].v === from)) {
        // Yay!
        callback(null, ops);
      } else if (ops.length > 0) {
        // The ops we got from redis are at the end of the list of ops we need.
        oplogGetOps(cName, docName, from, ops[0].v, function (err, firstOps) {
          if (err) return callback(err);
          callback(null, firstOps.concat(ops));
        });
      } else {
        // No ops in redis. Just get all the ops from the oplog.
        oplogGetOps(cName, docName, from, to, function (err, ops) {
          if (err) return callback(err);

          // I'm going to do a sneaky cache here if its not in redis.
          if (v === null && to === null) {
            oplog.getVersion(cName, docName, function (err, version) {
              if (err) return;
              redisCacheVersion(cName, docName, version);
            });
          }
          callback(null, ops);
        });
      }
    });
  };

  // Internal method for updating the persistant oplog. This should only be
  // called after atomicSubmit (above).
  var writeOpToLog = function (cName, docName, opData, callback) {
    // Shallow copy the important fields from opData
    var entry = logEntryForData(opData);
    entry.v = opData.v; // The oplog API needs the version too.

    oplog.getVersion(cName, docName, function (err, version) {
      if (err) return callback(err);

      if (version < opData.v) {
        console.log('populating oplog', version, opData.v);
        redisGetOps(cName, docName, version, opData.v, function (err, docV, results) {
          if (err) return callback(err);

          results.push(entry);

          var f = function () {
            if (results.length === 0) return callback();

            oplog.writeOp(cName, docName, results.shift(), function (err) {
              if (err) return callback(err);
              // In a nexttick to prevent stack overflows with syncronous oplog
              // implementations
              process.nextTick(f);
            });
          };
        });
      } else if (version === opData.v) {
        oplog.writeOp(cName, docName, entry, function (err) {
          callback(err);
        });
      }
    });
  };

  // Variant of fetch (below) which doesn't cache the version after fetching.
  // Useful for submit, where we'll be setting the version in the db anyway.
  var fetchNoCache = function (cName, docName, callback) {
    snapshotDb.getSnapshot(cName, docName, function (err, snapshot) {
      if (err) return callback(err);

      snapshot = snapshot || {v: 0};
      if (snapshot.v === null) return callback('Invalid snapshot data');

      client.getOps(cName, docName, snapshot.v, function (err, results) {
        if (err) return callback(err);

        for (var key in results) {
          err = ot.apply(snapshot, results[key]);
        }

        // I don't actually care if the caching fails - so I'm ignoring the error callback.
        //
        // We could call our callback immediately without waiting for the
        // cache to be warmed, but that causes basically all the livedb tests
        // to fail. ... Eh.
        redisCacheVersion(cName, docName, snapshot.v, function () {
          callback(null, snapshot);
        });
      });
    });
  };

  // Public Methods

  client.snapshotDb = snapshotDb;
  client.oplog = oplog;

  // Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
  // not defined (null or undefined) then it returns all ops.
  client.getOps = function (cName, docName, from, to, callback) {
    // Make to optional.
    if (typeof to === 'function') {
      callback = to;
      to = null;
    }

    if (to !== null && to >= 0 && from > to)  return callback(null, []);

    if (from === null) return callback('Invalid from field in getOps');

    //console.trace('getOps', getOpLogKey(cName, docName), from, to);
    getOps(cName, docName, from, to, callback);
  };

  client.publish = function (channel, data) {
    if (data) data = JSON.stringify(data);

    return redis.publish(prefixChannel(channel), data);
  };
  client.submit =  function (cName, docName, opData, options, callback) {
    //console.log('submit', opData);
    // This changed recently. We'll support the old API for now.
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    options = options || {};

    //options.channelPrefix
    //console.log('submit opdata ', opData);
    err = ot.checkOpData(opData);

    if (err) return callback(err);

    ot.normalize(opData);
    var transformedOps = [];

    var retry = function () {
      // Get doc snapshot. We don't need it for transform, but we will
      // try to apply the operation locally before saving it.
      fetchNoCache(cName, docName, function (err, snapshot) {
        return callback? err if err
        return callback? 'Invalid version' if snapshot.v < opData.v
        if (opData === null) opData.v = snapshot.v;

        var trySubmit = function () {
          // Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
          // transform by.
          atomicSubmit(cName, docName, opData, function (err, result) {
            if (err) return callback(err);

            if (result === 'Transform needed') {
              return getOps(cName, docName, opData.v, null, function (err, ops) {
                if (err) return callback(err);
                if (ops.length === 0) return callback('Intermediate operations missing - cannot apply op');

                // There are ops that should be applied before our new operation.
                for (var op in ops) {
                  var old = ops[op];
                  transformedOps.push(old)

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

            writeOpToLog(cName, docName, opData, function (err) {
              // Its kinda too late for this to error out - we've committed.
              if (err) return callback(err);

              // Update the snapshot for queries
              snapshotDb.writeSnapshot(cName, docName, snapshot, function (err) {
                if (err) return callback(err);

                // And SOLR or whatever. Not entirely sure of the timing here.
                for (var name in extraDbs) {
                  var db = extraDbs[name];

                  if (db.submit !== null) {
                    db.submit(cName, docName, opData, options, snapshot, this, function (err) {
                      if (err) {
                        var message = ['Error updating db ', name, ' ', cName, '.', docName, ' with new snapshot data: '].join('');
                        console.warn(message, err);
                      }
                    });
                  }
                }
                opData.docName = docName;
                // Publish the change to the collection for queries and set
                // the TTL on the document now that it has been written to the
                // oplog.
                redis.publish(prefixChannel(cName), JSON.stringify(opData));
                redisSetExpire(cName, docName, opData.v, function (err) {
                  // This shouldn't happen, but its non-fatal. It just means ops won't get flushed from redis.
                  if (err) console.error(err);
                });
                callback(null, opData.v, transformedOps, snapshot);
              });
            });
          });
          // If there's actually a chance of submitting, try applying the operation to make sure
          // its valid.
          if (snapshot.v is opData.v) {
            err = ot.apply(snapshot, opData);
            if (err) {
              if (typeof err !== 'string' && !isError(err)) {
                console.warn 'INVALID VALIDATION FN!!!!'
                console.warn 'Your validation function must return null/undefined, a string or an error object.'
                console.warn 'Instead we got', err
              }
              return callback(err);
            }
          }
        }
        trySubmit();
      });
    }
  };

  // Subscribe to a redis pubsub channel and get a nodejs stream out
  client.subscribeChannels =  function (channels, callback) {
    // TODO: 2 refactors:
    //        - Make the redis observer we use here reusable
    //        - Reuse listens on channels
    var stream = new Readable({objectMode: true});

    // This function is for notifying us that the stream is empty and needs data.
    // For now, we'll just ignore the signal and assume the reader reads as fast
    // as we fill it. I could add a buffer in this function, but really I don't think
    // that is any better than the buffer implementation in nodejs streams themselves.
    stream._read = function () {
      var open = true;

      stream._id = nextStreamId++;
      streams[stream._id] = stream;

      var onMessage = function () {};
      var channelList = [];

      if (Array.isArray(channels)) {
        for (var i in channels) {
          var channel = channels[i];
          channel = channels[i] = prefixChannel(channel);
          subscribeCounts[channel] = (subscribeCounts[channel] || 0) + 1;
        }
        onMessage = function (msgChannel, msg) {
          // We shouldn't get messages after unsubscribe, but it's happened.
          if (!open || channels.indexOf(msgChannel) === -1) return;

          var data = JSON.parse(msg);
          // Unprefix database name from the channel
          data.channel = msgChannel.slice(msgChannel.indexOf(' ') + 1);
          stream.push(data);
        };
        channelList = channels;
      } else {
        channels = prefixChannel(channels);
        subscribeCounts[channels] = (subscribeCounts[channels] || 0) + 1;
        onMessage = function (msgChannel, msg) {
          // We shouldn't get messages after unsubscribe, but it's happened.
          if (!open || msgChannel isnt channels) return;
          var data = JSON.parse(msg);
          stream.push(data);
        };
        channelList = [channels];
      }
      stream.destroy = function () {
        if (!open) return;

        stream.push(null);
        open = false;
        delete streams[stream._id];
        if (Array.isArray(channels)) {
          for (var i in channels) {
            var channel = i;
            if (--subscribeCounts[channel] > 0) continue;
            redisObserver.unsubscribe(channel),
            delete subscribeCounts[channel];
          }
        } else {
          if (! --subscribeCounts[channels] > 0) {
            redisObserver.unsubscribe(channels);
            delete subscribeCounts[channels];
          }
        }
        redisObserver.removeListener('message', onMessage);

        stream.emit('close');
        stream.emit('end');
      }

      redisObserver.on('message', onMessage);
      redisObserver.subscribe.apply(redisObserver, channelList.concat([function(err) {
        if (err) {
          stream.destroy()
          return callback(err);
        }
        callback(null, stream);
      })]));
    };
  };

  // Callback called with (err, op stream). v must be in the past or present. Behaviour
  // with a future v is undefined (because I don't think thats an interesting case).
  client.subscribe = function (cName, docName, v, callback) {
    var opChannel = getDocOpChannel(cName, docName);
    var self = this;

    // Subscribe redis to the stream first so we don't miss out on any operations
    // while we're getting the history
    this._subscribeChannels(opChannel, function (err, stream) {
      if (err) callback(err);

      // From here on, we need to call stream.destroy() if there are errors.
      self.getOps(cName, docName, v, function (err, data) {
        if (err) {
          stream.destroy();
          return callback(err);
        }
        // Ok, so if there's anything in the stream right now, it might overlap with the
        // historical operations. We'll pump the reader and (probably!) prefix it with the
        // getOps result.
        var queue = [];
        var d;
        while (d = stream.read()) {
          queue.push(d);
        }

        callback(null, stream);

        // First send all the operations between v and when we called getOps
        for (var i in data) {
          var d = data[i];
          assert(d.v) === v;
          v++;
          stream.push(d);
        }
        // Then all the ops between then and now..
        for (var j in queue when d.v >= v) {
          var d = queue[j];
          if (!(d.v >= v)) {
            continue;
          }
          assert(d.v === v);
          v++;
          stream.push(d);
        }
      });
    });
  };

  // Callback called with (err, {v, data})
  client.fetch = function (cName, docName, callback) {
    fetchNoCache(cName, docName, function (err, snapshot) {
      if (err) return callback(err);

      // I don't actually care if the caching fails - so I'm ignoring the error callback.
      //
      // We could call our callback immediately without waiting for the
      // cache to be warmed, but that causes basically all the livedb tests
      // to fail. ... Eh. :/
      redisCacheVersion(cName, docName, snapshot.v, function () {
        callback(null, snapshot);
      });
    });

  client.bulkFetchCached = function (cName, docNames, callback) {
    var self = this;

    if (snapshotDb.getBulkSnapshots) {
      snapshotDb.getBulkSnapshots(cName, docNames, function (err, results) {
        if (err) return callback(err);

        // Results is unsorted and contains any documents that exist in the
        // snapshot database.
        var map = {} // Map from docName -> data

        results.forEach(function (r) {
          map[r.docName] = r;
        });

        var list = docNames.map(function (docName) {
          return map[docName] || {v: 0};
        });
        callback(null, list);
      } else {
        // Call fetch on all the documents.
        var results = new Array(docNames.length);
        var pending = docNames.length + 1;
        var abort = false

        docNames.forEach(function (docName, i) {
          self.fetch(cName, docName, function (err, data) {
            if (abort) return;
            if (err) {
              abort = true;
              return callback(err);
            }
            results[i] = data;
            pending--;
            if (pending === 0) callback(results);
          });
        });


        pending--;
        if (pending === 0) callback(results);
      }
    });
  };

  client.fetchAndSubscribe = function (cName, docName, callback) {
    var self = this;
    this.fetch(cName, docName, function (err, data) {
        if (err) return callback(err);
        self.subscribe(cName, docName, data.v, function (err, stream) {
          callback(err, data, stream);
        });
    });
  };


  // ------ Queries


  client.queryFetch =  function (cName, query, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }

    var db;

    if (opts.backend) {
      if (!extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
      db = extraDbs[opts.backend];
    } else {
      db = snapshotDb;
    }

    db.query(this, cName, query, function (err, resultset) {
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
  client.query =  function (index, query, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    var db;
    if (opts.backend) {
      if (!extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
      db = extraDbs[opts.backend]
    } else if (snapshotDb.query) {
      db = snapshotDb
    } else {
      return callback('Backend not specified and database does not support queries');
    }
    var poll = opts.poll;
    if (!db.queryDoc) poll = true;
    if (opts.poll === void 0 && db.queryNeedsPollMode) poll = db.queryNeedsPollMode(index, query);

    // Default to 2 seconds
    var delay = typeof opts.pollDelay === 'number' ? opts.pollDelay : 2000;

    // console.log('poll mode:', !!poll);

    var channels = db.subscribedChannels ? db.subscribedChannels(index, query, opts) : [index];

    var self = this;
    // subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
    // so if we get notified about an op here, the document's been saved.
    this._subscribeChannels(channels, function (err, stream) {
      if (err) return callback(err);

      // Issue query on db to get our initial result set.
      // console.log 'snapshotdb query', cName, query
      db.query(self, index, query, function (err, resultset) {
        //console.log('-> pshotdb query', cName, query, resultset);
        if (err) {
          stream.destroy();
          return callback(err);
        }
        var emitter = new EventEmitter();
        emitter.destroy = function () {
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

        result.forEach(function (d, i) {
          d.c = d.c || index;
          var key = d.c + '.' + d.docName;
          docIdx[key] = i;
        });

        if (poll) {
          var runQuery = rateLimit(delay, function () {
            // We need to do a full poll of the query, because the query uses limits or something.
            return db.query(client, index, query, function (err, newResultset) {
              if (err) return emitter.emit('error', new Error(err));

              var newResults;
              if (!Array.isArray(newResultset)) {
                if (newResultset.extra !== void 0) {
                  if (!deepEquals(extra, newResultset.extra)) {
                    emitter.emit 'extra', newResultset.extra
                    emitter.extra = extra = newResultset.extra
                  }
                }
                newResults = newResultset.results;
              } else {
                newResults = newResultset;
              }
              newResults.forEach(function (r) {
                r.c = r.c || index;
              });

              var diff = arraydiff(results, newResults, function (a, b) {
                if (!a || !b) return false;
                return a.docName === b.docName && a.c === b.c;
              });
              if (diff.length) {
                emitter.data = results = newResults;
                diff.forEach(function (data) {
                  // ???
                  data.type = data.type;
                });
                emitter.emit('diff', diff);
              }
            });
          });
        }

        var f = function () {
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
            if (modifies == void 0) {
              if (poll) {
                runQuery();
              } else {
                db.queryDoc(client, index, d.c, d.docName, query, function (err, result) {
                  if (err) return emitter.emit('error', new Error(err));
                  //console.log('result', result, 'cachedData', cachedData);

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
                    docIdx["#{result.c}.#{result.docName}"] = results.length - 1
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

  client.collection =  function (cName) {
    return {
      submit: function (docName, opData, options, callback)  {
        return client.submit(cName, docName, opData, options, callback);
      },
      subscribe: function (docName, v, callback) {
        return client.subscribe(cName, docName, v, callback);
      },
      getOps: function (docName, from, to, callback) {
        return client.getOps(cName, docName, from, to, callback);
      },
      fetch: function (docName, callback) {
        client.fetch(cName, docName, callback);
      },
      fetchAndObserve: function (docName, callback) {
        client.fetchAndObserve(cName, docName, callback);
      },
      queryFetch: function (query, opts, callback) {
        client.queryFetch(cName, query, opts, callback);
      },
      query: function (query, opts, callback) {
        client.query(cName, query, opts, callback);
      }
    };
  };

  client.destroy =  function () {
    //snapshotDb.close();
    redis.quit();
    redisObserver.quit();

    // ... and close any remaining subscription streams.
    streams.forEach(function (s){
      s.destroy();
    });
  };

  return client;
};