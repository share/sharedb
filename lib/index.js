var async = require('async');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var monkeypatch = require('./monkeypatch');
var ot = require('./ot');
var projections = require('./projections');
var sharedbUtil = require('./util');
var OpStream = sharedbUtil.OpStream;
var Agent = require('./agent');

// This is expoesed, but I'm conflicted about whether the ot code should be part
// of the public API. I want to be able to change this code without considering
// it a breaking change.
exports.ot = ot;

// Export the memory store as sharedb.memory
exports.memory = require('./memory');
exports.client = ShareDB;

exports.inprocessDriver = require('./inprocessdriver');

// The redis driver will be pulled out into its own module in a subsequent sharedb version.
exports.redisDriver = require('./redisdriver');

function SubmitData(cName, docName, opData, projection, callback) {
    this.cName = cName;
    this.docName = docName;
    this.opData = opData;
    this.projection = projection;
    this.callback = callback;
    this.start = Date.now();
    this.transformedOps = [];
    // There's an awful state that should never happen (but did happen to us
    // recently) where a driver knows there are more ops for a document, but the
    // ops don't seem to exist anywhere. In this case, we need to make sure we
    // don't end up in an infinite retry loop.
    this.expectTransform = false;
}

function doNothing() {};

// A sharedb instance is configured with two parameters:
//
// - A snapshot database, which is the database that stores document objects.
//   For example, an instance of sharedb-mongo.
//
// - A driver. The driver is used to communicate with other instances of sharedb
//   running on other frontend servers. The driver makes commits atomic and
//   publishes operations. For example, an instance of the redis driver. If you
//   only have one frontend server, you can use the inprocess driver, which turns
//   off all messaging. (This is the default if you do not specify a driver.)
//
//   The driver in turn needs access to an oplog, where it stores historical
//   operations. Often you'll use the same database to store snapshots and
//   operations - in which case, you can often re-use your snapshot database
//   instance here. The sharedb-mongo driver supports this.
//
// The sharedb client is created using either an options object or a database
// backend which is used as both oplog and snapshot.
//
// Eg:
//  var db = require('sharedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var backend = sharedb.client(db);
//
// Or using an options object:
//
//  var db = ...
//  var backend = sharedb.client({db:db});
//
// This is a shorthand for:
//
//  var db = ...
//  var backend = sharedb.client({db:db, driver:sharedb.inprocessDriver(db)}
//
// If you want, you can use a different database for both snapshots and operations:
//
//  var db = require('sharedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
//  var oplog = {writeOp:..., getOps:...};
//  var backend = sharedb.client({db:db, oplog:oplog});
//
// .. Which is a shorthand for:
//
//  var backend = sharedb.client({db:db, driver:sharedb.inprocessDriver(oplog)});
//
//
// ShareDB can work in a distributed environment by using a distributed driver
// (like the redis driver). You can instantiate it like this:
//
//  var driver = sharedb.redisDriver(db);
//  var sharedb = sharedb.createClient({db:db, driver:driver})
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
function ShareDB(options) {
  if (!(this instanceof ShareDB)) return new ShareDB(options);
  emitter.EventEmitter.call(this);

  if (!options) throw new Error('ShareDB missing database options');

  this.db = options.db;
  monkeypatch.db(this.db);

  // This contains any extra databases that can be queried & notified when documents change
  this.extraDbs = options.extraDbs || {};

  this.pubsub = options.pubsub || require('./pubsub-memory')();

  // Map from projected collection -> {type, fields}
  this.projections = {};

  this.getPublishChannels = options.getPublishChannels || doNothing;

  this.suppressCollectionPublish = !!options.suppressCollectionPublish;

  this.preValidate = options.preValidate;
  this.validate = options.validate;

  // Map from event name (or '') to a list of middleware.
  this.extensions = {'': []};
  this.docFilters = [];
  this.opFilters = [];
};
emitter.mixin(ShareDB);

