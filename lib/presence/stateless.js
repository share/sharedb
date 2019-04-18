/*
 * Stateless Presence
 * ------------------
 *
 * This module provides an implementation of presence that works,
 * but has some scalability problems. Each time a client joins a document,
 * this implementation requests current presence information from all other clients,
 * via the server. The server does not store any state at all regarding presence,
 * it exists only in clients, hence the name "Stateless Presence".
 *
 */
var ShareDBError = require('../error');

// TODO inherit from Presence, add test for that.
function StatelessPresence(doc) {

  // The Doc instance that this Presence is attached to.
  this.doc = doc;

  // The current presence data.
  // Map of src -> presence data
  // Local src === ''
  this.current = {};

  // The presence objects received from the server.
  // Map of src -> presence
  this.received = {};

  // The minimum amount of time to wait before removing processed presence from this.presence.received.
  // The processed presence is removed to avoid leaking memory, in case peers keep connecting and disconnecting a lot.
  // The processed presence is not removed immediately to enable avoiding race conditions, where messages with lower
  // sequence number arrive after messages with higher sequence numbers.
  this.receivedTimeout = 60000;

  // If set to true, then the next time the local presence is sent,
  // all other clients will be asked to reply with their own presence data.
  this.requestReply = true;

  // A list of ops sent by the server. These are needed for transforming presence data,
  // if we get that presence data for an older version of the document.
  this.cachedOps = [];

  // The ops are cached for at least 1 minute by default, which should be lots, considering that the presence
  // data is supposed to be synced in real-time.
  this.cachedOpsTimeout = 60000;

  // The sequence number of the inflight presence request.
  this.inflightSeq = 0;

  // Callbacks (or null) for pending and inflight presence requests.
  this.pending = null;
  this.inflight = null;
}


// Submit presence data to a document.
// This is the only public facing method. 
// All the others are marked as internal with a leading "_".
StatelessPresence.prototype.submitPresence = function (data, callback) {
  if (data != null) {
    if (!this.doc.type) {
      var doc = this.doc;
      return process.nextTick(function() {
        var err = new ShareDBError(4015, 'Cannot submit presence. Document has not been created. ' + doc.collection + '.' + doc.id);
        if (callback) return callback(err);
        doc.emit('error', err);
      });
    }

    if (!this.doc.type.createPresence || !this.doc.type.transformPresence) {
      var doc = this.doc;
      return process.nextTick(function() {
        var err = new ShareDBError(4027, 'Cannot submit presence. Document\'s type does not support presence. ' + doc.collection + '.' + doc.id);
        if (callback) return callback(err);
        doc.emit('error', err);
      });
    }

    data = this.doc.type.createPresence(data);
  }

  if (this._setPresence('', data, true) || this.pending || this.inflight) {
    if (!this.pending) {
      this.pending = [];
    }
    if (callback) {
      this.pending.push(callback);
    }

  } else if (callback) {
    process.nextTick(callback);
  }

  process.nextTick(this.doc.flush.bind(this.doc));
};

StatelessPresence.prototype.handlePresence = function (err, presence) {
  if (!this.doc.subscribed) return;

  var src = presence.src;
  if (!src) {
    // Handle the ACK for the presence data we submitted.
    // this.inflightSeq would not equal presence.seq after a hard rollback,
    // when all callbacks are flushed with an error.
    if (this.inflightSeq === presence.seq) {
      var callbacks = this.inflight;
      this.inflight = null;
      this.inflightSeq = 0;
      var called = callbacks && this.doc._callEach(callbacks, err);
      if (err && !called) this.doc.emit('error', err);
      this.doc.flush();
      this.doc._emitNothingPending();
    }
    return;
  }

  // This shouldn't happen but check just in case.
  if (err) return this.doc.emit('error', err);

  if (presence.r && !this.pending) {
    // Another client requested us to share our current presence data
    this.pending = [];
    this.doc.flush();
  }

  // Ignore older messages which arrived out of order
  if (
    this.received[src] && (
      this.received[src].seq > presence.seq ||
      (this.received[src].seq === presence.seq && presence.v != null)
    )
  ) return;

  this.received[src] = presence;

  if (presence.v == null) {
    // null version should happen only when the server automatically sends
    // null presence for an unsubscribed client
    presence.processedAt = Date.now();
    return this._setPresence(src, null, true);
  }

  // Get missing ops first, if necessary
  if (this.doc.version == null || this.doc.version < presence.v) return this.doc.fetch();

  this._processReceivedPresence(src, true);
};
   
