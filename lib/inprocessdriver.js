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

  // Emitter for channel messages. Ops are emitted on both the doc's CD and its collection name.
  // Listener is called with (op, channel)
  this.subscribers = new EventEmitter();
  // We will be registering a lot of events. Surpress warnings.
  this.subscribers.setMaxListeners(0);

  // Bookkeeping simply so we can
  this.numStreams = 0;
  this.nextStreamId = 0;
  this.streams = {};

  // Map from list name -> list of dirty data.
  this.dirtyLists = {};
  // A map from dirty list name -> waiting callback
  this.dirtyWaiters = {};

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

InprocDriver.prototype.appendDirtyData = function(data) {
  for (var listName in data) {
    if (!this.dirtyLists[listName]) this.dirtyLists[listName] = [];

    this.dirtyLists[listName].push(data[listName]);

    var fn = this.dirtyWaiters[listName];
    if (fn) {
      this.dirtyWaiters[listName] = null;
      fn();
    }
  }
};

InprocDriver.prototype.atomicSubmit = function(cName, docName, opData, options, callback) {
  // This is easy because we're the only instance in the cluster, so anything
  // that happens syncronously in javascript is safe.

  var cd = util.encodeCD(cName, docName);
  if (this.versions[cd] != null && this.versions[cd] > opData.v) {
    process.nextTick(function() {
      callback("Transform needed");
    });
    return;
  }

  this.versions[cd] = opData.v + 1;

  if (options && options.dirtyData) this.appendDirtyData(options.dirtyData);

  var self = this;
  this.oplog.writeOp(cName, docName, opData, function(err) {
    if (err) return callback(err);

    callback();
  });
};

InprocDriver.prototype.postSubmit = function(cName, docName, opData, snapshot, options) {
  opData.collection = cName;
  opData.docName = docName;

  // Post the change to anyone who's interested.
  var cd = util.encodeCD(cName, docName);
  this.subscribers.emit(cd, opData);

  if (options && options.suppressCollectionPublish) return;

  this.subscribers.emit(cName, opData, cName);
};

InprocDriver.prototype.consumeDirtyData = function(listName, options, consumeFn, callback) {
  if (this.dirtyWaiters[listName]) throw Error('Cannot have multiple readers of the list');

  var data = this.dirtyLists[listName];
  var wait = options.wait;
  var limit = options.limit;

  if (!data || data.length === 0) {
    if (!wait) return process.nextTick(callback);

    // Schedule consuming the slice when the data is here.
    var self = this;
    this.dirtyWaiters[listName] = function() {
      // This is easier than copy+pasting the above logic.
      self.consumeDirtyData(listName, options, consumeFn, callback);
    };
    return;
  }

  var slice = (limit && data.length > limit) ? data.slice(0, limit) : data;
  var num = slice.length;
  consumeFn(slice, function(err) {
    if (err) return callback(err);

    data.splice(0, num);
    callback();
  });
};

InprocDriver.prototype.getOps = function(cName, docName, from, to, callback) {
  this.oplog.getOps(cName, docName, from, to, callback);
};

InprocDriver.prototype._createStream = function(v) {
  var stream = new util.OpStream(v);

  // For cleanup.
  var id = stream._id = this.nextStreamId++;
  this.streams[id] = stream;
  this.numStreams++;

  return stream;
};

// Called from stream emitting a close, which happens when you call .destroy on the stream.
InprocDriver.prototype._cleanupStream = function(stream) {
  if (!this.streams[stream._id]) return;
  this.numStreams--;
  delete this.streams[stream._id];
};

// Internal helper function which syncronously creates a stream, subscribes it and returns the
// stream.
InprocDriver.prototype._subscribeNow = function(cName, docName, v) {
  var stream = this._createStream(v);

  function listener(opData) {
    stream.pushOp(opData);
  }

  var cd = util.encodeCD(cName, docName);
  this.subscribers.on(cd, listener);

  var self = this;
  stream.once('close', function() {
    self.subscribers.removeListener(cd, listener);
    self._cleanupStream(stream);
  });

  return stream;
};

// Subscribe to changes on a set of collections. This is used by livedb's polling query code.
InprocDriver.prototype.subscribeCollection = function(cName, callback) {
  var stream = this._createStream();

  function listener(opData, channel) {
    // This is all a bit of a hack. When we have proper indexing, I'd love to rip this code out.
    opData.channel = channel;
    stream.push(opData);
  }

  this.subscribers.on(cName, listener);

  var self = this;
  stream.once('close', function() {
    self.subscribers.removeListener(cName, listener);
    self._cleanupStream(stream);
  });

  process.nextTick(function() {
    callback(null, stream);
  });
};

InprocDriver.prototype.subscribe = function(cName, docName, v, options, callback) {
  var stream = this._subscribeNow(cName, docName, v);

  this.oplog.getOps(cName, docName, v, null, function(err, ops) {
    if (err) {
      stream.destroy();
      return callback(err);
    }

    stream.pack(v, ops);
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
      results[cName][docName] = self._subscribeNow(cName, docName, version);
    }
  }

  this.bulkGetOpsSince(requests, function(err, ops) {
    if (err) {
      for (var cName in results) {
        var streams = results[cName];
        for (var docName in docs) {
          streams[docName].destroy();
        }
      }
      callback(err);
    }

    // Map from cName -> docName -> stream.
    for (var cName in results) {
      var reqs = requests[cName];
      var streams = results[cName];
      for (var docName in reqs) {
        var o = ops[cName][docName];
        if (!o) continue;
        var version = reqs[docName];
        var stream = streams[docName];
        stream.pack(version, o);
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
  var errored = false;
  function done(err) {
    if (errored) return;
    if (err) {
      errored = true;
      return callback(err);
    }
    work--;
    if (!work) callback(null, results);
  }
  var self = this;
  for (var cName in requests) {
    var versions = requests[cName];
    results[cName] = {};
    for (var docName in versions) {
      work++;
      self._getOpsSince(cName, docName, versions[docName], results, done);
    }
  }
  done();
};

InprocDriver.prototype._getOpsSince = function(cName, docName, version, results, done) {
  this.oplog.getOps(cName, docName, version, null, function(err, ops) {
    if (err) return done(err);
    if (ops.length) results[cName][docName] = ops;
    done();
  });
};

// This is called from our tests to make sure we don't leak anything. It should check to make sure
// the state is valid, and if allowSubscriptions is false, we shouldn't have any outstanding
// subscriptions at all.
InprocDriver.prototype._checkForLeaks = function(allowSubscriptions, callback) {
  if (!allowSubscriptions && this.numStreams) {
    console.log(this);
    throw Error('Leak detected - still ' + this.numStreams + ' outstanding subscription(s)');
  }

  if (Object.keys(this.streams).length !== this.numStreams) {
    console.error('numStreams:', this.numStreams, 'this.streams:', this.streams);
    throw Error('this.numStreams does not match this.streams');
  }

  // We should probably also check the listeners on the emitter.
  if (callback) callback();
};