ShareDB.prototype.addProjection = function(projName, cName, type, fields) {
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
ShareDB.prototype.getOps = function(index, docName, from, to, callback) {
  // This function is basically just a fancy wrapper for db.getOps(). Before
  // calling into the driver, it cleans up the input a little.

  // Make 'to' field optional.
  if (typeof to === 'function') {
    callback = to;
    to = null;
  }

  var sharedb = this;

  if (from == null) return callback('Invalid from field in getOps');

  if (to != null && to >= 0 && from > to) return callback(null, []);

  var start = Date.now();
  var projection = this.projections[index];
  var cName = (projection) ? projection.target : index;
  var fields = projection && projection.fields;

  this.db.getOps(cName, docName, from, to, function(err, ops) {
    sharedb.emit('timing', 'getOps', Date.now() - start);
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
// callback called with (err, snapshot, ops)
ShareDB.prototype.submit = function(cName, docName, opData, callback) {
  var err = ot.checkOpData(opData);
  if (err) return callback(err);

  var submitRequest = new SubmitRequest(this, cName, docName, opData, callback);
  submitRequest.run();
};

ShareDB.prototype._trySubmit = function(submitData) {
  var sharedb = this;
  var opData = submitData.opData;

  this.fetch(submitData.cName, submitData.docName, function(err, snapshot) {
    if (err) return submitData.callback(err);

    // Get all operations that might be relevant. We'll float the snapshot
    // and the operation up to the most recent version of the document, then
    // try submitting.
    var from = (opData.v != null && opData.v < snapshot.v) ? opData.v : snapshot.v;
    var to = null;
    sharedb.db.getOps(submitData.cName, submitData.docName, from, to, function(err, ops) {
      if (err) return submitData.callback(err);

      sharedb.emit('increment', 'submit.transformNeeded');

      if (submitData.expectTransform && ops.length === 0) {
        console.warn("ERROR: CORRUPT DATA DETECTED in document " + submitData.cName + '.' + submitData.docName);
        return submitData.callback('Internal data corruption - cannot submit');
      }

      var err = applyCommittedOps(opData, snapshot, ops, submitData.transformedOps);
      if (err) return submitData.callback(err);

      // Setting the version here has ramifications if we have to retry -
      // we'll transform by any new operations which hit from this point on.
      // In reality, it shouldn't matter. But its important to know that even
      // if you pass a null version into submit, its still possible for
      // transform() to get called.
      if (opData.v == null) {
        opData.v = snapshot.v;
      } else if (opData.v !== snapshot.v) {
        return submitData.callback('Invalid opData version');
      }

      // If we're being projected, verify that the op is allowed.
      if (submitData.projection && !projections.isOpDataAllowed(snapshot.type, submitData.projection.fields, opData)) {
        return submitData.callback('Operation invalid in projected collection');
      }

      var preChannels = sharedb.getPublishChannels(submitData.cName, submitData.docName, opData, snapshot);

      // Ok, now we can try to apply the op.
      err = ot.apply(snapshot, opData);
      if (err) return submitData.callback(err);

      var postChannels = sharedb.getPublishChannels(submitData.cName, submitData.docName, opData, snapshot);

      // Try committing the operation and snapshot to the database atomically
      sharedb.db.commit(submitData.cName, submitData.docName, opData, snapshotData, function(err, succeeded) {
        if (err) return submitData.callback(err);
        if (!succeeded) {
          // Between our fetch and our call to commit, another client
          // committed an operation. This retry loop could be optimized, but
          // we currently expect it to be rare
          submitData.expectTransform = true;
          return sharedb._trySubmit(submitData);
        }

        if (!sharedb.suppressPublish) {
          var channels = getChannels(submitData.cName, submitData.docName, preChannels, postChannels);
          sharedb.driver.publish(channels, opData);
        }

        sharedb.emit('timing', 'submit', Date.now() - submitData.start);
        submitData.callback(err, snapshot, submitData.transformedOps);
      });
    });
  });
};

function applyCommittedOps(opData, snapshot, ops, transformedOps) {
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];

    if (opData.src && opData.src === op.src && opData.seq === op.seq) {
      // The op has already been submitted. There's a variety of ways this can
      // happen. It's important we don't apply the same op twice
      return 'Op already submitted';
    }

    // Bring both the op and the snapshot up to date. At least one of
    // these two conditionals should be true.
    if (snapshot.v === op.v) {
      err = ot.apply(snapshot, op);
      if (err) return err;
    }
    if (opData.v === op.v) {
      transformedOps.push(op);
      err = ot.transform(snapshot.type, opData, op);
      if (err) return err;
    }
  }
}

function getDocChannel(cName, docName) {
  return cName + '.' + docName;
}

function getChannels(cName, docName, preChannels, postChannels) {
  var channels = [
    getDocChannel(cName, docName),
    cName
  ];
  mergeUnique(channels, preChannels);
  mergeUnique(channels, postChannels);
  return channels;
}

function mergeUnique(to, from) {
  if (!from) return;
  for (var i = 0; i < from.length; i++) {
    var item = from[i];
    if (to.indexOf(item) === -1 {
      to.push(item);
    }
  }
}

function wrapProjectedStream(inStream, projection) {
  // Note that we aren't passing a filter version into the stream. This is because the inStream
  // should already be ordering / filtering operations based on the version and we don't need to
  // repeat that work. (And weirdly if we pass in inStream.v, some tests fail).
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
}

// Subscribe to the document from the specified version
ShareDB.prototype.subscribe = function(cName, docName, version, callback) {
  var sharedb = this;
  this._subscribe(cName, docName, version, function(err, stream, target) {
    if (err) return callback(err);
    if (version == null) {
      return callback(null, stream);
    }
    // Subscribing from a null version means that we only want new ops as they
    // come in
    sharedb.db.getOps(target, docName, version, null, function(err, ops) {
      if (err) return callback(err);
      stream.pack(version, ops);
      callback(null, stream);
    });
  });
};

ShareDB.process._subscribe = function(cName, docName, version, callback) {
  var projection = this.projections[cName];
  var target = (projection) ? projection.target : cName;
  var channel = getDocChannel(target, docName);
  this.pubsub.subscribe(channel, version, function(err, stream) {
    if (err) return callback(err);
    if (projection) {
      stream = wrapProjectedStream(stream, projection);
    }
    callback(null, stream, target);
  });
};

// Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
ShareDB.prototype.bulkSubscribe = function(requests, callback) {
  var sharedb = this;
  this._bulkSubscribe(requests, function(err, streams) {
    if (err) return callback(err);
    sharedb._bulkSubscribeOps(requests, streams, callback);
  })
});

ShareDB.prototype._bulkSubscribe = function(requests, callback) {
  var streams = {};
  var work = 1;
  var done = function(err) {
    if (err) return callback(err);
    if (--work) return;
    callback(null, streams);
  };
  for (var cName in requests) {
    var items = requests[cName];
    streams[cName] = {};
    if (Array.isArray(items)) {
      // If items is an array of docNames, treat that the same as subscribing
      // from a null version
      for (var i = 0; i < items.length; i++) {
        work++;
        var docName = items[i];
        this._addBulkSubscribe(cName, docName, null, streams, done);
      }
    } else {
      // Otherwise, items is an object with docName keys and version values
      for (var docName in versions) {
        work++;
        var version = items[docName];
        this._addBulkSubscribe(cName, docName, version, streams, done);
      }
    }
  }
  done();
};

ShareDB.prototype._addBulkSubscribe = function(cName, docName, version, streams, done) {
  this._subscribe(cName, docName, version, function(err, stream) {
    if (err) return done(err);
    streams[cName][docName] = stream;
    done();
  });
};

ShareDB.prototype._bulkSubscribeOps = function(requests, streams, callback) {
  var streams = {};
  var work = 1;
  var done = function(err) {
    if (err) return callback(err);
    if (--work) return;
    callback(null, streams);
  };
  for (var cName in requests) {
    work++;
    var items = requests[cName];
    // If items is an array, we are subscribing from a null version and don't
    // need to fetch any old ops
    if (Array.isArray(items)) continue;
    this._addBulkSubscribeOps(cName, items, streams, done);
  }
  done();
};

ShareDB.process._addBulkSubscribeOps = function(cName, versions, streams, done) {
  this.db.getOpsBulk(target, versions, null, function(err, results) {
    if (err) return done(err);
    for (var docName in versions) {
      var version = versions[docName];
      var ops = results[docName];
      streams[cName][docName].pack(version, ops);
    }
    done();
  });
};

function checkSnapshot(snapshot) {
  if (typeof snapshot.v !== 'number') return 'Snapshot missing version';
}

// Calls back with (err, {v, data})
ShareDB.prototype.fetch = function(index, docName, callback) {
  var projection = this.projections[index];
  var cName = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var sharedb = this;
  var start = Date.now();
  this.db.getSnapshot(cName, docName, fields, function(err, snapshot) {
    if (err) return callback(err);
    // Return right away if we find a snapshot. We may have ops in flight that
    // are newer, but a submit shouldn't be acknowledged and ops shouldn't be
    // published until the snapshot db is written to.
    if (snapshot) {
      err = checkSnapshot(snapshot);
      if (err) return callback(err);
      sharedb.emit('timing', 'fetch', Date.now() - start);
      return callback(null, snapshot);
    }
    sharedb.db.getUncreatedVersion(cName, docName, function(err, version) {
      if (err) return callback(err);
      var snapshot = {v: version};
      sharedb.emit('timing', 'fetch', Date.now() - start);
      return callback(null, snapshot);
    });
  });
};

// requests is a map from collection name -> list of documents to fetch. The
// callback is called with a map from collection name -> map from docName ->
// data.
ShareDB.prototype.bulkFetch = function(requests, callback) {
  var start = Date.now();
  var sharedb = this;
  var results = {};
  var work = 1;
  var done = function(err) {
    if (err) return callback(err);
    if (--work) return;
    sharedb.emit('timing', 'bulkFetch', Date.now() - start);
    callback(null, results);
  };
  for (var cName in requests) {
    var docNames = requests[cName];
    var cResult = results[cName] = {};
    work++;
    sharedb._fetchCollection(cName, docNames, cResult, done);
  }
  done();
};

ShareDB.prototype._fetchCollection = function(cName, docNames, cResult, done) {
  var sharedb = this;
  var projection = this.projections[cName];
  var target = (projection) ? projection.target : cName;
  var fields = projection && projection.fields;
  this.db.getSnapshotBulk(target, docNames, fields, function(err, snapshots) {
    if (err) return done(err);
    for (var i = 0; i < snapshots.length; i++) {
      var snapshot = snapshots[i];
      err = checkSnapshot(snapshot);
      if (err) return done(err);
      cResult[snapshot.docName] = snapshot;
    }
    // getSnapshotBulk will not return uncreated snapshots. Thus, we need to
    // check and see if there were any docNames that didn't return a
    // corresponding snapshot
    var uncreated = [];
    for (var i = 0; i < docNames.length; i++) {
      var docName = docNames[i];
      if (!cResult[docName]) uncreated.push(docName);
    }
    if (!uncreated.length) return done();
    sharedb.db.getUncreatedVersionBulk(target, uncreated, function(err, versionMap) {
      if (err) return done(err);
      for (var docName in versionMap) {
        var version = versionMap[docName];
        cResult[docName] = {v: version};
      }
      done();
    });
  });
};

ShareDB.prototype.fetchAndSubscribe = function(cName, docName, callback) {
  var sharedb = this;
  var version = null;
  this._subscribe(cName, docName, version, function(err, stream) {
    if (err) return callback(err);
    sharedb.fetch(cName, docName, function(err, data) {
      callback(err, data, stream);
    });
  });
};

ShareDB.prototype.bulkFetchAndSubscribe = function(requests, callback) {
  var sharedb = this;
  this._bulkSubscribe(requests, function(err, streams) {
    if (err) return callback(err);
    sharedb.bulkFetch(requests, function(err, results) {
      callback(err, results, streams);
    });
  });
};

// Build a snapshot from just the ops. `to` version is optional
ShareDB.prototype.buildSnapshot = function(index, docName, to, callback) {
  var sharedb = this;
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
    sharedb.emit('timing', 'buildSnapshot', Date.now() - start, index, docName, ops.length);
    if (err) return callback(err);
    callback(null, snapshot);
  });
};

ShareDB.prototype.close = function() {
  this.pubsub.close();
  this.db.close();
};

/** A client has connected through the specified stream. Listen for messages.
 * Returns the useragent associated with the connected session.
 *
 * The optional second argument (req) is an initial request which is passed
 * through to any connect() middleware. This is useful for inspecting cookies
 * or an express session or whatever on the request object in your middleware.
 *
 * (The useragent is available through all middleware)
 */
ShareDB.prototype.listen = function(stream, req) {
  var session = this.createSession(stream);
  session.agent.trigger('connect', null, null, {stream: stream, req: req}, function(err) {
    if (err) return session.close(err);
    session.pump();
  });
  return session.agent;
};

ShareDB.prototype.createAgent = function(stream) {
  return new Agent(this, stream);
};

/** Add a function to filter all data going to the current client */
ShareDB.prototype.filter = function(fn) {
  this.docFilters.push(fn);
};

ShareDB.prototype.filterOps = function(fn) {
  this.opFilters.push(fn);
};

// Mixin external modules
require('./middleware')(ShareDB);
require('./queries')(ShareDB);
