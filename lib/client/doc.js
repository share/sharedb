var types = require('../types').map;
var emitter = require('../emitter');

/**
 * A Doc is a client's view on a sharejs document.
 *
 * It is is uniquely identified by its `name` and `collection`.  Documents
 * should not be created directly. Create them with Connection.get()
 *
 *
 * Subscriptions
 * -------------
 *
 * We can subscribe a document to stay in sync with the server.
 *   doc.subscribe(function(error) {
 *     doc.subscribed // = true
 *   })
 * The server now sends us all changes concerning this document and these are
 * applied to our snapshot. If the subscription was successful the initial
 * snapshot and version sent by the server are loaded into the document.
 *
 * To stop listening to the changes we call `doc.unsubscribe()`.
 *
 * If we just want to load the data but not stay up-to-date, we call
 *   doc.fetch(function(error) {
 *     doc.snapshot // sent by server
 *   })
 *
 *
 * Events
 * ------
 *
 * You can use doc.on(eventName, callback) to subscribe to the following events:
 * - `before op (op)` Fired before an operation is applied to the
 *   snapshot. The document is already in locked state, so it is not allowed to
 *   submit further operations. It may be used to read the old snapshot just
 *   before applying an operation. The callback is passed the operation if the
 *   operation originated locally and `false` otherwise
 * - `after op (op)` Fired after an operation has been applied to
 *   the snapshot. The arguments are the same as for `before op`
 * - `op (op)` The same as `after op` unless incremental updates
 *   are enabled. In this case it is fired after every partial operation with
 *   this operation as the first argument. When fired the document is in a
 *   locked state which only allows reading operations.
 * - `create ()` The document was created. That means its type was
 *   set and it has some initial data.
 * - `del (snapshot)` Fired after the document is deleted, that is
 *   the snapshot is null. It is passed the snapshot before delteion as an
 *   arguments
 *
 */

module.exports = Doc;
function Doc(connection, collection, name) {
  emitter.EventEmitter.call(this);

  this.connection = connection;

  this.collection = collection;
  this.name = name;

  this.version = this.type = null;
  this.snapshot = undefined;

  // Array of callbacks or nulls as placeholders
  this.inflightFetch = [];
  this.inflightSubscribe = [];
  this.inflightUnsubscribe = [];
  this.pendingFetch = [];

  // Whether we think we are subscribed on the server
  this.subscribed = false;
  // Whether to re-establish the subscription on reconnect
  this.wantSubscribe = false;

  // The op that is currently roundtripping to the server, or null.
  //
  // When the connection reconnects, the inflight op is resubmitted.
  //
  // This has the same format as an entry in pendingOps
  this.inflightOp = null;

  // All ops that are waiting for the server to acknowledge this.inflightOp
  // This used to just be a single operation, but creates & deletes can't be
  // composed with regular operations.
  //
  // This is a list of {[create:{...}], [del:true], [op:...], callbacks:[...]}
  this.pendingOps = [];

  // The OT type of this document.
  //
  // The document also responds to the api provided by the type
  this.type = null;

  // Prevents submitOp from accepting operations
  this.locked = false;
}
emitter.mixin(Doc);

Doc.prototype.destroy = function(callback) {
  var doc = this;
  doc.whenNothingPending(function() {
    doc.connection._destroyDoc(doc);
    if (doc.wantSubscribe) {
      return doc.unsubscribe(callback);
    }
    if (callback) callback();
  });
};


// ****** Manipulating the document snapshot, version and type.

// Set the document's type, and associated properties. Most of the logic in
// this function exists to update the document based on any added & removed API
// methods.
//
// @param newType OT type provided by the ottypes library or its name or uri
Doc.prototype._setType = function(newType) {
  if (typeof newType === 'string') {
    if (!types[newType]) throw new Error('Missing type ' + newType);
    newType = types[newType];
  }

  // Set the new type
  this.type = newType;

  // If we removed the type from the object, also remove its snapshot.
  if (!newType) {
    this.snapshot = undefined;
  }
};

