var assert = require('assert');
var util = require('util');
var livedbUtil = require('./util');
var OpStream = livedbUtil.OpStream;

var SDC;
try {
  // If statsd isn't found, simply disable it.
  SDC = require('statsd-client');
} catch (e) {}

var bulkSubscribe = require('./bulksubscribe');

// This is expoesed, but I'm conflicted about whether the ot code should be part
// of the public API. I want to be able to change this code without considering
// it a breaking change.
var ot = exports.ot = require('./ot');

var projections = require('./projections');

// Export the memory store as livedb.memory
exports.memory = require('./memory');
exports.client = Livedb;

exports.inprocessDriver = require('./inprocessdriver');

// The redis driver will be pulled out into its own module in a subsequent livedb version.
try {
  exports.redisDriver = require('./redisdriver');
} catch(e) {
  console.warn('Redis driver disabled. (' + e.message + ')');
}

function SubmitData(cName, docName, opData, submitOptions, projection, callback) {
    this.cName = cName;
    this.docName = docName;
    this.opData = opData;
    this.submitOptions = submitOptions;
    this.callback = callback;
    this.start = Date.now();
    this.projection = projection;
    this.transformedOps = [];
    // There's an awful state that should never happen (but did happen to us
    // recently) where a driver knows there are more ops for a document, but the
    // ops don't seem to exist anywhere. In this case, we need to make sure we
    // don't end up in an infinite retry loop.
    this.expectTransform = false;
}

function doNothing() {};

// A livedb instance is configured with two parameters:
//
// - A snapshot database, which is the database that stores document objects.
//   For example, an instance of livedb-mongo.
//
// - A driver. The driver is used to communicate with other instances of livedb
//   running on other frontend servers. The driver makes commits atomic and
//   publishes operations. For example, an instance of the redis driver. If you
//   only have one frontend server, you can use the inprocess driver, which turns
//   off all messaging. (This is the default if you do not specify a driver.)
//
//   The driver in turn needs access to an oplog, where it stores historical
//   operations. Often you'll use the same database to store snapshots and
//   operations - in which case, you can often re-use your snapshot database
//   instance here. The livedb-mongo driver supports this.
//
// The livedb client is created using either an options object or a database
// backend which is used as both oplog and snapshot.
//
// Eg:
//  var db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var backend = livedb.client(db);
//
// Or using an options object:
//
//  var db = ...
//  var backend = livedb.client({db:db});
//
// This is a shorthand for:
//
//  var db = ...
//  var backend = livedb.client({snapshotDb:db, driver:livedb.inprocessDriver(db)}
//
// If you want, you can use a different database for both snapshots and operations:
//
//  var snapshotdb = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var oplog = {writeOp:..., getVersion:..., getOps:...};
//  var backend = livedb.client({snapshotDb:snapshotdb, oplog:oplog});
//
// .. Which is a shorthand for:
//
//  var backend = livedb.client({snapshotDb:snapshotdb, driver:livedb.inprocessDriver(oplog)});
//
//
// Livedb can work in a distributed environment by using a distributed driver
// (like the redis driver). You can instantiate it like this:
//
//  var driver = livedb.redisDriver(db);
//  var livedb = livedb.createClient({db:db, driver:driver})
//
//
// Other options:
//
// - extraDbs:{}  This is used to register extra database backends which will be
//     notified whenever operations are submitted. They can also be used in
//     queries.
//
// - statsd:{}  Options passed to node-statsd-client for statistics. If this is
//     missing, statsd-based logging is disabled.
//
// - suppressCollectionPublish  Determines whether to suppress publishing of submitted operations
//     to collections.
function Livedb(options) {
  // Allow usage as
  //   var myClient = client(options);
  // or
  //   var myClient = new livedb.client(options);
  if (!(this instanceof Livedb)) return new Livedb(options);

  if (!options) throw new Error('livedb missing database options');

  if (options.redis)
    throw Error('If you want to use redis, you need to instantiate the redis driver separately and provide it to livedb' +
       ' via driver:livedb.redisDriver(db, redis, redisObserver');

  // Database which stores the documents.
  this.snapshotDb = options.snapshotDb || options.db || options;

  if (!this.snapshotDb.getSnapshot || !this.snapshotDb.writeSnapshot) {
    throw new Error('Missing or invalid snapshot db');
  }

  this.driver = options.driver || require('./inprocessdriver')(options.oplog || options.db || options);

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
  if (this.sdc && !this.driver.sdc) {
    this.driver.sdc = this.sdc;
  }

  // this.onOp = this.onOp.bind(this);
  bulkSubscribe.mixinSnapshotFn(this.snapshotDb);

  // Map from projected collection -> {type, fields}
  this.projections = {};

  this.getDirtyDataPre = options.getDirtyDataPre || doNothing;
  this.getDirtyData = options.getDirtyData || doNothing;

  this.suppressCollectionPublish = !!options.suppressCollectionPublish;
};

