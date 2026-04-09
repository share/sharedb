import RemotePresence = require('./remote-presence');
import ot = require('../../ot');

export = RemoteDocPresence;

class RemoteDocPresence extends RemotePresence {
  collection;
  id;
  src;
  presenceVersion;
  _doc;
  _emitter;
  _pending;
  _opCache;
  _pendingSetPending;
  _opHandler;
  _createDelHandler;
  _loadHandler;

  constructor(presence, presenceId) {
    super(presence, presenceId);

    this.collection = this.presence.collection;
    this.id = this.presence.id;
    this.src = null;
    this.presenceVersion = null;

    this._doc = this.connection.get(this.collection, this.id);
    this._emitter = this.connection._docPresenceEmitter;
    this._pending = null;
    this._opCache = null;
    this._pendingSetPending = false;

    this._opHandler = this._handleOp.bind(this);
    this._createDelHandler = this._handleCreateDel.bind(this);
    this._loadHandler = this._handleLoad.bind(this);
    this._registerWithDoc();
  }

  receiveUpdate(message) {
    if (this._pending && message.pv < this._pending.pv) return;
    this.src = message.src;
    this._pending = message;
    this._setPendingPresence();
  }

  destroy(callback) {
    this._emitter.removeEventListener(this._doc, 'op', this._opHandler);
    this._emitter.removeEventListener(this._doc, 'create', this._createDelHandler);
    this._emitter.removeEventListener(this._doc, 'del', this._createDelHandler);
    this._emitter.removeEventListener(this._doc, 'load', this._loadHandler);

    RemotePresence.prototype.destroy.call(this, callback);
  }

  _registerWithDoc() {
    this._emitter.addEventListener(this._doc, 'op', this._opHandler);
    this._emitter.addEventListener(this._doc, 'create', this._createDelHandler);
    this._emitter.addEventListener(this._doc, 'del', this._createDelHandler);
    this._emitter.addEventListener(this._doc, 'load', this._loadHandler);
  }

  _setPendingPresence() {
    if (this._pendingSetPending) return;
    this._pendingSetPending = true;
    var presence = this;
    this._doc.whenNothingPending(function() {
      presence._pendingSetPending = false;
      if (!presence._pending) return;
      if (presence._pending.pv < presence.presenceVersion) return presence._pending = null;

      if (presence._pending.v > presence._doc.version) {
        return presence._doc.fetch();
      }

      if (!presence._catchUpStalePresence()) return;

      presence.value = presence._pending.p;
      presence.presenceVersion = presence._pending.pv;
      presence._pending = null;
      presence.presence._updateRemotePresence(presence);
    });
  }

  _handleOp(op, source, connectionId) {
    var isOwnOp = connectionId === this.src;
    this._transformAgainstOp(op, isOwnOp);
    this._cacheOp(op, isOwnOp);
    this._setPendingPresence();
  }

  _transformAgainstOp(op, isOwnOp) {
    if (!this.value) return;

    try {
      this.value = this._doc.type.transformPresence(this.value, op, isOwnOp);
    } catch (error) {
      return this.presence.emit('error', error);
    }
    this.presence._updateRemotePresence(this);
  }

  _catchUpStalePresence() {
    if (this._pending.v >= this._doc.version) return true;

    if (!this._opCache) {
      this._startCachingOps();
      this._doc.fetch();
      this.presence._requestRemotePresence();
      return false;
    }

    while (this._opCache[this._pending.v]) {
      var item = this._opCache[this._pending.v];
      var op = item.op;
      var isOwnOp = item.isOwnOp;
      // We use a null op to signify a create or a delete operation. In both
      // cases we just want to reset the presence (which doesn't make sense
      // in a new document), so just set the presence to null.
      if (op === null) {
        this._pending.p = null;
        this._pending.v++;
      } else {
        ot.transformPresence(this._pending, op, isOwnOp);
      }
    }

    var hasCaughtUp = this._pending.v >= this._doc.version;
    if (hasCaughtUp) {
      this._stopCachingOps();
    }

    return hasCaughtUp;
  }

  _startCachingOps() {
    this._opCache = [];
  }

  _stopCachingOps() {
    this._opCache = null;
  }

  _cacheOp(op, isOwnOp) {
    if (this._opCache) {
      op = op ? {op: op} : null;
      // Subtract 1 from the current doc version, because an op with v3
      // should be read as the op that takes a doc from v3 -> v4
      this._opCache[this._doc.version - 1] = {op: op, isOwnOp: isOwnOp};
    }
  }
}

RemotePresence.prototype._handleCreateDel = function() {
  this._cacheOp(null);
  this._setPendingPresence();
};

RemotePresence.prototype._handleLoad = function() {
  this.value = null;
  this._pending = null;
  this._opCache = null;
  this.presence._updateRemotePresence(this);
};