// Ingest snapshot data. This data must include a version, snapshot and type.
// This is used both to ingest data that was exported with a webpage and data
// that was received from the server during a fetch.
//
// @param data.v    version
// @param data.data
// @param data.type
Doc.prototype.ingestData = function(data) {
  // Ignore if the document is already created
  if (this.type) return;

  if (typeof data.v !== 'number') {
    throw new Error('Missing version in ingested data ' + this.collection + ' ' + this.name);
  }
  this.version = data.v;
  this.snapshot = data.data;
  this._setType(data.type);
  this.emit('ready');
};

Doc.prototype.whenNothingPending = function(callback) {
  if (this.hasPending()) {
    this.once('nothing pending', callback);
    return;
  }
  callback();
};

Doc.prototype.hasPending = function() {
  return !!(
    this.inflightOp ||
    this.pendingOps.length ||
    this.inflightFetch.length ||
    this.inflightSubscribe.length ||
    this.inflightUnsubscribe.length ||
    this.pendingFetch.length
  );
};

Doc.prototype.hasWritePending = function() {
  return !!(this.inflightOp || this.pendingOps.length);
};

Doc.prototype._emitNothingPending = function() {
  if (this.hasPending()) return;
  this.emit('nothing pending');
};

// **** Helpers for network messages

Doc.prototype._handleFetch = function(err, data) {
  var callback = this.inflightFetch.shift();
  if (err) return callback && callback(err);
  if (data) this.ingestData(data);
  callback && callback();
};

Doc.prototype._handleSubscribe = function(err, data) {
  var callback = this.inflightSubscribe.shift();
  if (err) return callback && callback(err);
  if (data) this.ingestData(data);
  this.subscribed = true;
  callback && callback();
};

Doc.prototype._handleUnsubscribe = function(err) {
  var callback = this.inflightUnsubscribe.shift();
  if (err) return callback && callback(err);
  this.subscribed = false;
  callback && callback();
};

Doc.prototype._handleOp = function(err, msg) {
  if (this.inflightOp && err) {
    this._rollback(err);
    return;
  }

  if (this.inflightOp &&
      msg.src === this.inflightOp.src &&
      msg.seq === this.inflightOp.seq) {
    // The op has already been applied locally. Just update the version
    // and pending state appropriately
    this._opAcknowledged(msg);
    return;
  }

  if (this.version == null || msg.v > this.version) {
    // This will happen in normal operation if we become subscribed to a
    // new document via a query. It can also happen if we get an op for
    // a future version beyond the version we are expecting next. This
    // could happen if the server doesn't publish an op for whatever reason
    // or because of a race condition. In any case, we can send a fetch
    // command to catch back up.
    if (this.inflightFetch.length || this.inflightSubscribe.length) return;
    this.fetch();
    return;
  }

  if (msg.v < this.version) {
    // We can safely ignore the old (duplicate) operation.
    return;
  }

  if (this.inflightOp) transformX(this.inflightOp, msg);

  for (var i = 0; i < this.pendingOps.length; i++) {
    transformX(this.pendingOps[i], msg);
  }

  this.version++;
  this._otApply(msg, false);
  return;
};

// Called whenever (you guessed it!) the connection state changes. This will
// happen when we get disconnected & reconnect.
Doc.prototype._onConnectionStateChanged = function() {
  if (this.connection.canSend) {
    this.flush();
    this._resubscribe();
  } else {
    this.subscribed = false;
    if (this.inflightFetch.length || this.inflightSubscribe.length) {
      this.pendingFetch = this.pendingFetch.concat(this.inflightFetch, this.inflightSubscribe);
      this.inflightFetch.length = 0;
      this.inflightSubscribe.length = 0;
    }
    if (this.inflightUnsubscribe.length) {
      callEach(this.inflightUnsubscribe);
      this.inflightUnsubscribe.length = 0;
    }
  }
};

Doc.prototype._resubscribe = function() {
  if (this.wantSubscribe) {
    if (this.pendingFetch) {
      var callbacks = this.pendingFetch;
      this.pendingFetch.length = 0;
      this.subscribe(function(err) {
        callEach(callbacks, err);
      });
      return;
    }
    if (this.subscribed || this.inflightSubscribe.length) return;
    this.subscribe();
    return;
  }

  if (this.pendingFetch) {
    var callbacks = this.pendingFetch;
    this.pendingFetch.length = 0;
    this.fetch(function(err) {
      callEach(callbacks, err);
    });
  }
};

