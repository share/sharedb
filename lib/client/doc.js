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
 *     doc.state // = 'ready'
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
 * - `subscribed (error)` The document was subscribed
 * - `created ()` The document was created. That means its type was
 *   set and it has some initial data.
 * - `del (snapshot)` Fired after the document is deleted, that is
 *   the snapshot is null. It is passed the snapshot before delteion as an
 *   arguments
 * - `error`
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

  // **** State in document:

  // The action the document tries to perform with the server
  //
  // - subscribe
  // - unsubscribe
  // - fetch
  // - submit: send an operation
  this.action = null;

  // The data the document object stores can be in one of the following three states:
  //   - No data. (null) We honestly don't know whats going on.
  //   - Floating ('floating'): we have a locally created document that hasn't
  //     been created on the server yet)
  //   - Live ('ready') (we have data thats current on the server at some version).
  this.state = null;

  // Our subscription status. Either we're subscribed on the server, or we aren't.
  this.subscribed = false;
  // Either we want to be subscribed (true), we want a new snapshot from the
  // server ('fetch'), or we don't care (false). This is also used when we
  // disconnect & reconnect to decide what to do.
  this.wantSubscribe = false;
  // This list is used for subscribe and unsubscribe, since we'll only want to
  // do one thing at a time.
  this._subscribeCallbacks = [];


  // *** end state stuff.

  // This doesn't provide any standard API access right now.
  this.provides = {};

  // The op that is currently roundtripping to the server, or null.
  //
  // When the connection reconnects, the inflight op is resubmitted.
  //
  // This has the same format as an entry in pendingData, which is:
  // {[create:{...}], [del:true], [op:...], callbacks:[...], src:, seq:}
  this.inflightData = null;

  // All ops that are waiting for the server to acknowledge this.inflightData
  // This used to just be a single operation, but creates & deletes can't be
  // composed with regular operations.
  //
  // This is a list of {[create:{...}], [del:true], [op:...], callbacks:[...]}
  this.pendingData = [];

  // The OT type of this document.
  //
  // The document also responds to the api provided by the type
  this.type = null;

  // For debouncing getLatestOps calls
  this._getLatestTimeout = null;
}
emitter.mixin(Doc);

/**
 * Unsubscribe
 */
