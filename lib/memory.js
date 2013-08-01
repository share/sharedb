// This is an example implementation of an in-memory livedb snapshot database.

var Memory = module.exports = function() {
  if (this === global) return new Memory();

  // Map from collection name -> doc name -> snapshot ({v:, type:, data:})
  this.collections = {};

  // Map from collection name -> doc name -> list of operations. Operations
  // don't store their version - instead their version is simply the index in
  // the list.
  this.ops = {};

  this.closed = false;
};

// Snapshot database API

Memory.prototype.close = function() {};

Memory.prototype.getSnapshot = function(cName, docName, callback) {
  var c = this.collections[cName];
  callback(null, c ? c[docName] : null);
};

Memory.prototype.writeSnapshot = function(cName, docName, snapshot, callback) {
  var c = this.collections[cName] = this.collections[cName] || {};

  c[docName] = snapshot;
  callback();
};


// This function is optional - it just makes it faster for dedicated indexes
// (like SOLR) to get a whole bunch of complete documents to service queries.
// Its included here for demonstration purposes and so we can test our tests.
//
// getBulkSnapshots returns an unordered list containing documents that are in
// the database. Each entry should have a docName: field. Documents at version
// 0 may be omitted entirely from the results list.
//
// I'm not entirely sure this is a particularly nice API, but its useful for
// actual database implementations.
Memory.prototype.getBulkSnapshots = function(cName, docNames, callback) {
  var c = this.collections[cName];
  if (!c) return callback(null, []);

  var results = [];
  for (var i = 0; i < docNames.length; i++) {
    var snapshot = c[docNames[i]];
    if (snapshot) results.push({
      docName: docNames[i],
      type: snapshot.type,
      v: snapshot.v,
      data: snapshot.data
    });
  }
  callback(null, results);
};


// Thats it; thats the whole snapshot database API.




// Query support API. This is optional. It allows you to run queries against the data.

// The memory database has a really simple (probably too simple) query
// mechanism to get all documents in the collection. The query is just the
// collection.

// Run the query itself. The query is ignored - we just return all documents in
// the specified index (=collection).
Memory.prototype.query = function(liveDb, index, query, callback) {
  //if(typeof index !== 'string') return callback('Invalid query');

  var c = this.collections[index];
  if (!c) return callback(null, []);

  var results = [];
  for (var docName in c) {
    results.push(c[docName]);
  }
  
  callback(null, results);
};

// Queries can avoid a lot of CPU load by querying individual documents instead
// of the whole collection.
Memory.prototype.queryNeedsPollMode = function(index, query) { return false; };

Memory.prototype.queryDoc = function(liveDb, index, cName, docName, query, callback) {
  // We simply return whether or not the document is inside the specified index.
  if (index !== cName) return callback();

  var c = this.collections[cName];
  callback(null, c && c[docName]);
};




// Operation log

// Internal function.
Memory.prototype._getOpLog = function(cName, docName) {
  var c = this.ops[cName];
  if (!c) c = this.ops[cName] = {};

  var ops = c[docName]
  if (!ops) ops = c[docName] = [];
  
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
  if (opLog.length < opData.v - 1)
    return callback('Internal consistancy error - database missing parent version');

  opLog[opData.v] = opData;
  callback();
};

// Get the current version of the document, which is one more than the version
// number of the last operation the database stores.
//
// callback should be called as callback(error, version)
Memory.prototype.getVersion = function(cName, docName, callback) {
  var opLog = this._getOpLog(cName, docName);
  callback(null, opLog.length);
};

// Get operations between start and end. If end is null, this function should
// return all operations from start onwards.
//
// The operations that getOps returns don't need to have a version: field.
// The version will be inferred from the parameters if it is missing.
//
// Callback should be called as callback(error, [list of ops]);
Memory.prototype.getOps = function(cName, docName, start, end, callback) {
  var opLog = this._getOpLog(cName, docName);

  if (end == null)
    end = opLog.length;

  callback(null, opLog.slice(start, end));
};

