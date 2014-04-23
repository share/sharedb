var Readable = require('stream').Readable;
var assert = require('assert');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Promise = require('promise');

var SDC;
try {
  // If statsd isn't found, simply disable it.
  SDC = require('statsd-client');
} catch (e) {}

var bulkSubscribe = require('./bulksubscribe');
var ot = require('./ot');

// Export the memory store as livedb.memory
exports.memory = require('./memory');
exports.client = Livedb;

function doNothing() {};

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
  EventEmitter.call(this);
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

  this.driver = options.driver;

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

  // this.onOp = this.onOp.bind(this);
  bulkSubscribe.mixinSnapshotFn(this.snapshotDb);
};

// Mixin eventemitter for on('op').
Livedb.prototype = Object.create(EventEmitter);

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
  // this._getOps(cName, docName, from, to, function(err, ops) {
  this.driver.getOps(cName, docName, from, to, function(err, ops) {
    if (self.sdc) self.sdc.timing('livedb.getOps', Date.now() - start);
    callback(err, ops);
  });
};

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

  var err = ot.checkOpData(opData);
  if (err) return callback(err);

  ot.normalize(opData);

  var transformedOps = [];
  
  var self = this;

  function retry() {
    // First we'll get a doc snapshot. This wouldn't be necessary except that
    // we need to check that the operation is valid against the current
    // document before accepting it.
    self._lazyFetch(cName, docName, function(err, snapshot) {
      if (err) return callback(err);

      // Get all operations that might be relevant. We'll float the snapshot
      // and the operation up to the most recent version of the document, then
      // try submitting.
      var from = opData.v != null ? Math.min(snapshot.v, opData.v) : snapshot.v;
      self.driver.getOps(cName, docName, from, null, function(err, ops) {
        if (err) return callback(err);

        for (var i = 0; i < ops.length; i++) {
          var op = ops[i];

          if (opData.src && opData.src === op.src && opData.seq === op.seq) {
            // The op has already been submitted. There's a variety of ways
            // this can happen. Its important we don't transform it by itself
            // & submit again.
            return callback('Op already submitted');
          }

          // Bring both the op and the snapshot up to date. At least one of
          // these two conditionals should be true.
          if (snapshot.v === op.v) {
            err = ot.apply(snapshot, op);
            if (err) return callback(err);
          }
          if (opData.v === op.v) {
            transformedOps.push(op);
            err = ot.transform(snapshot.type, opData, op);
            if (err) return callback(err);
          }
        }

        // Setting the version here has ramifications if we have to retry -
        // we'll transform by any new operations which hit from this point on.
        // In reality, it shouldn't matter. But its important to know that even
        // if you pass a null version into submit, its still possible for
        // transform() to get called.
        if (opData.v == null)
          opData.v = snapshot.v;
        else if (opData.v !== snapshot.v)
          return callback('Invalid opData version');

        var type = snapshot.type;
        // Ok, now we can try to apply the op.
        err = ot.apply(snapshot, opData);
        if (err) {
          if (typeof err !== 'string' && !util.isError(err)) {
            console.warn('validation function must return falsy, string or an error object.');
            console.warn('Instead we got', err);
          }
          return callback(err);
        }

        // Great - now we're in the situation that we can actually submit the
        // operation to the database. If this method succeeds, it should
        // update any persistant oplogs before calling the callback to tell us
        // about the successful commit. I could make this API more
        // complicated, enabling the function to return actual operations and
        // whatnot, but its quite rare to actually need to transform data on
        // the server at this point.
        self.driver.atomicSubmit(cName, docName, opData, options, function(err) {
          if (err === 'Transform needed')
            retry();
          else if (err) {
            callback(err);
          } else {
            self._writeSnapshotAfterSubmit(cName, docName, snapshot, opData, options, function(err) {
              // What do we do if the snapshot write fails? We've already
              // committed the operation - its done and dusted. We probably
              // shouldn't re-run polling queries now. Really, no matter what
              // we do here things are going to be a little bit broken,
              // depending on the behaviour we trap in finish.

              // Its sort of too late to error out if the snapshotdb can't
              // take our op - the op has been commited.

              // postSubmit is for things like publishing the operation over
              // pubsub. We should probably make this asyncronous.

              // self._updateCursors(cName, docName, type, opData);
              if (self.driver.postSubmit) self.driver.postWriteSnapshot(cName, docName, opData, snapshot); 
              callback(err, snapshot.v - 1, transformedOps, snapshot);
            })
          }
        });
      });
    });
  }

  retry();
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

// Subscribe to the document at the specified version. For now all deduplication
// of subscriptions will happen in the driver, but this'll change at some point.
Livedb.prototype.subscribe = function(cName, docName, v, callback) {
  this.driver.subscribe(cName, docName, v, callback);
};

// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
Livedb.prototype.bulkSubscribe = function(requests, callback) {
  this.driver.bulkSubscribe(requests, callback);
};

// This is a fetch that doesn't check the oplog to see if the snapshot is out
// of date. It will be higher performance, but in some error conditions it may
// return an outdated snapshot.
Livedb.prototype._lazyFetch = function(cName, docName, callback) {
  var self = this;
  var start = Date.now();

  this.snapshotDb.getSnapshot(cName, docName, function(err, snapshot) {
    if (err) return callback(err);

    snapshot = snapshot || {v:0};
    if (snapshot.v == null) return callback('Invalid snapshot data');
    if (self.sdc) self.sdc.timing('livedb.lazyFetch', Date.now() - start);

    callback(null, snapshot);
  });
};

// Callback called with (err, {v, data})
Livedb.prototype.fetch = function(cName, docName, callback) {
  var self = this;
  this._lazyFetch(cName, docName, function(err, data) {
    if (err) return callback(err);

    self.getOps(cName, docName, data.v, function(err, results) {
      if (err) return callback(err);

      err = ot.applyAll(data, results);
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
    //fetchAndObserve: this.fetchAndObserve.bind(this, cName),
    queryFetch: this.queryFetch.bind(this, cName),
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
require('./livedb-redis')(Livedb);
require('./queries')(Livedb);
require('./presence')(Livedb);
