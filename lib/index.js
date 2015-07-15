var async = require('async');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var monkeypatch = require('./monkeypatch');
var ot = require('./ot');
var projections = require('./projections');
var livedbUtil = require('./util');
var OpStream = livedbUtil.OpStream;

// This is expoesed, but I'm conflicted about whether the ot code should be part
// of the public API. I want to be able to change this code without considering
// it a breaking change.
exports.ot = ot;

// Export the memory store as livedb.memory
exports.memory = require('./memory');
exports.client = Livedb;

exports.inprocessDriver = require('./inprocessdriver');

// The redis driver will be pulled out into its own module in a subsequent livedb version.
exports.redisDriver = require('./redisdriver');

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
  EventEmitter.call(this);

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
  monkeypatch.snapshotDb(this.snapshotDb);

  this.driver = options.driver || require('./inprocessdriver')(options.oplog || options.db || options);

  // This contains any extra databases that can be queried & notified when documents change
  this.extraDbs = options.extraDbs || {};

  // Map from projected collection -> {type, fields}
  this.projections = {};

  this.getDirtyDataPre = options.getDirtyDataPre || doNothing;
  this.getDirtyData = options.getDirtyData || doNothing;
  this.getPublishChannels = options.getPublishChannels || doNothing;

  this.suppressCollectionPublish = !!options.suppressCollectionPublish;
};