// Fetch the initial document and keep receiving updates
Doc.prototype.subscribe = function(callback) {
  this.wantSubscribe = true;
  if (this.connection.canSend) {
    this.inflightSubscribe.push(callback);
    this.connection.sendSubscribe(this);
    return;
  }
  if (callback) this.pendingFetch.push(callback);
};

// Unsubscribe. The data will stay around in local memory, but we'll stop
// receiving updates
Doc.prototype.unsubscribe = function(callback) {
  this.wantSubscribe = false;
  if (this.connection.canSend) {
    this.inflightUnsubscribe.push(callback);
    this.connection.sendUnsubscribe(this);
    return;
  }
  if (callback) process.nextTick(callback);
};

// Request the current document snapshot or ops that bring us up to date
Doc.prototype.fetch = function(callback) {
  if (this.connection.canSend) {
    this.inflightFetch.push(callback);
    this.connection.sendFetch(this);
    return;
  }
  if (callback) this.pendingFetch.push(callback);
};


// Operations //

// Send the next pending op to the server, if we can.
//
// Only one operation can be in-flight at a time. If an operation is already on
// its way, or we're not currently connected, this method does nothing.
Doc.prototype.flush = function() {
  // Ignore if we can't send or we are already sending an op
  if (!this.connection.canSend || this.inflightOp) return;

  // Clear any no-ops from the front of the pending op list.
  while (this.pendingOps.length && isNoOp(this.pendingOps[0])) {
    var op = this.pendingOps.shift();
    callEach(op.callbacks);
  }

  // Send first pending op unless paused
  if (!this.paused && this.pendingOps.length) {
    this._sendOp();
  }
};

// Helper function to set op to contain a no-op.
function setNoOp(op) {
  delete op.op;
  delete op.create;
  delete op.del;
}

function isNoOp(op) {
  return !op.op && !op.create && !op.del;
}

// Try to compose data2 into data1. Returns truthy if it succeeds, otherwise falsy.
function tryCompose(type, data1, data2) {
  if (data1.create && data2.op) {
    data1.create.data = type.apply(data1.create.data, data2.op);
  } else if (data1.op && data2.op && type.compose) {
    data1.op = type.compose(data1.op, data2.op);
  } else if (data2.del || isNoOp(data1)) {
    data1.create = data2.create;
    data1.del = data2.del;
    data1.op = data2.op;
  } else {
    return false;
  }
  return true;
}

// Transform server op data by a client op, and vice versa. Ops are edited in place.
function transformX(client, server) {
  // In this case, we're in for some fun. There are some local operations
  // which are totally invalid - either the client continued editing a
  // document that someone else deleted or a document was created both on the
  // client and on the server. In either case, the local document is way
  // invalid and the client's ops are useless.
  //
  // The client becomes a no-op, and we keep the server op entirely.
  if (server.create || server.del) return setNoOp(client);
  if (client.create) throw new Error('Invalid state. This is a bug. ' + this.collection + ' ' + this.name);

  // The client has deleted the document while the server edited it. Kill the
  // server's op.
  if (client.del) return setNoOp(server);

  // We only get here if either the server or client ops are no-op. Carry on,
  // nothing to see here.
  if (!server.op || !client.op) return;

  // They both edited the document. This is the normal case for this function -
  // as in, most of the time we'll end up down here.
  //
  // You should be wondering why I'm using client.type instead of this.type.
  // The reason is, if we get ops at an old version of the document, this.type
  // might be undefined or a totally different type. By pinning the type to the
  // op data, we make sure the right type has its transform function called.
  var result = client.type.transformX(client.op, server.op);
  client.op = result[0];
  server.op = result[1];
}

/**
 * Applies the operation to the snapshot
 *
 * If the operation is create or delete it emits `create` or `del`.  Then the
 * operation is applied to the snapshot and `op` and `after op` are emitted.  If
 * the type supports incremental updates and `this.incremental` is true we fire
 * `op` after every small operation.
 *
 * This is the only function to fire the above mentioned events.
 *
 * @private
 */