// If emit is true and presence has changed, emits a presence event.
// Returns true, if presence has changed for src. Otherwise false.
StatelessPresence.prototype._processReceivedPresence = function (src, emit) {
  if (!src) return false;
  var presence = this.received[src];
  if (!presence) return false;

  if (presence.processedAt != null) {
    if (Date.now() >= presence.processedAt + this.receivedTimeout) {
      // Remove old received and processed presence.
      delete this.received[src];
    }
    return false;
  }

  if (this.doc.version == null || this.doc.version < presence.v) {
    // keep waiting for the missing snapshot or ops.
    return false;
  }

  if (presence.p == null) {
    // Remove presence data as requested.
    presence.processedAt = Date.now();
    return this._setPresence(src, null, emit);
  }

  if (!this.doc.type || !this.doc.type.createPresence || !this.doc.type.transformPresence) {
    // Remove presence data because the document is not created or its type does not support presence
    presence.processedAt = Date.now();
    return this._setPresence(src, null, emit);
  }

  if (this.doc.inflightOp && this.doc.inflightOp.op == null) {
    // Remove presence data because presence.received can be transformed only against "op", not "create" nor "del"
    presence.processedAt = Date.now();
    return this._setPresence(src, null, emit);
  }

  for (var i = 0; i < this.doc.pendingOps.length; i++) {
    if (this.doc.pendingOps[i].op == null) {
      // Remove presence data because presence.received can be transformed only against "op", not "create" nor "del"
      presence.processedAt = Date.now();
      return this._setPresence(src, null, emit);
    }
  }

  var startIndex = this.cachedOps.length - (this.doc.version - presence.v);
  if (startIndex < 0) {
    // Remove presence data because we can't transform presence.received
    presence.processedAt = Date.now();
    return this._setPresence(src, null, emit);
  }

  for (var i = startIndex; i < this.cachedOps.length; i++) {
    if (this.cachedOps[i].op == null) {
      // Remove presence data because presence.received can be transformed only against "op", not "create" nor "del"
      presence.processedAt = Date.now();
      return this._setPresence(src, null, emit);
    }
  }

  // Make sure the format of the data is correct
  var data = this.doc.type.createPresence(presence.p);

  // Transform against past ops
  for (var i = startIndex; i < this.cachedOps.length; i++) {
    var op = this.cachedOps[i];
    data = this.doc.type.transformPresence(data, op.op, presence.src === op.src);
  }

  // Transform against pending ops
  if (this.doc.inflightOp) {
    data = this.doc.type.transformPresence(data, this.doc.inflightOp.op, false);
  }

  for (var i = 0; i < this.doc.pendingOps.length; i++) {
    data = this.doc.type.transformPresence(data, this.doc.pendingOps[i].op, false);
  }

  // Set presence data
  presence.processedAt = Date.now();
  return this._setPresence(src, data, emit);
};

StatelessPresence.prototype.processAllReceivedPresence = function () {
  var srcList = Object.keys(this.received);
  var changedSrcList = [];
  for (var i = 0; i < srcList.length; i++) {
    var src = srcList[i];
    if (this._processReceivedPresence(src)) {
      changedSrcList.push(src);
    }
  }
  this._emitPresence(changedSrcList, true);
};

StatelessPresence.prototype._transformPresence = function (src, op) {
  var presenceData = this.current[src];
  if (op.op != null) {
    var isOwnOperation = src === (op.src || '');
    presenceData = this.doc.type.transformPresence(presenceData, op.op, isOwnOperation);
  } else {
    presenceData = null;
  }
  return this._setPresence(src, presenceData);
};
 