// Mixin EventEmitter
(function() {
  for (var key in EventEmitter.prototype) {
    Livedb.prototype[key] = EventEmitter.prototype[key];
  }
})();

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
Livedb.prototype.getOps = function(index, docName, from, to, callback) {
  // This function is basically just a fancy wrapper for driver.getOps(). Before
  // calling into the driver, it cleans up the input a little.

  // Make 'to' field optional.
  if (typeof to === 'function') {
    callback = to;
    to = null;
  }

  var livedb = this;

  if (from == null) return callback('Invalid from field in getOps');

  if (to != null && to >= 0 && from > to) return callback(null, []);

  var start = Date.now();
  var projection = this.projections[index];
  var cName = (projection) ? projection.target : index;
  var fields = projection && projection.fields;

  this.driver.getOps(cName, docName, from, to, function(err, ops) {
    livedb.emit('timing', 'getOps', Date.now() - start);
    if (err) return callback(err);

    // Interestingly, this will filter ops for other types as if they were the projected type. This
    // is a bug, but it shouldn't cause any problems for now. I'll have to revisit this
    // implementation when we add support for projections on other types.
    if (ops && fields) {
      for (var i = 0; i < ops.length; i++) {
        ops[i] = projections.projectOpData(fields, ops[i]);
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
  var livedb = this;
  var opData = submitData.opData;

  // First we'll get a doc snapshot. This wouldn't be necessary except that
  // we need to check that the operation is valid against the current
  // document before accepting it.
  this.fetch(submitData.cName, submitData.docName, function(err, snapshot) {
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
    livedb.driver.getOps(submitData.cName, submitData.docName, from, to, function(err, ops) {
      if (err) return submitData.callback(err);

      livedb.emit('increment', 'submit.transformNeeded');

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
      var dirtyData = livedb.getDirtyDataPre(submitData.cName, submitData.docName, opData, snapshot);
      var preChannels = livedb.getPublishChannels(submitData.cName, submitData.docName, opData, snapshot);

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

      var dirtyDataPost = livedb.getDirtyData(submitData.cName, submitData.docName, opData, snapshot);
      var postChannels = livedb.getPublishChannels(submitData.cName, submitData.docName, opData, snapshot);

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

      var submitOptions = submitData.submitOptions;
      submitOptions.dirtyData = dirtyData;
      submitOptions.suppressCollectionPublish = livedb.suppressCollectionPublish;
      submitOptions.publishChannels = (preChannels && postChannels) ?
        preChannels.concat(postChannels) :
        preChannels || postChannels;

      // Great - now we're in the situation that we can actually submit the
      // operation to the database. If this method succeeds, it should
      // update any persistant oplogs before calling the callback to tell us
      // about the successful commit. I could make this API more
      // complicated, enabling the function to return actual operations and
      // whatnot, but its quite rare to actually need to transform data on
      // the server at this point.
      livedb.driver.atomicSubmit(submitData.cName, submitData.docName, opData, submitOptions, function(err) {
        if (err === 'Transform needed') {
          // Between our fetch and our call to atomicSubmit, another client
          // submitted an operation. This should be pretty rare. Calling
          // _trySubmit() here will re-fetch the snapshot again (not necessary),
          // but its a rare enough case that its not worth optimizing.
          submitData.expectTransform = true;
          // Callstack could potentially be very large, so let's clean it up.
          process.nextTick(function() {
            livedb._trySubmit(submitData);
          });
          return;
        } else if (err) {
          submitData.callback(err);
          return;
        }
        livedb._writeSnapshotAfterSubmit(submitData.cName, submitData.docName, snapshot, opData, submitOptions, function(err) {
          // What do we do if the snapshot write fails? We've already
          // committed the operation - its done and dusted. We probably
          // shouldn't re-run polling queries now. Really, no matter what
          // we do here things are going to be a little bit broken,
          // depending on the behaviour we trap in finish.

          // Its sort of too late to error out if the snapshotdb can't
          // take our op - the op has been commited.

          // postSubmit is for things like publishing the operation over
          // pubsub. We should probably make this asyncronous.
          if (livedb.driver.postSubmit) livedb.driver.postSubmit(submitData.cName, submitData.docName, opData, snapshot, submitOptions);

          livedb.emit('timing', 'submit', Date.now() - submitData.start);

          submitData.callback(err, snapshot.v - 1, submitData.transformedOps, snapshot);
        });
      });
    });
  });
};

Livedb.prototype._writeSnapshotAfterSubmit = function(cName, docName, snapshot, opData, options, callback) {
  var livedb = this;

  this.snapshotDb.writeSnapshot(cName, docName, snapshot, function(err) {
    if (err) return callback(err);

    // For queries.
    for (var name in livedb.extraDbs) {
      var db = livedb.extraDbs[name];

      if (db.submit) {
        db.submit(cName, docName, opData, options, snapshot, livedb, function(err) {
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
      data = projections.projectOpData(projection.fields, data);
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
  if (projection) {
    cName = projection.target;
    this.driver.subscribe(cName, docName, v, options, function(err, inStream) {
      // It seems a little roundabout, but we'll wrap the stream in another stream to filter the ops.
      if (err) return callback(err);
      callback(null, wrapProjectedStream(inStream, projection));
    });
  } else {
    this.driver.subscribe(cName, docName, v, options, callback);
  }
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
  var livedb = this;

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

// Build a snapshot from just the ops. `to` version is optional
Livedb.prototype.buildSnapshot = function(index, docName, to, callback) {
  var livedb = this;
  var start = Date.now();
  this.getOps(index, docName, 0, to, function(err, ops) {
    if (err) return callback(err);
    // Find the last create op. Saves us some time applying trasactions if a
    // document was deleted and recreated. It also means that we can clean up
    // ops by first overwriting an op as a create of the document at that
    // version and second dropping all of the ops before that create.
    var createOp;
    for (var i = ops.length; i--;) {
      if (ops[i].create) {
        createOp = ops[i];
        // Remove all ops before the create if not at the beginning already
        if (i > 0) ops.splice(0, i);
        break;
      }
    }
    if (!createOp) {
      return callback('Ops do not start with create: ' + cName + ' ' + docName);
    }
    var snapshot = {v: createOp.v};
    err = ot.applyAll(snapshot, ops);
    livedb.emit('timing', 'buildSnapshot', Date.now() - start, index, docName, ops.length);
    if (err) return callback(err);
    callback(null, snapshot);
  });
};

// This function is used to figure out what version we should start with when
// fetching an uncreated document. A document might be uncreated because it has
// never existed, in which case its version is 0. Alternatively, the document
// might have been created previously and then later deleted. In this case, we
// must never repeat a version number.
//
// In general, this approach trades off more intuitive snapshot deletion for
// extra complexity and a performance hit when fetching uncreated snapshots.
// Most applications are probably not going to fetch a lot of deleted or not
// yet created snapshots by their id, so this isn't expected to be much of an
// issue in practice. In addition, it is even more imperative that at least
// the last operation is maintained for a document that might ever be recreated.
// Without this, versions would be repeated, and the document would likely
// become corrupted.
Livedb.prototype._getUncreated = function(index, cName, docName, fields, callback) {
  var livedb = this;
  // Check the last op for this document in the oplog. We could alternatively
  // look at the last op cached by the driver. However, in the majority of
  // cases, we're expecting not to have any ops and for this to be a new
  // document. To verify that, we'd then have to hit the oplog database after
  // finding nothing in the driver's cache. Thus, it is most likely best to go
  // to the oplog directly, typically getting version 0.
  this.driver.oplog.getUncreatedVersion(cName, docName, function(err, version) {
    if (err) return callback(err);
    // A version of 0 is returned if the doc has no ops. A non-zero version is
    // returned if the last op is a delete operation. Otherwise, the doc has
    // been created, and null is returned
    if (version != null) return callback(null, {v: version});
    // If null is returned, we've probably hit a race condition where a
    // previously uncreated doc was just created between our call to the
    // snapshotDb and our call to the oplog. Alternatively, the snapshot was
    // never properly persisted, even though the op was. Try and get the
    // snapshot one more time now that we think it is created.
    livedb.snapshotDb.getSnapshot(cName, docName, fields, function(err, snapshot) {
      if (err) return callback(err);
      if (snapshot) callback(null, snapshot);
      // If we still didn't get a snapshot, it is possible that we have
      // extremely bad luck and the snapshot was deleted again. But at this
      // point, it is more likely that there was some issue or long delay
      // persisting this snapshot. Rather than going through another retry
      // cycle, try and build the snapshot from the ops. We'll fail unless ops
      // start with a create, so it is not safe to simply drop ops without
      // setting a create op at the beginning.
      livedb.buildSnapshot(index, docName, null, callback);
    });
  });
};

function checkSnapshot(snapshot) {
  if (typeof snapshot.v !== 'number') return 'Snapshot missing version';
}

// Calls back with (err, {v, data})
Livedb.prototype.fetch = function(index, docName, callback) {
  var projection = this.projections[index];
  var cName = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var livedb = this;
  var start = Date.now();
  this.snapshotDb.getSnapshot(cName, docName, fields, function(err, snapshot) {
    if (err) return callback(err);
    // Return right away if we find a snapshot. The driver may have ops in
    // flight that are newer, but a submit shouldn't be acknowledged and ops
    // shouldn't be published until the snapshot db is written to. Thus, if we
    // get something from the snapshot db, we should consider it fresh enough
    // to return directly. In general, we expect reads to be many times more
    // common than writes, so we should be optimizing for read efficiency.
    if (snapshot) {
      err = checkSnapshot(snapshot);
      if (err) return callback(err);
      livedb.emit('timing', 'fetch', Date.now() - start);
      return callback(null, snapshot);
    }
    livedb._getUncreated(index, cName, docName, fields, function(err, snapshot) {
      if (err) return callback(err);
      err = checkSnapshot(snapshot);
      if (err) return callback(err);
      livedb.emit('timing', 'fetch', Date.now() - start);
      return callback(null, snapshot);
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
  var livedb = this;
  var results = {};

  function getSnapshots(index, eachCb) {
    var cResult = results[index] = {};
    var docNames = requests[index];
    var projection = livedb.projections[index];
    var cName = (projection) ? projection.target : index;
    var fields = projection && projection.fields;
    livedb.snapshotDb.getSnapshots(cName, docNames, fields, function(err, snapshots) {
      if (err) return eachCb(err);
      for (var i = 0; i < snapshots.length; i++) {
        var snapshot = snapshots[i];
        err = checkSnapshot(snapshot);
        if (err) return eachCb(err);
        cResult[snapshot.docName] = snapshot;
      }
      // getSnapshots will not return uncreated snapshots. Thus, we need to
      // check and see if there were any docNames that didn't return a
      // corresponding snapshot
      var uncreated = [];
      for (var i = 0; i < docNames.length; i++) {
        var docName = docNames[i];
        if (!cResult[docName]) uncreated.push(docName);
      }
      if (!uncreated.length) return eachCb();
      // We have to get the uncreated versions individually, because under the
      // hood, we have to run a query on the ops for a given document verison.
      // Thus, it isn't possible to make this much more efficient. It is
      // unlikely that anyone will be fetching lots of uncreated documents, so
      // this should be OK.
      async.each(uncreated, function(docName, uncreatedCb) {
        livedb._getUncreated(index, cName, docName, fields, function(err, snapshot) {
          if (err) return uncreatedCb(err);
          err = checkSnapshot(snapshot);
          if (err) return uncreatedCb(err);
          cResult[docName] = snapshot;
          uncreatedCb();
        });
      }, eachCb);
    });
  }
  async.each(Object.keys(requests), getSnapshots, function(err) {
    if (err) return callback(err);
    livedb.emit('timing', 'bulkFetch', Date.now() - start);
    callback(null, results);
  });
};

Livedb.prototype.fetchAndSubscribe = function(index, docName, callback) {
  var livedb = this;
  this.fetch(index, docName, function(err, data) {
    if (err) return callback(err);
    livedb.subscribe(index, docName, data.v, function(err, stream) {
      callback(err, data, stream);
    });
  });
};

Livedb.prototype.destroy = function() {
  this.driver.destroy();
  // ... and close any remaining subscription streams.
  for (var id in this.streams) {
    this.streams[id].destroy();
  }
};


// Mixin external modules
require('./queries')(Livedb);
require('./presence')(Livedb);
