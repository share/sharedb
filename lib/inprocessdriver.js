var Readable = require('stream').Readable;
var EventEmitter = require('events').EventEmitter;
var util = require('./util');

function doNothing() {};

// This is an extra fancy/complicated name, but really this is just the bunch of default livedb
// methods that get swapped out for multi-server scalability provided by redis, foundationdb or
// whatever.
function InprocDriver(oplog) {
  if (!(this instanceof InprocDriver)) return new InprocDriver(oplog);

  this.oplog = oplog;
  if (!oplog.writeOp || !oplog.getVersion || !oplog.getOps) {
    throw new Error('Missing or invalid operation log');
  }

  // Emitter for channel messages. Event is the CD. Listener is called with (op)
  this.subscribers = new EventEmitter();
  // We will be registering a lot of events. Surpress warnings.
  this.subscribers.setMaxListeners(0);

  // Bookkeeping simply so we can 
  this.numStreams = 0;
  this.nextStreamId = 0;
  this.streams = {};

  // Cache of CD -> current doc version. This is needed because there's a potential race condition
  // where getOps could be missing an operation thats just been processed and as a result we'll
  // accept the same op for the same document twice. Data in here should be cleared out periodically
  // (like, 15 seconds after nobody has submitted to the document), but that logic hasn't been
  // implemented yet.
  this.versions = {};
}

module.exports = InprocDriver;

// Marker for tests so they don't try distributed tests using this driver.
InprocDriver.prototype.distributed = false;

InprocDriver.prototype.destroy = function() {
  // Dance!

  // .. We should close all the streams here.
  for (var id in this.streams) {
    var stream = this.streams[id];
    // This is a little inefficient - it removes the streams 1 by 1 from the subscribers event
    // emitter. We really just want to remove them all, and this way is n^2 with the number of
    // streams on a given document. But it should be fine for now.
    stream.destroy();
  }
};

InprocDriver.prototype.atomicSubmit = function(cName, docName, opData, options, callback) {
  // This is easy because we're the only instance in the cluster, so anything
  // that happens syncronously in javascript is safe.

  var cd = util.encodeCD(cName, docName);
  if (this.versions[cd] != null && this.versions[cd] > opData.v)
    return callback("Transform needed");

  this.versions[cd] = opData.v + 1;

  var self = this;
  this.oplog.writeOp(cName, docName, opData, function(err) {
    if (err) return callback(err);
    
    // Post the change to anyone who's interested.
    self.subscribers.emit(cd, opData);

    callback();
  });
};

InprocDriver.prototype.getOps = function(cName, docName, from, to, callback) {
  this.oplog.getOps(cName, docName, from, to, callback);
};

// Internal helper function which syncronously creates a stream, subscribes it and returns the
// stream.
InprocDriver.prototype._subscribeNow = function(cName, docName) {
  var cd = util.encodeCD(cName, docName);

  var stream = new Readable({objectMode:true});
  stream._read = doNothing;

  function listener(opData) {
    stream.push(opData);
  }
  this.subscribers.on(cd, listener);

  var self = this;
  stream.destroy = function() {
    this.destroy = doNothing;

    self.subscribers.removeListener(cd, listener);
    this.push(null);
    this.emit('close');
  }

  // For cleanup.
  var id = stream._id = this.nextStreamId++;
  this.streams[_id] = stream;
  return stream;
};

InprocDriver.prototype.subscribe = function(cName, docName, v, options, callback) {
  // Support old option-less subscribe semantics
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var stream = this._subscribeNow(cName, docName);

  this.oplog.getOps(cName, docName, v, null, function(err, ops) {
    if (err) {
      stream.destroy();
      return callback(err);
    }

    util.packOpStream(v, stream, ops);
    callback(null, stream);
  });
};


InprocDriver.prototype.bulkSubscribe = function(requests, callback) {
  var self = this;

  // Map from cName -> docName -> stream.
  var results = {};
  
  for (var cName in requests) {
    var docs = requests[cName];
    results[cName] = {};
    for (var docName in docs) {
      var version = docs[docName];
      results[cName][docName] = self._subscribeNow(cName, docName);
    }
  }

  var onError = function(err) {
    for (var cName in results) {
      var streams = results[cName];
      for (var docName in docs) {
        streams[docName].destroy();
      }
    }
    callback(err);
  };

  this.bulkGetOpsSince(requests, function(err, ops) {
    if (err) return onError(err);

    // Map from cName -> docName -> stream.
    for (var cName in results) {
      var reqs = requests[cName];
      var streams = results[cName];
      for (var docName in reqs) {
        var ops = ops[cName][docName];
        if (!ops) continue;
        var version = reqs[docName];
        var stream = streams[docName];
        util.packOpStream(version, stream, ops);
      }
    }
    callback(null, results);
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
InprocDriver.prototype.bulkGetOpsSince = function(requests, callback) {
  var results = {};
  var work = 1;
  var self = this;
  function done() {
    if (--work === 0)
      callback(null, results);
  }

  for (var cName in requests) {
    var versions = requests[cName];
    results[cName] = {};

    for (var docName in versions) {
      work++;
      (function(cName, docName) {
        self.oplog.getOps(cName, docName, versions[docName], null, function(err, ops) {
          if (err) return callback(err);
          if (ops.length) results[cName][docName] = ops;
          done();
        });
      })(cName, docName);
    }
  }

  done();
};









