// This is an in-memory livedb database.
//
// Its main use is as an API example for people implementing database adaptors.
// This database is fully functional, except it stores all documents &
// operations forever in memory. As such, memory usage will grow without bound,
// it doesn't scale across multiple node processes and you'll lose all your
// data if the server restarts. Use with care.
//
// There are 3 different APIs a database can expose. A database adaptor does
// not need to implement all three APIs. You can pick and choose at will.
//
// The three database APIs are:
//
// - Snapshot API, which is used to store actual document data
// - Query API, which livedb wraps for live query capabilities.
// - Operation log for storing all the operations people have submitted. This
//   is used if a user makes changes while offline and then reconnects. Its
//   also really useful for auditing user actions.
//
// All databases should implement the close() method regardless of which APIs
// they expose.

function Memory() {
  if (!(this instanceof Memory)) return new Memory();

  // Map from collection name -> doc name -> snapshot ({v:, type:, data:})
  this.collections = {};

  // Map from collection name -> doc name -> list of operations. Operations
  // don't store their version - instead their version is simply the index in
  // the list.
  this.ops = {};

  this.closed = false;
};
module.exports = Memory;


Memory.prototype.close = function(callback) {
  this.closed = true;
  if (callback) callback();
};

// Snapshot database API

function clone(obj) {
  return (obj === undefined) ? undefined : JSON.parse(JSON.stringify(obj));
}

Memory.prototype._getSnapshotSync = function(cName, docName) {
  var collection = this.collections[cName];
  // We need to clone the snapshot because at the moment LiveDB's validation
  // code assumes each call to getSnapshot returns a new object.
  var doc = collection && clone(collection[docName]);
  if (doc) {
    // Doc metadata should be stored but not returned. It is meant for querying
    // and auditing only
    delete doc.m;
    // The docName should be added to every returned result
    doc.docName = docName;
  }
  return doc;
};

// Get the named document from the database. The callback is called with (err,
// snapshot). snapshot may be null if the docuemnt has never been created in the
// database.
Memory.prototype.getSnapshot = function(cName, docName, fields, callback) {
  var snapshot = this._getSnapshotSync(cName, docName);
  process.nextTick(function() {
    callback(null, snapshot);
  });
};

// Implementing this method is optional, since we can call getSnapshot multiple
// times. However, it is usually quite simple to implement more efficiently.
// While returned results is an array, don't worry about the order matching the
// order of the docNames passed in. Also, if a doc isn't found, it should not
// be added to the returned array
Memory.prototype.getSnapshots = function(cName, docNames, fields, callback) {
  var snapshots = [];
  for (var i = 0; i < docNames.length; i++) {
    var snapshot = this._getSnapshotSync(cName, docNames[i]);
    if (snapshot) snapshots.push(snapshot);
  }
  process.nextTick(function() {
    callback(null, snapshots);
  });
};

// This method is used to create, update, and delete snapshots. For creates and
// updates, a snapshot object will be passed in with a type property. If there
// is no type property, it should be considered a delete
Memory.prototype.writeSnapshot = function(cName, docName, snapshot, callback) {
  var collection = this.collections[cName] = (this.collections[cName] || {});
  if (!snapshot.type) {
    delete collection[docName];
  } else {
    collection[docName] = clone(snapshot);
  }
  process.nextTick(callback);
};


// Query support API. This is optional. It allows you to run queries against the data.

// The memory database has a really simple (probably too simple) query
// mechanism to get all documents in the collection. The query is just the
// collection name.

// Ignore the query - Returns all documents in the specified collection
Memory.prototype.query = function(cName, query, fields, options, callback) {
  var collection = this.collections[cName];
  var results = [];
  for (var docName in collection || {}) {
    var snapshot = collection[docName];
    if (!snapshot.type) continue;
    var result = clone(snapshot);
    result.docName = docName;
    results.push(result);
  }
  process.nextTick(function() {
    callback(null, results);
  });
};

