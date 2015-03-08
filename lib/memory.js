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

Memory.prototype.close = function() {
  this.closed = true;
};

// Snapshot database API

var clone = function(obj) {
  return (obj === undefined) ? undefined : JSON.parse(JSON.stringify(obj));
};

Memory.prototype._getSnapshotSync = function(cName, docName) {
  var collection = this.collections[cName];
  // We need to clone the snapshot because at the moment LiveDB's validation
  // code assumes each call to getSnapshot returns a new object.
  return collection && clone(collection[docName]);
};

// Get the named document from the database. The callback is called with (err,
// snapshot). snapshot may be null if the docuemnt has never been created in the
// database.
Memory.prototype.getSnapshot = function(cName, docName, callback) {
  var snapshot = this._getSnapshotSync(cName, docName);
  process.nextTick(function() {
    callback(null, snapshot);
  });
};

Memory.prototype.writeSnapshot = function(cName, docName, snapshot, callback) {
  var c = this.collections[cName] = (this.collections[cName] || {});
  c[docName] = clone(snapshot);
  process.nextTick(callback);
};


// This function is optional, but should be implemented for reducing the
// number of database queries.
//
// Its included here for demonstration purposes and so we can test our tests.
//
// requests is an object mapping collection name -> list of doc names for
// documents that need to be fetched.
//
// The callback is called with (err, results) where results is a map from
// collection name -> {docName:data for data that exists in the collection}
//
// Documents that have never been touched can be ommitted from the results.
// Documents that have been created then later deleted must exist in the result
// set, though only the version field needs to be returned.
Memory.prototype.bulkGetSnapshot = function(requests, callback) {
  var results = {};
  for (var cName in requests) {
    var cResult = results[cName] = {};
    var docNames = requests[cName];
    for (var i = 0; i < docNames.length; i++) {
      var docName = docNames[i];
      var snapshot = this._getSnapshotSync(cName, docName);
      if (snapshot) cResult[docName] = snapshot;
    }
  }
  process.nextTick(function() {
    callback(null, results);
  });
};



// Thats it; thats the whole snapshot database API.




// Query support API. This is optional. It allows you to run queries against the data.

// The memory database has a really simple (probably too simple) query
// mechanism to get all documents in the collection. The query is just the
// collection name.

// Ignore the query - Returns all documents in the specified index (=collection)
Memory.prototype.query = function(liveDb, index, query, options, callback) {
  var collection = this.collections[index];
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

// Ignore the query - Returns all documents in the specified index (=collection)
Memory.prototype.queryDoc = function(liveDb, index, cName, docName, query, callback) {
  var snapshot = this._getSnapshotSync(cName, docName);
  var result;
  if (snapshot && snapshot.type) {
    result = snapshot;
    result.docName = docName;
  }
  process.nextTick(function() {
    callback(null, result);
  });
};

// Queries can avoid a lot of database load and CPU by querying individual
// documents instead of the whole collection.
Memory.prototype.queryNeedsPollMode = function(index, query) {
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
