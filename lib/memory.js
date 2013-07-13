// This is an example implementation of an in-memory livedb snapshot database.

var Memory = module.exports = function() {
  if (this === global) return new Memory();

  // Map from collection name -> doc name -> {v:, type:, data:}
  this.collections = {};

  this.closed = false;
};

// Snapshot database API

Memory.prototype.close = function() {};

Memory.prototype.getSnapshot = function(cName, docName, callback) {
  var c = this.collections[cName];
  callback(null, c ? c[docName] : null);
};

Memory.prototype.setSnapshot = function(cName, docName, snapshot, callback) {
  var c = this.collections[cName] = this.collections[cName] || {};

  c[docName] = snapshot;
  callback();
};


// This function is optional - it just makes it faster for dedicated indexes
// (like SOLR) to get a whole bunch of complete documents to service queries.
// Its included here for demonstration purposes and so we can test our tests.
Memory.prototype.getBulkSnapshots = function(cName, docNames, callback) {
  var c = this.collections[cName];
  if (!c) return callback(null, []);

  var results = new Array(docNames.length);
  for (var i = 0; i < docNames.length; i++) {
    results[i] = c[docNames[i]];
  }
  callback(null, results);
};


// Thats it; thats the whole API.




// Query support API

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


