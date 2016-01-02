var emitter = require('../emitter');
var types = require('../types');

/**
 * A Doc is a client's view on a sharejs document.
 *
 * It is is uniquely identified by its `id` and `collection`.  Documents
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
 * applied to our data. If the subscription was successful the initial
 * data and version sent by the server are loaded into the document.
 *
 * To stop listening to the changes we call `doc.unsubscribe()`.
 *
 * If we just want to load the data but not stay up-to-date, we call
 *   doc.fetch(function(error) {
 *     doc.data // sent by server
 *   })
 *
 *
 * Events
 * ------
 *
 * You can use doc.on(eventName, callback) to subscribe to the following events:
 * - `before op (op)` Fired before an operation is applied to the
 *   data. The document is already in locked state, so it is not allowed to
 *   submit further operations. It may be used to read the old data just
 *   before applying an operation. The callback is passed the operation if the
 *   operation originated locally and `false` otherwise
 * - `after op (op)` Fired after an operation has been applied to
 *   the data. The arguments are the same as for `before op`
 * - `op (op)` The same as `after op` unless incremental updates
 *   are enabled. In this case it is fired after every partial operation with
 *   this operation as the first argument. When fired the document is in a
 *   locked state which only allows reading operations.
 * - `create ()` The document was created. That means its type was
 *   set and it has some initial data.
 * - `del (data)` Fired after the document is deleted, that is
 *   the data is null. It is passed the data before delteion as an
 *   arguments
 *
 */