Doc.prototype._otApply = function(op, context) {
  if (op.op) {
    if (!this.type) throw new Error('Cannot apply op to uncreated document ' + this.collection + '.' + this.name);
    var type = this.type;

    // This exists so clients can pull any necessary data out of the snapshot
    // before it gets changed.
    this.emit('before op', op.op, context);

    // Because this could be totally unnecessary work, its behind a flag. set
    // doc.incremental to enable.
    if (this.incremental && type.incrementalApply) {
      var doc = this;
      this.locked = true;
      type.incrementalApply(this.snapshot, op.op, function(component, snapshot) {
        doc.snapshot = snapshot;
        doc.emit('op', component, context);
      });
      this.locked = false;
    } else {
      // This is the default case, simply applying the operation to the local snapshot.
      this.snapshot = type.apply(this.snapshot, op.op);
      this.emit('op', op.op, context);
    }

    this.emit('after op', op.op, context);
    return;
  }

  if (op.create) {
    // If the type is currently set, it means we tried creating the document
    // and someone else won. client create x server create = server create.
    this._setType(op.create.type);
    this.snapshot = this.type.create(op.create.data);
    this.emit('create', context);
    return;
  }

  if (op.del) {
    // The type should always exist in this case. del x _ = del
    var oldSnapshot = this.snapshot;
    this._setType(null);
    this.emit('del', oldSnapshot, context);
    return;
  }
};


// ***** Sending operations

Doc.prototype.retry = function() {
  if (!this.inflightOp) return;
  var threshold = 5000 * Math.pow(2, this.inflightOp.retries);
  if (this.inflightOp.sentAt < Date.now() - threshold) {
    this.connection.emit('retry', this);
    this._sendOp();
  }
};

// Actually send op data to the server.
Doc.prototype._sendOp = function() {
  // Wait until we have a src id from the server
  var src = this.connection.id;
  if (!src) return;

  // When there is no inflightOp, send the first item in pendingOps. If
  // there is inflightOp, try sending it again
  if (!this.inflightOp) {
    // Send first pending op
    this.inflightOp = this.pendingOps.shift();
  }
  var data = this.inflightOp;
  if (!data) {
    throw new Error('no data to send on call to _sendOp');
  }

  // Track data for retrying ops
  data.sentAt = Date.now();
  data.retries = (data.retries == null) ? 0 : data.retries + 1;

  // The src + seq number is a unique ID representing this operation. This tuple
  // is used on the server to detect when ops have been sent multiple times and
  // on the client to match acknowledgement of an op back to the inflightOp.
  // Note that the src could be different from this.connection.id after a
  // reconnect, since an op may still be pending after the reconnection and
  // this.connection.id will change. In case an op is sent multiple times, we
  // also need to be careful not to override the original seq value.
  if (data.seq == null) data.seq = this.connection.seq++;

  this.connection.sendOp(this, data);

  // src isn't needed on the first try, since the server session will have the
  // same id, but it must be set on the inflightOp in case it is sent again
  // after a reconnect and the connection's id has changed by then
  if (data.src == null) data.src = src;
};


// Queues the operation for submission to the server and applies it locally.
//
// Internal method called to do the actual work for submitOp(), create() and del().
// @private
//
// @param op
// @param [op.op]
// @param [op.del]
// @param [op.create]
// @param [callback] called when operation is submitted
Doc.prototype._submitOp = function(op, context, callback) {
  if (typeof context === 'function') {
    callback = context;
    context = true; // The default context is true
  } else if (context == null) {
    context = true;
  }

  if (this.locked) {
    var err = new Error('Cannot call submitOp from inside an op event handler. ' + this.collection + ' ' + this.name);
    if (callback) return callback(err);
    throw err;
  }

  // The op contains either op, create, delete, or none of the above (a no-op).
  if (op.op) {
    if (!this.type) {
      var err = new Error('Document has not been created');
      if (callback) return callback(err);
      throw err;
    }
    // Try to normalize the op. This removes trailing skip:0's and things like that.
    if (this.type.normalize) op.op = this.type.normalize(op.op);
  }

  op.type = this.type;
  op.callbacks = [];

  // If the type supports composes, try to compose the operation onto the end
  // of the last pending operation.
  var operation;
  var previous = this.pendingOps[this.pendingOps.length - 1];

  if (previous && tryCompose(this.type, previous, op)) {
    operation = previous;
  } else {
    operation = op;
    this.pendingOps.push(op);
  }
  if (callback) operation.callbacks.push(callback);

  this._otApply(op, context);

  // The call to flush is delayed so if submitOp() is called multiple times
  // synchronously, all the ops are combined before being sent to the server.
  var doc = this;
  process.nextTick(function() {
    doc.flush();
  });
};