Doc.prototype.destroy = function(callback) {
  var doc = this;
  this.unsubscribe(function() {
    // Don't care if there's an error unsubscribing.

    if (doc.hasPending()) {
      doc.once('nothing pending', function() {
        doc.connection._destroyDoc(doc);
      });
    } else {
      doc.connection._destroyDoc(doc);
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
    if (!types[newType]) throw new Error('Missing type ' + newType + ' ' + this.collection + ' ' + this.name);
    newType = types[newType];
  }

  // Set the new type
  this.type = newType;

  // If we removed the type from the object, also remove its snapshot.
  if (!newType) {
    this.provides = {};
    this.snapshot = undefined;
  } else if (newType.api) {
    // Register the new type's API.
    this.provides = newType.api.provides;
  }
};

// Injest snapshot data. This data must include a version, snapshot and type.
// This is used both to ingest data that was exported with a webpage and data
// that was received from the server during a fetch.
//
// @param data.v    version
// @param data.data
// @param data.type
// @fires ready
Doc.prototype.ingestData = function(data) {
  if (typeof data.v !== 'number') {
    throw new Error('Missing version in ingested data ' + this.collection + ' ' + this.name);
  }
  if (this.state) {
    // Silently ignore if doc snapshot version is equal or newer
    // TODO: Investigate whether this should happen in practice or not
    if (this.version >= data.v) return;
    console.warn('Ignoring ingest data for', this.collection, this.name,
      '\n  in state:', this.state, '\n  version:', this.version,
      '\n  snapshot:\n', this.snapshot, '\n  incoming data:\n', data);
    return;
  }

  this.version = data.v;
  // data.data is what the server will actually send. data.snapshot is the old
  // field name - supported now for backwards compatibility.
  this.snapshot = data.data;
  this._setType(data.type);

  this.state = 'ready';
  this.emit('ready');
};

// Get and return the current document snapshot.
Doc.prototype.getSnapshot = function() {
  return this.snapshot;
};

// The callback will be called at a time when the document has a snapshot and
// you can start applying operations. This may be immediately.
Doc.prototype.whenReady = function(fn) {
  if (this.state === 'ready') {
    fn();
  } else {
    this.once('ready', fn);
  }
};

Doc.prototype.hasPending = function() {
  return this.action != null || this.inflightData != null || !!this.pendingData.length;
};

Doc.prototype._emitNothingPending = function() {
  if (this.hasPending()) return;
  this.emit('nothing pending');
};


// **** Helpers for network messages

// This function exists so connection can call it directly for bulk subscribes.
// It could just make a temporary object literal, thats pretty slow.
Doc.prototype._handleSubscribe = function(err, data) {
  if (err && err !== 'Already subscribed') {
    console.error('Could not subscribe:', err, this.collection, this.name);
    this.emit('error', err);
    // There's probably a reason we couldn't subscribe. Don't retry.
    this._setWantSubscribe(false, null, err);
    return;
  }
  if (data) this.ingestData(data);
  this.subscribed = true;
  this._clearAction();
  this.emit('subscribe');
  this._finishSub();
};

// This is called by the connection when it receives a message for the document.
Doc.prototype._onMessage = function(msg) {
  if (!(msg.c === this.collection && msg.d === this.name)) {
    // This should never happen - its a sanity check for bugs in the connection code.
    var err = 'Got message for wrong document.';
    console.error(err, this.collection, this.name, msg);
    throw new Error(err);
  }

  // msg.a = the action.
  switch (msg.a) {
    case 'fetch':
      // We're done fetching. This message has no other information.
      if (msg.data) this.ingestData(msg.data);
      if (this.wantSubscribe === 'fetch') this.wantSubscribe = false;
      this._clearAction();
      this._finishSub(msg.error);
      return;

    case 'sub':
      // Subscribe reply.
      this._handleSubscribe(msg.error, msg.data);
      return;

    case 'unsub':
      // Unsubscribe reply
      this.subscribed = false;
      this.emit('unsubscribe');

      this._clearAction();
      this._finishSub(msg.error);
      return;

    case 'op':
      if (msg.error) {
        // The server has rejected an op from the client for an unexpected reason.
        // We'll send the error message to the user and try to roll back the change.
        if (this.inflightData) {
          console.warn('Operation was rejected (' + msg.error + '). Trying to rollback change locally.');
          this._tryRollback(this.inflightData);
          this._clearInflightOp(msg.error);
        } else {
          // I managed to get into this state once. I'm not sure how it happened.
          // The op was maybe double-acknowledged?
          console.warn('Second acknowledgement message (error) received', msg, this);
        }
        return;
      }

      if (this.inflightData &&
          msg.src === this.inflightData.src &&
          msg.seq === this.inflightData.seq) {
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
        this._getLatestOps();
        return;
      }

      if (msg.v < this.version) {
        // This will happen naturally in the following (or similar) cases:
        //
        // Client is not subscribed to document.
        // -> client submits an operation (v=10)
        // -> client subscribes to a query which matches this document. Says we
        //    have v=10 of the doc.
        //
        // <- server acknowledges the operation (v=11). Server acknowledges the
        //    operation because the doc isn't subscribed
        // <- server processes the query, which says the client only has v=10.
        //    Server subscribes at v=10 not v=11, so we get another copy of the
        //    v=10 operation.
        //
        // In this case, we can safely ignore the old (duplicate) operation.
        return;
      }

      this._transformPendingOps(msg);
      this.version++;
      this._otApply(msg);
      return;

    default:
      console.warn('Unhandled document message:', msg);
  }
};

Doc.prototype._transformPendingOps = function(op) {
  if (this.inflightData) {
    xf(this.inflightData, op);
  }
  for (var i = 0; i < this.pendingData.length; i++) {
    xf(this.pendingData[i], op);
  }
};

Doc.prototype._getLatestOps = function() {
  var doc = this;
  var debounced = false;
  if (doc._getLatestTimeout) {
    debounced = true;
  } else {
    // Send a fetch command, which will get us the missing ops to catch back up
    // or the full doc if our version is currently null
    doc.connection.sendFetch(doc, doc.version);
  }
  // Debounce calls, since we are likely to get multiple future operations
  // in a rapid sequence
  clearTimeout(doc._getLatestTimeout);
  doc._getLatestTimeout = setTimeout(function() {
    doc._getLatestTimeout = null;
    // Send another fetch at the end of the final timeout interval if we were
    // debounced to make sure we didn't miss anything
    if (debounced) {
      doc.connection.sendFetch(doc, doc.version);
    }
  }, 5000);
  return;
};

// Called whenever (you guessed it!) the connection state changes. This will
// happen when we get disconnected & reconnect.
Doc.prototype._onConnectionStateChanged = function() {
  if (this.connection.canSend) {
    this.flush();
  } else {
    this.subscribed = false;
    this._clearAction();
  }
};

Doc.prototype._clearAction = function() {
  this.action = null;
  this.flush();
  this._emitNothingPending();
};

// Send the next pending op to the server, if we can.
//
// Only one operation can be in-flight at a time. If an operation is already on
// its way, or we're not currently connected, this method does nothing.
Doc.prototype.flush = function() {
  // Ignore if we can't send or we are already sending an op
  if (!this.connection.canSend || this.inflightData) return;

  // Pump and dump any no-ops from the front of the pending op list.
  var op;
  while (this.pendingData.length && isNoOp(op = this.pendingData[0])) {
    var callbacks = op.callbacks;
    for (var i = 0; i < callbacks.length; i++) {
      callbacks[i](op.error);
    }
    this.pendingData.shift();
  }

  // Send first pending op unless paused
  if (!this.paused && this.pendingData.length) {
    this._sendOp();
    return;
  }

  // Ignore if an action is already in process
  if (this.action) return;
  // Once all ops are sent, perform subscriptions and fetches
  var version = (this.state === 'ready') ? this.version : null;

  if (this.subscribed && !this.wantSubscribe) {
    this.action = 'unsubscribe';
    this.connection.sendUnsubscribe(this);

  } else if (!this.subscribed && this.wantSubscribe === 'fetch') {
    this.action = 'fetch';
    this.connection.sendFetch(this, version);

  } else if (!this.subscribed && this.wantSubscribe) {
    this.action = 'subscribe';
    this.connection.sendSubscribe(this, version);
  }
};


// ****** Subscribing, unsubscribing and fetching

// Value is true, false or 'fetch'.
Doc.prototype._setWantSubscribe = function(value, callback, err) {
  if (this.subscribed === this.wantSubscribe &&
      (this.subscribed === value || value === 'fetch' && this.subscribed)) {
    if (callback) callback(err);
    return;
  }

  // If we want to subscribe, don't weaken it to a fetch.
  if (value !== 'fetch' || this.wantSubscribe !== true) {
    this.wantSubscribe = value;
  }

  if (callback) this._subscribeCallbacks.push(callback);
  this.flush();
};

// Open the document. There is no callback and no error handling if you're
// already connected.
//
// Only call this once per document.
Doc.prototype.subscribe = function(callback) {
  this._setWantSubscribe(true, callback);
};

// Unsubscribe. The data will stay around in local memory, but we'll stop
// receiving updates.
Doc.prototype.unsubscribe = function(callback) {
  this._setWantSubscribe(false, callback);
};

// Call to request fresh data from the server.
Doc.prototype.fetch = function(callback) {
  this._setWantSubscribe('fetch', callback);
};

// Called when our subscribe, fetch or unsubscribe messages are acknowledged.
Doc.prototype._finishSub = function(err) {
  if (!this._subscribeCallbacks.length) return;
  for (var i = 0; i < this._subscribeCallbacks.length; i++) {
    this._subscribeCallbacks[i](err);
  }
  this._subscribeCallbacks.length = 0;
};


// Operations


// ************ Dealing with operations.

// Helper function to set op to contain a no-op.
var setNoOp = function(op) {
  delete op.op;
  delete op.create;
  delete op.del;
};

var isNoOp = function(op) {
  return !op.op && !op.create && !op.del;
}

// Try to compose data2 into data1. Returns truthy if it succeeds, otherwise falsy.
var tryCompose = function(type, data1, data2) {
  if (data1.create && data2.del) {
    setNoOp(data1);
  } else if (data1.create && data2.op) {
    // Compose the data into the create data.
    var data = (data1.create.data === undefined) ? type.create() : data1.create.data;
    data1.create.data = type.apply(data, data2.op);
  } else if (isNoOp(data1)) {
    data1.create = data2.create;
    data1.del = data2.del;
    data1.op = data2.op;
  } else if (data1.op && data2.op && type.compose) {
    data1.op = type.compose(data1.op, data2.op);
  } else {
    return false;
  }
  return true;
};

// Transform server op data by a client op, and vice versa. Ops are edited in place.
var xf = function(client, server) {
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

  var clientEdit = client.op;
  var serverEdit = server.op;
  // We only get here if either the server or client ops are no-op. Carry on,
  // nothing to see here.
  if (!serverEdit || !clientEdit) return;

  // They both edited the document. This is the normal case for this function -
  // as in, most of the time we'll end up down here.
  //
  // You should be wondering why I'm using client.type instead of this.type.
  // The reason is, if we get ops at an old version of the document, this.type
  // might be undefined or a totally different type. By pinning the type to the
  // op data, we make sure the right type has its transform function called.
  if (client.type.transformX) {
    var result = client.type.transformX(clientEdit, serverEdit);
    client.op = result[0];
    server.op = result[1];
  } else {
    client.op = client.type.transform(clientEdit, serverEdit, 'left');
    server.op = client.type.transform(serverEdit, clientEdit, 'right');
  }
};

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
Doc.prototype._otApply = function(op) {
  this.locked = true;

  if (op.create) {
    // If the type is currently set, it means we tried creating the document
    // and someone else won. client create x server create = server create.
    var create = op.create;
    this._setType(create.type);
    this.snapshot = this.type.create(create.data);

    // This is a bit heavyweight, but I want the created event to fire outside of the lock.
    this.once('unlock', function() {
      this.emit('create');
    });
  } else if (op.del) {
    // The type should always exist in this case. del x _ = del
    var oldSnapshot = this.snapshot;
    this._setType(null);
    this.once('unlock', function() {
      this.emit('del', oldSnapshot);
    });
  } else if (op.op) {
    if (!this.type) throw new Error('Document does not exist. ' + this.collection + ' ' + this.name);
    var type = this.type;

    this.emit('before op', op.op);

    // This exists so clients can pull any necessary data out of the snapshot
    // before it gets changed.  Previously we kept the old snapshot object and
    // passed it to the op event handler. However, apply no longer guarantees
    // the old object is still valid.
    //
    // Because this could be totally unnecessary work, its behind a flag. set
    // doc.incremental to enable.
    if (this.incremental && type.incrementalApply) {
      var doc = this;
      type.incrementalApply(this.snapshot, op.op, function(component, snapshot) {
        doc.snapshot = snapshot;
        doc.emit('op', component);
      });
    } else {
      // This is the default case, simply applying the operation to the local snapshot.
      this.snapshot = type.apply(this.snapshot, op.op);
      this.emit('op', op.op);
    }
  }
  // Its possible for none of the above cases to match, in which case the op is
  // a no-op. This will happen when a document has been deleted locally and
  // remote ops edit the document.

  this.locked = false;
  this.emit('unlock');

  if (op.op) {
    return this.emit('after op', op.op);
  }
};


// ***** Sending operations

Doc.prototype.retry = function() {
  if (!this.inflightData) return;
  var threshold = 5000 * Math.pow(2, this.inflightData.retries);
  if (this.inflightData.sentAt < Date.now() - threshold) {
    this.connection.emit('retry', this);
    this._sendOp();
  }
};

// Actually send op data to the server.
Doc.prototype._sendOp = function() {
  // Wait until we have a src id from the server
  var src = this.connection.id;
  if (!src) return;

  // When there is no inflightData, send the first item in pendingData. If
  // there is inflightData, try sending it again
  if (!this.inflightData) {
    // Send first pending op
    this.inflightData = this.pendingData.shift();
  }
  var data = this.inflightData;
  if (!data) {
    throw new Error('no data to send on call to _sendOp');
  }

  // Track data for retrying ops
  data.sentAt = Date.now();
  data.retries = (data.retries == null) ? 0 : data.retries + 1;

  // The src + seq number is a unique ID representing this operation. This tuple
  // is used on the server to detect when ops have been sent multiple times and
  // on the client to match acknowledgement of an op back to the inflightData.
  // Note that the src could be different from this.connection.id after a
  // reconnect, since an op may still be pending after the reconnection and
  // this.connection.id will change. In case an op is sent multiple times, we
  // also need to be careful not to override the original seq value.
  if (data.seq == null) data.seq = this.connection.seq++;

  this.connection.sendOp(this, data);

  // src isn't needed on the first try, since the server session will have the
  // same id, but it must be set on the inflightData in case it is sent again
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
Doc.prototype._submitOp = function(op, callback) {
  if (this.locked) {
    var err = 'Cannot call submitOp from inside an op event handler. ' + this.collection + ' ' + this.name;
    if (callback) return callback(err);
    throw new Error(err);
  }

  // The op contains either op, create, delete, or none of the above (a no-op).
  if (op.op) {
    if (!this.type) {
      var err = 'Document has not been created';
      if (callback) return callback(err);
      throw new Error(err);
    }
    // Try to normalize the op. This removes trailing skip:0's and things like that.
    if (this.type.normalize) op.op = this.type.normalize(op.op);
  }

  if (!this.state) {
    this.state = 'floating';
  }

  op.type = this.type;
  op.callbacks = [];

  // If the type supports composes, try to compose the operation onto the end
  // of the last pending operation.
  var operation;
  var previous = this.pendingData[this.pendingData.length - 1];

  if (previous && tryCompose(this.type, previous, op)) {
    operation = previous;
  } else {
    operation = op;
    this.pendingData.push(op);
  }
  if (callback) operation.callbacks.push(callback);

  this._otApply(op);

  // The call to flush is in a timeout so if submitOp() is called multiple
  // times in a closure all the ops are combined before being sent to the
  // server. It doesn't matter if flush is called a bunch of times.
  var doc = this;
  setTimeout(function() {
    doc.flush();
  }, 0);
};


// *** Client OT entrypoints.

// Submit an operation to the document.
//
// @param operation handled by the OT type
// @param [callback] called after operation submitted
//
// @fires before op, op, after op
Doc.prototype.submitOp = function(op, callback) {
  this._submitOp({op: op}, callback);
};

// Create the document, which in ShareJS semantics means to set its type. Every
// object implicitly exists in the database but has no data and no type. Create
// sets the type of the object and can optionally set some initial data on the
// object, depending on the type.
//
// @param type  OT type
// @param data  initial
// @param callback  called when operation submitted
Doc.prototype.create = function(type, data, callback) {
  if (this.type) {
    var err = 'Document already exists';
    if (callback) return callback(err);
    throw new Error(err);
  }

  var op = {create: {type:type, data:data}};
  this._submitOp(op, callback);
};

// Delete the document. This creates and submits a delete operation to the
// server. Deleting resets the object's type to null and deletes its data. The
// document still exists, and still has the version it used to have before you
// deleted it (well, old version +1).
//
// @param callback  called when operation submitted
Doc.prototype.del = function(callback) {
  if (!this.type) {
    var err = 'Document does not exist';
    if (callback) return callback(err);
    throw new Error(err);
  }

  this._submitOp({del: true}, callback);
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


// This will be called when the server rejects our operations for some reason.
// There's not much we can do here if the OT type is noninvertable, but that
// shouldn't happen too much in real life because readonly documents should be
// flagged as such. (I should probably figure out a flag for that).
//
// This does NOT get called if our op fails to reach the server for some reason
// - we optimistically assume it'll make it there eventually.
Doc.prototype._tryRollback = function(op) {
  // This is probably horribly broken.
  if (op.create) {
    this._setType(null);

    // I don't think its possible to get here if we aren't in a floating state.
    if (this.state === 'floating')
      this.state = null;
    else
      console.warn('Rollback a create from state ' + this.state);

  } else if (op.op && op.type.invert) {
    op.op = op.type.invert(op.op);

    // Transform the undo operation by any pending ops.
    for (var i = 0; i < this.pendingData.length; i++) {
      xf(this.pendingData[i], op);
    }

    // ... and apply it locally, reverting the changes.
    //
    // This operation is applied to look like it comes from a remote context.
    // I'm still not 100% sure about this functionality, because its really a
    // local op. Basically, the problem is that if the client's op is rejected
    // by the server, the editor window should update to reflect the undo.
    this._otApply(op);
  } else if (op.op || op.del) {
    // This is where an undo stack would come in handy.
    this._setType(null);
    this.version = null;
    this.state = null;
    this.subscribed = false;
    this.emit('error', 'Op apply failed and the operation could not be reverted');

    // Trigger a fetch. In our invalid state, we can't really do anything.
    this.fetch();
    this.flush();
  }
};

Doc.prototype._clearInflightOp = function(error) {
  var callbacks = this.inflightData.callbacks;
  for (var i = 0; i < callbacks.length; i++) {
    callbacks[i](error || this.inflightData.error);
  }

  this.inflightData = null;
  this.flush();
  this._emitNothingPending();
};

// This is called when the server acknowledges an operation from the client.
Doc.prototype._opAcknowledged = function(msg) {
  // Our inflight op has been acknowledged, so we can throw away the inflight data.
  // (We were only holding on to it incase we needed to resend the op.)
  if (!this.state) {
    throw new Error('opAcknowledged called from a null state. This should never happen. ' + this.collection + ' ' + this.name);
  } else if (this.state === 'floating') {
    if (!this.inflightData.create) throw new Error('Cannot acknowledge an op. ' + this.collection + ' ' + this.name);

    // Our create has been acknowledged. This is the same as ingesting some data.
    this.version = msg.v;
    this.state = 'ready';
    var doc = this;
    setTimeout(function() {
      doc.emit('ready');
    }, 0);
  } else {
    // We already have a snapshot. The snapshot should be at the acknowledged
    // version, because the server has sent us all the ops that have happened
    // before acknowledging our op.

    // This should never happen - something is out of order.
    if (msg.v !== this.version) {
      throw new Error('Invalid version from server. This can happen when you submit ops in a submitOp callback. Expected: ' + this.version + ' Message version: ' + msg.v + ' ' + this.collection + ' ' + this.name);
    }
  }

  // The op was committed successfully. Increment the version number
  this.version++;

  this._clearInflightOp();
};