Livedb.prototype.addProjection = function(projName, cName, type, fields) {
  if (this.projections[projName]) throw Error("Projection " + projName + " already exists");

  for (var k in fields) {
    if (fields[k] !== true) {
      throw Error("Invalid field " + k +
        " - fields must be {'somekey':true}. Subfields not currently supported.");
    }
  }

  this.projections[projName] = {
    target: cName,
    type: ot.normalizeType(type),
    fields: fields
  };
};

// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops.
Livedb.prototype.getOps = function(cName, docName, from, to, callback) {
  // This function is basically just a fancy wrapper for driver.getOps(). Before
  // calling into the driver, it cleans up the input a little.

  // Make 'to' field optional.
  if (typeof to === 'function') {
    callback = to;
    to = null;
  }

  var self = this;

  if (from == null) return callback('Invalid from field in getOps');

  if (to != null && to >= 0 && from > to) return callback(null, []);

  var start = Date.now();

  var projection = this.projections[cName];
  var c = projection ? projection.target : cName;

  this.driver.getOps(c, docName, from, to, function(err, ops) {
    if (self.sdc) self.sdc.timing('livedb.getOps', Date.now() - start);

    // Interestingly, this will filter ops for other types as if they were the projected type. This
    // is a bug, but it shouldn't cause any problems for now. I'll have to revisit this
    // implementation when we add support for projections on other types.
    if (ops && projection) {
      for (var i = 0; i < ops.length; i++) {
        ops[i] = projections.projectOpData(projection.type, projection.fields, ops[i]);
      }
    }
    callback(err, ops);
  });
};

// Submit an operation on the named collection/docname. opData should contain a
// {op:}, {create:} or {del:} field. It should probably contain a v: field (if
// it doesn't, it defaults to the current version).
//
// callback called with (err, version, ops, snapshot)
Livedb.prototype.submit = function(cName, docName, opData, submitOptions, callback) {
  // Options is optional.
  if (typeof submitOptions === 'function') {
    callback = submitOptions;
    submitOptions = {};
  }

  if (!submitOptions) submitOptions = {};
  if (!callback) callback = doNothing;

  var err = ot.checkOpData(opData);
  if (err) return callback(err);

  ot.normalize(opData);

  // If its a projection, check the op with the projection and rewrite the call into a call against
  // the backing collection.
  var projection = this.projections[cName];
  if (projection) cName = projection.target;

  var submitData = new SubmitData(
    cName,
    docName,
    opData,
    submitOptions,
    projection,
    callback
  );

  this._trySubmit(submitData);
};