// *** Client OT entrypoints.

// Submit an operation to the document.
//
// @param operation handled by the OT type
// @param [callback] called after operation submitted
//
// @fires before op, op, after op
Doc.prototype.submitOp = function(op, context, callback) {
  this._submitOp({op: op}, context, callback);
};

// Create the document, which in ShareJS semantics means to set its type. Every
// object implicitly exists in the database but has no data and no type. Create
// sets the type of the object and can optionally set some initial data on the
// object, depending on the type.
//
// @param type  OT type
// @param data  initial
// @param callback  called when operation submitted
Doc.prototype.create = function(type, data, context, callback) {
  if (this.type) {
    var err = new Error('Document already exists');
    if (callback) return callback(err);
    throw err;
  }

  var op = {create: {type:type, data:data}};
  this._submitOp(op, context, callback);
};

// Delete the document. This creates and submits a delete operation to the
// server. Deleting resets the object's type to null and deletes its data. The
// document still exists, and still has the version it used to have before you
// deleted it (well, old version +1).
//
// @param callback  called when operation submitted
Doc.prototype.del = function(context, callback) {
  if (!this.type) {
    var err = new Error('Document does not exist');
    if (callback) return callback(err);
    throw err;
  }

  this._submitOp({del: true}, context, callback);
};


// Stops the document from sending any operations to the server.
Doc.prototype.pause = function() {
  this.paused = true;
};

// Continue sending operations to the server
Doc.prototype.resume = function() {
  this.paused = false;
  this.flush();
};


// *** Receiving operations

// This is called when the server acknowledges an operation from the client.
Doc.prototype._opAcknowledged = function(msg) {
  if (this.inflightOp.create) {
    this.version = msg.v;

  } else if (msg.v !== this.version) {
    // We should already be at the same version, because the server should
    // have sent all the ops that have happened before acknowledging our op
    console.warn('Invalid version from server. Expected: ' + this.version + ' Received: ' + msg.v, msg);

    // Fetching should get us back to a working document state
    return this.fetch();
  }

  // The op was committed successfully. Increment the version number
  this.version++;

  this._clearInflightOp();
};

// This will be called when the server rejects our operation for some reason.
Doc.prototype._rollback = function(err) {
  // The server has rejected an op from the client for an unexpected reason.
  // We'll send the error message to the user and try to roll back the change.
  var op = this.inflightOp;

  if (op.op && op.type.invert) {
    op.op = op.type.invert(op.op);

    // Transform the undo operation by any pending ops.
    for (var i = 0; i < this.pendingOps.length; i++) {
      transformX(this.pendingOps[i], op);
    }

    // ... and apply it locally, reverting the changes.
    //
    // This operation is applied to look like it comes from a remote context.
    // I'm still not 100% sure about this functionality, because its really a
    // local op. Basically, the problem is that if the client's op is rejected
    // by the server, the editor window should update to reflect the undo.
    this._otApply(op, false);

    this._clearInflightOp(err);
    return;
  }

  // Cancel all pending ops and reset if we can't invert
  var pending = this.pendingOps;
  this._setType(null);
  this.version = null;
  this.inflightOp = null;
  this.pendingOps = [];

  // Fetch the latest from the server to get us back into a working state
  this.fetch(function() {
    callEach(op.callbacks, err);
    for (var i = 0; i < pending.length; i++) {
      callEach(pending[i].callbacks, err);
    }
  });
};

Doc.prototype._clearInflightOp = function(err) {
  callEach(this.inflightOp.callbacks, err);

  this.inflightOp = null;
  this.flush();
  this._emitNothingPending();
};

function callEach(callbacks, err) {
  for (var i = 0; i < callbacks.length; i++) {
    var callback = callbacks[i];
    if (callback) callback(err);
  }
}