module.exports = Doc;
function Doc(connection, collection, id) {
  emitter.EventEmitter.call(this);

  this.connection = connection;

  this.collection = collection;
  this.id = id;

  this.version = null;
  this.type = null;
  this.data = undefined;

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

  // Prevents submit from accepting operations
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


// ****** Manipulating the document data, version and type.

// Set the document's type, and associated properties. Most of the logic in
// this function exists to update the document based on any added & removed API
// methods.
//
// @param newType OT type provided by the ottypes library or its name or uri
Doc.prototype._setType = function(newType) {
  if (typeof newType === 'string') {
    newType = types.map[newType];
  }

  if (newType) {
    this.type = newType;

  } else if (newType === null) {
    this.type = newType;
    // If we removed the type from the object, also remove its data
    this.data = undefined;

  } else {
    var err = new Error('Missing type ' + newType);
    return this.emit('error', err);
  }
};

// Ingest snapshot data. This data must include a version, snapshot and type.
// This is used both to ingest data that was exported with a webpage and data
// that was received from the server during a fetch.
//
// @param snapshot.v    version
// @param snapshot.data
// @param snapshot.type
// @param callback
Doc.prototype.ingestSnapshot = function(snapshot, callback) {
  if (!snapshot) return callback && callback();

  if (typeof snapshot.v !== 'number') {
    var err = new Error('Missing version in ingested snapshot. ' + this.collection + '.' + this.id);
    if (callback) return callback(err);
    return this.emit('error', err);
  }

  // If the doc is already created or there are ops pending, we cannot use the
  // ingested snapshot and need ops in order to update the document
  if (this.type || this.hasWritePending()) {
    // The version should only be null on a created document when it was
    // created locally without fetching
    if (this.version == null) {
      if (this.hasWritePending()) {
        // If we have pending ops and we get a snapshot for a locally created
        // document, we have to wait for the pending ops to complete, because
        // we don't know what version to fetch ops from. It is possible that
        // the snapshot came from our local op, but it is also possible that
        // the doc was created remotely (which would conflict and be an error)
        return callback && this.once('no write pending', callback);
      }
      // Otherwise, we've encounted an error state
      var err = new Error('Cannot ingest snapshot in doc with null version. ' + this.collection + '.' + this.id);
      if (callback) return callback(err);
      return this.emit('error', err);
    }
    // If we got a snapshot for a version further along than the document is
    // currently, issue a fetch to get the latest ops and catch us up
    if (snapshot.v > this.version) return this.fetch(callback);
    return callback && callback();
  }

  // Ignore the snapshot if we are already at a newer version. Under no
  // circumstance should we ever set the current version backward
  if (this.version > snapshot.v) return callback && callback();

  this.version = snapshot.v;
  this.data = snapshot.data;
  var type = (snapshot.type === undefined) ? types.defaultType : snapshot.type;
  this._setType(type);
  this.emit('load');
  callback && callback();
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
  if (this.hasWritePending()) return;
  this.emit('no write pending');
  if (this.hasPending()) return;
  this.emit('nothing pending');
};

// **** Helpers for network messages

Doc.prototype._emitResponseError = function(err, callback) {
  if (callback) {
    callback(err);
    this._emitNothingPending();
    return;
  }
  this._emitNothingPending();
  this.emit('error', err);
};

Doc.prototype._handleFetch = function(err, snapshot) {
  var callback = this.inflightFetch.shift();
  if (err) return this._emitResponseError(err, callback);
  this.ingestSnapshot(snapshot, callback);
  this._emitNothingPending();
};

Doc.prototype._handleSubscribe = function(err, snapshot) {
  var callback = this.inflightSubscribe.shift();
  if (err) return this._emitResponseError(err, callback);
  this.subscribed = true;
  this.ingestSnapshot(snapshot, callback);
  this._emitNothingPending();
};

Doc.prototype._handleUnsubscribe = function(err) {
  var callback = this.inflightUnsubscribe.shift();
  this.subscribed = false;
  if (err) return this._emitResponseError(err, callback);
  if (callback) callback();
  this._emitNothingPending();
};

Doc.prototype._handleOp = function(err, message) {
  if (err) {
    if (this.inflightOp) {
      // The server has rejected submission of the current operation. If we get
      // an error code 4002 "Op submit rejected", this was done intentionally
      // and we should roll back but not return an error to the user.
      if (err.code === 4002) err = null;
      return this._rollback(err);
    }
    return this.emit('error', err);
  }

  if (this.inflightOp &&
      message.src === this.inflightOp.src &&
      message.seq === this.inflightOp.seq) {
    // The op has already been applied locally. Just update the version
    // and pending state appropriately
    this._opAcknowledged(message);
    return;
  }

  if (this.version == null || message.v > this.version) {
    // This will happen in normal operation if we become subscribed to a
    // new document via a query. It can also happen if we get an op for
    // a future version beyond the version we are expecting next. This
    // could happen if the server doesn't publish an op for whatever reason
    // or because of a race condition. In any case, we can send a fetch
    // command to catch back up.
    //
    // Fetch only sends a new fetch command if no fetches are inflight, which
    // will act as a natural debouncing so we don't send multiple fetch
    // requests for many ops received at once.
    this.fetch();
    return;
  }

  if (message.v < this.version) {
    // We can safely ignore the old (duplicate) operation.
    return;
  }

  if (this.inflightOp) {
    var transformErr = transformX(this.inflightOp, message);
    if (transformErr) return this._hardRollback(transformErr);
  }

  for (var i = 0; i < this.pendingOps.length; i++) {
    var transformErr = transformX(this.pendingOps[i], message);
    if (transformErr) return this._hardRollback(transformErr);
  }

  this.version++;
  this._otApply(message, false);
  return;
};

// Called whenever (you guessed it!) the connection state changes. This will
// happen when we get disconnected & reconnect.
Doc.prototype._onConnectionStateChanged = function() {
  if (this.connection.canSend) {
    this.flush();
    this._resubscribe();
  } else {
    if (this.inflightOp) {
      this.pendingOps.unshift(this.inflightOp);
      this.inflightOp = null;
    }
    this.subscribed = false;
    if (this.inflightFetch.length || this.inflightSubscribe.length) {
      this.pendingFetch = this.pendingFetch.concat(this.inflightFetch, this.inflightSubscribe);
      this.inflightFetch.length = 0;
      this.inflightSubscribe.length = 0;
    }
    if (this.inflightUnsubscribe.length) {
      var callbacks = this.inflightUnsubscribe;
      this.inflightUnsubscribe = [];
      callEach(callbacks);
    }
  }
};

Doc.prototype._resubscribe = function() {
  var callbacks = this.pendingFetch;
  this.pendingFetch = [];

  if (this.wantSubscribe) {
    if (callbacks.length) {
      this.subscribe(function(err) {
        callEach(callbacks, err);
      });
      return;
    }
    this.subscribe();
    return;
  }

  if (callbacks.length) {
    this.fetch(function(err) {
      callEach(callbacks, err);
    });
  }
};

// Request the current document snapshot or ops that bring us up to date
Doc.prototype.fetch = function(callback) {
  if (this.connection.canSend) {
    var isDuplicate;
    if (this.inflightFetch.length > 1) {
      // If we already have a fetch queued up after the current fetch, there
      // is no need to send an additional fetch message, since sending only
      // one message will get us up to date as of now. If we have only one
      // fetch inflight, we do need to send an additional message, since the
      // data may have changed in the time since sending the first fetch. In
      // contrast, subscribe and unsubscribe are stateful (the server keeps
      // track of whether the agent for this client should be subscribed), so
      // those messages are always sent
      isDuplicate = true;
    } else {
      isDuplicate = this.connection.sendFetch(this);
    }
    pushActionCallback(this.inflightFetch, isDuplicate, callback);
    return;
  }
  this.pendingFetch.push(callback);
};

// Fetch the initial document and keep receiving updates
Doc.prototype.subscribe = function(callback) {
  this.wantSubscribe = true;
  if (this.connection.canSend) {
    var isDuplicate = this.connection.sendSubscribe(this);
    pushActionCallback(this.inflightSubscribe, isDuplicate, callback);
    return;
  }
  this.pendingFetch.push(callback);
};

// Unsubscribe. The data will stay around in local memory, but we'll stop
// receiving updates
Doc.prototype.unsubscribe = function(callback) {
  this.wantSubscribe = false;
  if (this.connection.canSend) {
    var isDuplicate = this.connection.sendUnsubscribe(this);
    pushActionCallback(this.inflightUnsubscribe, isDuplicate, callback);
    return;
  }
  if (callback) process.nextTick(callback);
};

function pushActionCallback(inflight, isDuplicate, callback) {
  if (isDuplicate) {
    var lastCallback = inflight.pop();
    inflight.push(function(err) {
      lastCallback && lastCallback(err);
      callback && callback(err);
    });
  } else {
    inflight.push(callback);
  }
}


// Operations //

// Send the next pending op to the server, if we can.
//
// Only one operation can be in-flight at a time. If an operation is already on
// its way, or we're not currently connected, this method does nothing.
Doc.prototype.flush = function() {
  // Ignore if we can't send or we are already sending an op
  if (!this.connection.canSend || this.inflightOp) return;

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

// Try to compose op2 into op1. Returns truthy if it succeeds, otherwise falsy.
function tryCompose(type, op1, op2) {
  if (op1.create && op2.op) {
    op1.create.data = type.apply(op1.create.data, op2.op);
    return true;
  }

  if (op1.op && op2.op && type.compose) {
    op1.op = type.compose(op1.op, op2.op);
    return true;
  }

  return false;
}

// Transform server op data by a client op, and vice versa. Ops are edited in place.
function transformX(client, server) {
  // Order of statements in this function matters. Be especially careful if
  // refactoring this function

  // A client delete op should dominate if both the server and the client
  // delete the document. Thus, any ops following the client delete (such as a
  // subsequent create) will be maintained, since the server op is transformed
  // to a no-op
  if (client.del) return setNoOp(server);

  if (server.del) {
    return new Error('Document was deleted');
  }
  if (server.create) {
    return new Error('Document alredy created');
  }

  // Ignore no-op coming from server
  if (!server.op) return;

  // I believe that this should not occur, but check just in case
  if (client.create) {
    return new Error('Document already created');
  }

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
};

/**
 * Applies the operation to the snapshot
 *
 * If the operation is create or delete it emits `create` or `del`. Then the
 * operation is applied to the snapshot and `op` and `after op` are emitted.
 * If the type supports incremental updates and `this.incremental` is true we
 * fire `op` after every small operation.
 *
 * This is the only function to fire the above mentioned events.
 *
 * @private
 */
Doc.prototype._otApply = function(op, source) {
  if (op.op) {

    if (!this.type) {
      var err = new Error('Cannot apply op to uncreated document. ' + this.collection + '.' + this.id);
      return this.emit('error', err);
    }
    var type = this.type;

    // This exists so clients can pull any necessary data out of the snapshot
    // before it gets changed.
    this.emit('before op', op.op, source);

    // Apply the operation to the local data
    if (type.incrementalApply) {
      var doc = this;
      this.locked = true;
      type.incrementalApply(this.data, op.op, function(component, data) {
        doc.data = data;
        doc.emit('op', component, source);
      });
      this.locked = false;
    } else {
      this.data = type.apply(this.data, op.op);
      this.emit('op', op.op, source);
    }

    this.emit('after op', op.op, source);
    return;
  }

  if (op.create) {
    // If the type is currently set, it means we tried creating the document
    // and someone else won. client create x server create = server create.
    this._setType(op.create.type);
    this.data = this.type.create(op.create.data);
    this.emit('create', source);
    return;
  }

  if (op.del) {
    // The type should always exist in this case. del x _ = del
    var oldData = this.data;
    this._setType(null);
    this.emit('del', oldData, source);
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

// Actually send op to the server.
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
  var op = this.inflightOp;
  if (!op) {
    var err = new Error('No op to send on call to _sendOp');
    return this.emit('error', err);
  }

  // Track data for retrying ops
  op.sentAt = Date.now();
  op.retries = (op.retries == null) ? 0 : op.retries + 1;

  // The src + seq number is a unique ID representing this operation. This tuple
  // is used on the server to detect when ops have been sent multiple times and
  // on the client to match acknowledgement of an op back to the inflightOp.
  // Note that the src could be different from this.connection.id after a
  // reconnect, since an op may still be pending after the reconnection and
  // this.connection.id will change. In case an op is sent multiple times, we
  // also need to be careful not to override the original seq value.
  if (op.seq == null) op.seq = this.connection.seq++;

  this.connection.sendOp(this, op);

  // src isn't needed on the first try, since the server session will have the
  // same id, but it must be set on the inflightOp in case it is sent again
  // after a reconnect and the connection's id has changed by then
  if (op.src == null) op.src = src;
};


// Queues the operation for submission to the server and applies it locally.
//
// Internal method called to do the actual work for submit(), create() and del().
// @private
//
// @param op
// @param [op.op]
// @param [op.del]
// @param [op.create]
// @param [callback] called when operation is submitted
Doc.prototype._submit = function(op, source, callback) {
  if (source == null) source = true;

  if (this.locked) {
    var err = new Error('Cannot submit op inside an op event handler. ' + this.collection + '.' + this.id);
    if (callback) return callback(err);
    return this.emit('error', err);
  }

  // The op contains either op, create, delete, or none of the above (a no-op).
  if (op.op) {
    if (!this.type) {
      var err = new Error('Cannot submit op. Document has not been created. ' + this.collection + '.' + this.id);
      if (callback) return callback(err);
      return this.emit('error', err);
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
  operation.callbacks.push(callback);

  this._otApply(op, source);

  // The call to flush is delayed so if submit() is called multiple times
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
// @param source
// @param [callback] called after operation submitted
//
// @fires before op, op, after op
Doc.prototype.submitOp = function(op, source, callback) {
  if (typeof source === 'function') {
    callback = source;
    source = null;
  }
  this._submit({op: op}, source, callback);
};

// Create the document, which in ShareJS semantics means to set its type. Every
// object implicitly exists in the database but has no data and no type. Create
// sets the type of the object and can optionally set some initial data on the
// object, depending on the type.
//
// @param data  initial
// @param type  OT type
// @param source
// @param callback  called when operation submitted
Doc.prototype.create = function(data, type, source, callback) {
  if (typeof type === 'function') {
    callback = type;
    source = null;
    type = null;
  } else if (typeof source === 'function') {
    callback = source;
    source = null;
  }
  if (!type) {
    type = types.defaultType.uri;
  }
  if (this.type) {
    var err = new Error('Document already exists');
    if (callback) return callback(err);
    return this.emit('error', err);
  }

  var op = {create: {type: type, data: data}};
  this._submit(op, source, callback);
};

// Delete the document. This creates and submits a delete operation to the
// server. Deleting resets the object's type to null and deletes its data. The
// document still exists, and still has the version it used to have before you
// deleted it (well, old version +1).
//
// @param source
// @param callback  called when operation submitted
Doc.prototype.del = function(source, callback) {
  if (typeof source === 'function') {
    callback = source;
    source = null;
  }
  if (!this.type) {
    var err = new Error('Document does not exist');
    if (callback) return callback(err);
    return this.emit('error', err);
  }

  this._submit({del: true}, source, callback);
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
Doc.prototype._opAcknowledged = function(message) {
  if (this.inflightOp.create) {
    this.version = message.v;

  } else if (message.v !== this.version) {
    // We should already be at the same version, because the server should
    // have sent all the ops that have happened before acknowledging our op
    console.warn('Invalid version from server. Expected: ' + this.version + ' Received: ' + message.v, message);

    // Fetching should get us back to a working document state
    return this.fetch();
  }

  // The op was committed successfully. Increment the version number
  this.version++;

  this._clearInflightOp();
};

Doc.prototype._rollback = function(err) {
  // The server has rejected submission of the current operation. Invert by
  // just the inflight op if possible. If not possible to invert, cancel all
  // pending ops and fetch the latest from the server to get us back into a
  // working state, then call back
  var op = this.inflightOp;

  if (op.op && op.type.invert) {
    op.op = op.type.invert(op.op);

    // Transform the undo operation by any pending ops.
    for (var i = 0; i < this.pendingOps.length; i++) {
      var transformErr = transformX(this.pendingOps[i], op);
      if (transformErr) return this._hardRollback(transformErr);
    }

    // ... and apply it locally, reverting the changes.
    //
    // This operation is applied to look like it comes from a remote source.
    // I'm still not 100% sure about this functionality, because its really a
    // local op. Basically, the problem is that if the client's op is rejected
    // by the server, the editor window should update to reflect the undo.
    this._otApply(op, false);

    this._clearInflightOp(err);
    return;
  }

  this._hardRollback(err);
};

Doc.prototype._hardRollback = function(err) {
  // Cancel all pending ops and reset if we can't invert
  var op = this.inflightOp;
  var pending = this.pendingOps;
  this._setType(null);
  this.version = null;
  this.inflightOp = null;
  this.pendingOps = [];

  // Fetch the latest from the server to get us back into a working state
  var doc = this;
  this.fetch(function() {
    var called = op && callEach(op.callbacks, err);
    for (var i = 0; i < pending.length; i++) {
      callEach(pending[i].callbacks, err);
    }
    if (err && !called) return doc.emit('error', err);
  });
};

Doc.prototype._clearInflightOp = function(err) {
  var called = callEach(this.inflightOp.callbacks, err);

  this.inflightOp = null;
  this.flush();
  this._emitNothingPending();

  if (err && !called) return this.emit('error', err);
};

function callEach(callbacks, err) {
  var called = false;
  for (var i = 0; i < callbacks.length; i++) {
    var callback = callbacks[i];
    if (callback) {
      callback(err);
      called = true;
    }
  }
  return called;
}