Livedb.prototype._trySubmit = function(submitData) {
  var self = this;
  var opData = submitData.opData;

  // First we'll get a doc snapshot. This wouldn't be necessary except that
  // we need to check that the operation is valid against the current
  // document before accepting it.
  this._lazyFetch(submitData.cName, submitData.docName, function(err, snapshot) {
    if (err) return submitData.callback(err);

    // Get all operations that might be relevant. We'll float the snapshot
    // and the operation up to the most recent version of the document, then
    // try submitting.
    // If an incoming create operation, get the first op only, so that we can
    // check if it was a resubmission of the incoming op and return an
    // 'Op already submitted' error, which is expected during normal operation
    // and is absorbed silently in the client
    var from = (opData.create) ? 0 :
      (opData.v != null && opData.v < snapshot.v) ? opData.v :
      snapshot.v;
    var to = (opData.create) ? 1 : null;
    self.driver.getOps(submitData.cName, submitData.docName, from, to, function(err, ops) {
      if (err) return submitData.callback(err);

      if (ops.length && self.sdc)
        self.sdc.increment('livedb.submit.transformNeeded');

      if (submitData.expectTransform && ops.length === 0) {
        console.warn("ERROR: CORRUPT DATA DETECTED in document " + submitData.cName + '.' + submitData.docName);
        console.warn("If you're using redis, delete data for document. "
          + "Please file an issue if you can recreate this state reliably.");
        submitData.callback('Internal data corruption - cannot submit');
        return;
      }

      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];

        if (opData.src && opData.src === op.src && opData.seq === op.seq) {
          // The op has already been submitted. There's a variety of ways
          // this can happen. Its important we don't transform it by itself
          // & submit again.
          submitData.callback('Op already submitted');
          return;
        }

        // Bring both the op and the snapshot up to date. At least one of
        // these two conditionals should be true.
        if (snapshot.v === op.v) {
          err = ot.apply(snapshot, op);
          if (err) return submitData.callback(err);
        }
        if (opData.v === op.v) {
          submitData.transformedOps.push(op);
          err = ot.transform(snapshot.type, opData, op);
          if (err) return submitData.callback(err);
        }
      }

      // Setting the version here has ramifications if we have to retry -
      // we'll transform by any new operations which hit from this point on.
      // In reality, it shouldn't matter. But its important to know that even
      // if you pass a null version into submit, its still possible for
      // transform() to get called.
      if (opData.v == null)
        opData.v = snapshot.v;
      else if (opData.v !== snapshot.v) {
        submitData.callback('Invalid opData version');
        return;
      }

      var type = snapshot.type;

      // We now have the type. If we're being projected, verify that the op is allowed.
      if (submitData.projection && !projections.isOpDataAllowed(type, submitData.projection.fields, opData)) {
        submitData.callback('Operation invalid in projected collection');
        return;
      }

      // Get the pre-apply dirty list data. This is a map from dirty list ->
      // dirty list data blob.
      var dirtyData = self.getDirtyDataPre(submitData.cName, submitData.docName, opData, snapshot);

      // Ok, now we can try to apply the op.
      err = ot.apply(snapshot, opData);
      if (err) {
        if (typeof err !== 'string' && !util.isError(err)) {
          console.warn('validation function must return falsy, string or an error object.');
          console.warn('Instead we got', err);
        }

        submitData.callback(err);
        return;
      }

      var dirtyDataPost = self.getDirtyData(submitData.cName, submitData.docName, opData, snapshot);

      if (dirtyDataPost) {
        if (dirtyData) {
          // Merge. Its invalid to output data for the same dirty list in both
          // places, so I'm just going to overwrite all fields here.
          for (var k in dirtyDataPost)
            dirtyData[k] = dirtyDataPost[k];
        } else {
          dirtyData = dirtyDataPost;
        }
      }

      submitData.submitOptions.dirtyData = dirtyData;

      // Great - now we're in the situation that we can actually submit the
      // operation to the database. If this method succeeds, it should
      // update any persistant oplogs before calling the callback to tell us
      // about the successful commit. I could make this API more
      // complicated, enabling the function to return actual operations and
      // whatnot, but its quite rare to actually need to transform data on
      // the server at this point.
      self.driver.atomicSubmit(submitData.cName, submitData.docName, opData, submitData.submitOptions, function(err) {
        if (err === 'Transform needed') {
          // Between our fetch and our call to atomicSubmit, another client
          // submitted an operation. This should be pretty rare. Calling
          // _trySubmit() here will re-fetch the snapshot again (not necessary),
          // but its a rare enough case that its not worth optimizing.
          submitData.expectTransform = true;
          // Callstack could potentially be very large, so let's clean it up.
          process.nextTick(function() {
            self._trySubmit(submitData);
          });
          return;
        } else if (err) {
          submitData.callback(err);
          return;
        }
        self._writeSnapshotAfterSubmit(submitData.cName, submitData.docName, snapshot, opData, submitData.submitOptions, function(err) {
          // What do we do if the snapshot write fails? We've already
          // committed the operation - its done and dusted. We probably
          // shouldn't re-run polling queries now. Really, no matter what
          // we do here things are going to be a little bit broken,
          // depending on the behaviour we trap in finish.

          // Its sort of too late to error out if the snapshotdb can't
          // take our op - the op has been commited.

          // postSubmit is for things like publishing the operation over
          // pubsub. We should probably make this asyncronous.

          var postSubmitOptions = {
            suppressCollectionPublish: self.suppressCollectionPublish
          };
          if (self.driver.postSubmit) self.driver.postSubmit(submitData.cName, submitData.docName, opData, snapshot, postSubmitOptions);

          if (self.sdc) self.sdc.timing('livedb.submit', Date.now() - submitData.start);

          submitData.callback(err, snapshot.v - 1, submitData.transformedOps, snapshot);
        });
      });
    });
  });
};