StatelessPresence.prototype.transformAllPresence = function (op) {
  var srcList = Object.keys(this.current);
  var changedSrcList = [];
  for (var i = 0; i < srcList.length; i++) {
    var src = srcList[i];
    if (this._transformPresence(src, op)) {
      changedSrcList.push(src);
    }
  }
  this._emitPresence(changedSrcList, false);
};

StatelessPresence.prototype.pausePresence = function () {
  if (!this) return;

  if (this.inflight) {
    this.pending = this.pending
      ? this.inflight.concat(this.pending)
      : this.inflight;
    this.inflight = null;
    this.inflightSeq = 0;
  } else if (!this.pending && this.current[''] != null) {
    this.pending = [];
  }
  this.received = {};
  this.requestReply = true;
  var srcList = Object.keys(this.current);
  var changedSrcList = [];
  for (var i = 0; i < srcList.length; i++) {
    var src = srcList[i];
    if (src && this._setPresence(src, null)) {
      changedSrcList.push(src);
    }
  }
  this._emitPresence(changedSrcList, false);
};

// If emit is true and presence has changed, emits a presence event.
// Returns true, if presence has changed. Otherwise false.
StatelessPresence.prototype._setPresence = function (src, data, emit) {
  if (data == null) {
    if (this.current[src] == null) return false;
    delete this.current[src];
  } else {
    var isPresenceEqual =
      this.current[src] === data ||
      (this.doc.type.comparePresence && this.doc.type.comparePresence(this.current[src], data));
    if (isPresenceEqual) return false;
    this.current[src] = data;
  }
  if (emit) this._emitPresence([ src ], true);
  return true;
};

StatelessPresence.prototype._emitPresence = function (srcList, submitted) {
  if (srcList && srcList.length > 0) {
    var doc = this.doc;
    process.nextTick(function() {
      doc.emit('presence', srcList, submitted);
    });
  }
};

StatelessPresence.prototype.cacheOp = function (message) {
  var op = {
    src: message.src,
    time: Date.now(),
    create: !!message.create,
    op: message.op,
    del: !!message.del
  }
  // Remove the old ops.
  var oldOpTime = Date.now() - this.cachedOpsTimeout;
  var i;
  for (i = 0; i < this.cachedOps.length; i++) {
    if (this.cachedOps[i].time >= oldOpTime) {
      break;
    }
  }
  if (i > 0) {
    this.cachedOps.splice(0, i);
  }

  // Cache the new op.
  this.cachedOps.push(op);
};

// If there are no pending ops, this method sends the pending presence data, if possible.
StatelessPresence.prototype.flushPresence = function () {
  if (this.doc.subscribed && !this.inflight && this.pending && !this.doc.hasWritePending()) {
    this.inflight = this.pending;
    this.inflightSeq = this.doc.connection.seq;
    this.pending = null;
    this.doc.connection.sendPresence(this.doc, this.current[''], this.requestReply);
    this.requestReply = false;
  }
};

StatelessPresence.prototype.destroyPresence = function () {
  this.received = {};
  this.clearCachedOps();
};

StatelessPresence.prototype.clearCachedOps = function () {
  this.cachedOps.length = 0;
};

// Reset presence-related properties.
StatelessPresence.prototype.hardRollbackPresence = function () {
  var pendingPresence = [];
  if (this.inflight) pendingPresence.push(this.inflight);
  if (this.pending) pendingPresence.push(this.pending);

  this.inflight = null;
  this.inflightSeq = 0;
  this.pending = null;
  this.cachedOps.length = 0;
  this.received = {};
  this.requestReply = true;

  var srcList = Object.keys(this.current);
  var changedSrcList = [];
  for (var i = 0; i < srcList.length; i++) {
    var src = srcList[i];
    if (this._setPresence(src, null)) {
      changedSrcList.push(src);
    }
  }
  this._emitPresence(changedSrcList, false);
  return pendingPresence;
};

StatelessPresence.prototype.hasPendingPresence = function () {
  return this.inflight || this.pending;
};

module.exports = StatelessPresence;