// This method should be implemented so that query polling only returns
// ids and not the full results. Since most of the time most of the
// results won't change, this makes a significant difference in
// database load and CPU
Memory.prototype.queryPoll = function(cName, query, options, callback) {
  var collection = this.collections[cName];
  var docNames = (collection) ? Object.keys(collection) : [];
  process.nextTick(function() {
    callback(null, docNames);
  });
};

// Even better, implement this method so we only have to query restricted
// to a single doc for appropriate queries
Memory.prototype.queryPollDoc = function(cName, docName, query, options, callback) {
  var collection = this.collections[cName];
  var doc = collection && collection[docName];
  process.nextTick(function() {
    callback(null, !!doc);
  });
};

// Queries can avoid a lot of database load and CPU by querying individual
// documents instead of the whole collection.
Memory.prototype.queryNeedsPollMode = function(cName, index, query) {
  return false;
};


// Operation log

// Internal function.
Memory.prototype._getOpLog = function(cName, docName) {
  var c = this.ops[cName];
  if (!c) c = this.ops[cName] = {};

  var ops = c[docName] || (c[docName] = []);
  return ops;
};

// This is used to store an operation.
//
// Its possible writeOp will be called multiple times with the same operation
// (at the same version). In this case, the function can safely do nothing (or
// overwrite the existing identical data). It MUST NOT change the version number.
//
// Its guaranteed that writeOp calls will be in order - that is, the database
// will never be asked to store operation 10 before it has received operation
// 9. It may receive operation 9 on a different server.
//
// opData looks like:
// {v:version, op:... OR create:{optional data:..., type:...} OR del:true, [src:string], [seq:number], [meta:{...}]}
//
// callback should be called as callback(error)
Memory.prototype.writeOp = function(cName, docName, opData, callback) {
  var opLog = this._getOpLog(cName, docName);

  // This should never actually happen unless there's bugs in livedb. (Or you
  // try to use this memory implementation with multiple frontend servers)
  if (opLog.length < opData.v - 1) {
    return callback('Internal consistancy error - database missing parent version');
  }

  opLog[opData.v] = opData;
  process.nextTick(callback);
};

// Get the current version of the document, which is one more than the version
// number of the last operation the database stores.
//
// callback should be called as callback(error, version)
Memory.prototype.getVersion = function(cName, docName, callback) {
  var opLog = this._getOpLog(cName, docName);
  var version = opLog.length;
  process.nextTick(function() {
    callback(null, version);
  });
};

// Get the current version of the document, only if it is uncreated. If it is
// created, return null. This function is important for making sure that we
// don't ever repeat versions when recreating documents after a delete.
//
// callback should be called as callback(error, version || null)
Memory.prototype.getUncreatedVersion = function(cName, docName, callback) {
  var opLog = this._getOpLog(cName, docName);
  var lastOp = opLog[opLog.length - 1];
  process.nextTick(function() {
    // In most cases, the doc will never have been created and we'll start
    // from version 0
    if (!lastOp) return callback(null, 0);
    // If the doc was last deleted, return the current version. This way,
    // we'll create at the next version and avoid reusing a past version
    if (lastOp.del) return callback(null, lastOp.v + 1);
    // Otherwise, we think the doc is currently created. Return null to
    // indicate that there should be a snapshot
    callback(null, null);
  });
};

// Get operations between [start, end) noninclusively. (Ie, the range should
// contain start but not end).
//
// If end is null, this function should return all operations from start onwards.
//
// The operations that getOps returns don't need to have a version: field.
// The version will be inferred from the parameters if it is missing.
//
// Callback should be called as callback(error, [list of ops]);
Memory.prototype.getOps = function(cName, docName, start, end, callback) {
  var opLog = this._getOpLog(cName, docName);
  if (end == null) {
    end = opLog.length;
  }
  var ops = opLog.slice(start, end);
  process.nextTick(function() {
    callback(null, ops);
  });
};