Livedb.prototype._writeSnapshotAfterSubmit = function(cName, docName, snapshot, opData, options, callback) {
  var self = this;

  this.snapshotDb.writeSnapshot(cName, docName, snapshot, function(err) {
    if (err) return callback(err);

    // For queries.
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

    // It actually might make sense to hold calling the callback until after
    // all the database indexes have been updated. It might stop some race
    // conditions around external indexes.
    callback();
  });
};

Livedb.prototype.consumeDirtyData = function(listName, options, consumeFn, callback) {
  // This is just a wrapper around the driver's method with the same name.
  if (typeof options === 'function') {
    callback = consumeFn;
    consumeFn = options;
  }

  // Options are currently unused anyway...
  options = options || {};

  this.driver.consumeDirtyData(listName, options, consumeFn, callback);
};

function wrapProjectedStream(inStream, projection) {
  // I don't like the Writable interface in node streams, so I'm not using transform streams.

  // Note that we aren't passing a filter version into the stream. This is because the inStream
  // should already be ordering / filtering operations based on the version and we don't need to
  // repeat that work. (And weirdly if we pass in inStream._v, some tests fail).
  var stream = new OpStream();
  stream.once('close', function() { // triggered on stream.destroy().
    inStream.destroy();
  });

  function pump() {
    var data;
    while (data = inStream.read()) {
      data = projections.projectOpData(projection.type, projection.fields, data);
      stream.pushOp(data);
    }
  }
  inStream.on('readable', pump);
  pump();

  return stream;
};

// Subscribe to the document at the specified version. For now all deduplication
// of subscriptions will happen in the driver, but this'll change at some point.
Livedb.prototype.subscribe = function(cName, docName, v, options, callback) {
  // Support old option-less subscribe semantics
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var projection = this.projections[cName];
  var c = projection ? projection.target : cName;

  this.driver.subscribe(c, docName, v, options, !projection ? callback : function(err, inStream) {
    // It seems a little roundabout, but we'll wrap the stream in another stream to filter the ops.
    if (err) return callback(err);

    callback(null, wrapProjectedStream(inStream, projection));
  });
};

// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
Livedb.prototype.bulkSubscribe = function(requests, callback) {
  // This function has to deal with the annoying property that if you bulkSubscribe to a document
  // and bulkSubscribe to a projection of that document at the same time, we have to call
  // driver.bulkSubscribe multiple times. This is quite inefficient - and in reality, a client
  // shouldn't really need multiple projections of the same document. When we revisit the API, I'll
  // probably make this no longer necessary.

  var results = {};

  var work = 1;
  function done(err) {
    // TODO: This leaks memory if any of the bulkSubscribe requests fail.
    if (err && callback) {
      callback(err);
      callback = null;
      return;
    }

    work--;
    if (!work) {
      callback(null, results);
    }
  }

  var nonProjectedRequests = {};
  var hasProjections = false; // Shortcut if there's no projections to avoid the extra work.
  var self = this;

  for (var cName in requests) {
    var docs = requests[cName];
    var projection = this.projections[cName];
    if (!projection) {
      nonProjectedRequests[cName] = docs;
      continue;
    }
    hasProjections = true;

    // This could be more efficient - most of the time when you're bulk subscribing to a projected
    // document, you won't also bulk subscribe to its original. We could just transplant the
    // bulksubscribe request from the projection to the original. However, we'd still have to do
    // this work if you subscribed to more than one version of a document and that adds
    // complexity. This whole design is a bit awful, so I'm going to revisit it at some point -
    // and so this less efficient version will do for now.
    work++;
    this._bulkSubscribeProjection(cName, docs, projection, results, done);
  }

  if (hasProjections) {
    if (!livedbUtil.hasKeys(nonProjectedRequests)) {
      return done();
    }
    // Make a clone of the request object, omitting all the projected fields.
    this.driver.bulkSubscribe(nonProjectedRequests, function(err, r) {
      for (var cName in r) {
        results[cName] = r[cName];
      }
      done();
    });
  } else {
    // Don't bother with any of the done() callback overhead.
    return this.driver.bulkSubscribe(requests, callback);
  }
};

// This is a wacky function signature and should be rewritten along with a
// better implementation of bulkSubscribe above
Livedb.prototype._bulkSubscribeProjection = function(cName, docs, projection, results, done) {
  var requests = {};
  requests[projection.target] = docs;
  this.driver.bulkSubscribe(requests, function(err, subResult) {
    if (err) return done(err);

    var streams = subResult[projection.target];
    for (var docName in streams) {
      streams[docName] = wrapProjectedStream(streams[docName], projection);
    }
    results[cName] = streams;
    done();
  });
};

// This is a wrapper around the snapshotdb's getSnapshot function which takes into account
// projections
Livedb.prototype._getSnapshot = function(cName, docName, callback) {
  var projection = this.projections[cName];

  if (projection) {
    if (this.snapshotDb.getSnapshotProjected) {
      this.snapshotDb.getSnapshotProjected(projection.target, docName, projection.fields, function(err, snapshot) {
        if (snapshot && snapshot.type !== projection.type) {
           // We'll pretend the document doesn't exist. Creating it will fail though - the document
           // isn't invisible to the user.
          return callback(null, {v:snapshot.v});
        }
        callback(err, snapshot);
      });
    } else {
      this.snapshotDb.getSnapshot(projection.target, docName, function(err, snapshot) {
        if (err) return callback(err);

        if (snapshot) {
          if (snapshot.type !== projection.type)
            return callback(null, {v:snapshot.v});

          snapshot.data = projections.projectSnapshot(projection.type, projection.fields, snapshot.data);
        }

        callback(null, snapshot);
      });
    }
  } else {
    this.snapshotDb.getSnapshot(cName, docName, callback);
  }
};

// This is a fetch that doesn't check the oplog to see if the snapshot is out
// of date. It will be higher performance, but in some error conditions it may
// return an outdated snapshot.
Livedb.prototype._lazyFetch = function(cName, docName, callback) {
  var self = this;
  var start = Date.now();

  this._getSnapshot(cName, docName, function(err, snapshot) {
    if (err) return callback(err);

    snapshot = snapshot || {v:0};
    if (snapshot.v == null) return callback('Invalid snapshot data');
    if (self.sdc) self.sdc.timing('livedb.lazyFetch.called', Date.now() - start);

    callback(null, snapshot);
  });
};

// Callback called with (err, {v, data})
Livedb.prototype.fetch = function(cName, docName, callback) {
  var self = this;
  var start = Date.now();

  this._lazyFetch(cName, docName, function(err, data) {
    if (err) return callback(err);

    self.getOps(cName, docName, data.v, function(err, results) {
      if (err) return callback(err);

      err = ot.applyAll(data, results);
      if (self.sdc) self.sdc.timing('livedb.fetch.called', Date.now() - start);
      callback(err, err ? null : data);

      // Note that this does NOT cache the new version in redis, unlike the old version.
    });
  });
};


// requests is a map from collection name -> list of documents to fetch. The
// callback is called with a map from collection name -> map from docName ->
// data.
//
// I'm not getting ops for the documents here - I certainly could. But I don't
// think it buys us anything in terms of concurrency for the extra redis calls.
// This should be revisited at some point.
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


Livedb.prototype.fetchAndSubscribe = function(cName, docName, callback) {
  var self = this;
  this.fetch(cName, docName, function(err, data) {
    if (err) return callback(err);
    self.subscribe(cName, docName, data.v, function(err, stream) {
      callback(err, data, stream);
    });
  });
};

Livedb.prototype.collection = function(cName) {
  return {
    submit: this.submit.bind(this, cName),
    subscribe: this.subscribe.bind(this, cName),
    getOps: this.getOps.bind(this, cName),
    fetch: this.fetch.bind(this, cName),
    queryFetch: this.queryFetch.bind(this, cName),
    queryPoll: this.queryPoll.bind(this, cName),

    // Deprecated.
    query: this.query.bind(this, cName),
  };
};

Livedb.prototype.destroy = function() {
  this.driver.destroy();

  // ... and close any remaining subscription streams.
  for (var id in this.streams) {
    this.streams[id].destroy();
  }

  if (this.closeSdc) this.sdc.close();
};


// Mixin external modules
require('./queries')(Livedb);
require('./presence')(Livedb);
