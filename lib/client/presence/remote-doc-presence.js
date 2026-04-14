'use strict';
var __extends =
  (this && this.__extends) ||
  (function () {
    var extendStatics = function (d, b) {
      extendStatics =
        Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array &&
          function (d, b) {
            d.__proto__ = b;
          }) ||
        function (d, b) {
          for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
        };
      return extendStatics(d, b);
    };
    return function (d, b) {
      if (typeof b !== 'function' && b !== null)
        throw new TypeError('Class extends value ' + String(b) + ' is not a constructor or null');
      extendStatics(d, b);
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  })();
var RemotePresence = require('./remote-presence');
var ot = require('../../ot');
var RemoteDocPresence = /** @class */ (function (_super) {
  __extends(RemoteDocPresence, _super);
  function RemoteDocPresence(presence, presenceId) {
    var _this = _super.call(this, presence, presenceId) || this;
    _this.collection = _this.presence.collection;
    _this.id = _this.presence.id;
    _this.src = null;
    _this.presenceVersion = null;
    _this._doc = _this.connection.get(_this.collection, _this.id);
    _this._emitter = _this.connection._docPresenceEmitter;
    _this._pending = null;
    _this._opCache = null;
    _this._pendingSetPending = false;
    _this._opHandler = _this._handleOp.bind(_this);
    _this._createDelHandler = _this._handleCreateDel.bind(_this);
    _this._loadHandler = _this._handleLoad.bind(_this);
    _this._registerWithDoc();
    return _this;
  }
  RemoteDocPresence.prototype.receiveUpdate = function (message) {
    if (this._pending && message.pv < this._pending.pv) return;
    this.src = message.src;
    this._pending = message;
    this._setPendingPresence();
  };
  RemoteDocPresence.prototype.destroy = function (callback) {
    this._emitter.removeEventListener(this._doc, 'op', this._opHandler);
    this._emitter.removeEventListener(this._doc, 'create', this._createDelHandler);
    this._emitter.removeEventListener(this._doc, 'del', this._createDelHandler);
    this._emitter.removeEventListener(this._doc, 'load', this._loadHandler);
    RemotePresence.prototype.destroy.call(this, callback);
  };
  RemoteDocPresence.prototype._registerWithDoc = function () {
    this._emitter.addEventListener(this._doc, 'op', this._opHandler);
    this._emitter.addEventListener(this._doc, 'create', this._createDelHandler);
    this._emitter.addEventListener(this._doc, 'del', this._createDelHandler);
    this._emitter.addEventListener(this._doc, 'load', this._loadHandler);
  };
  RemoteDocPresence.prototype._setPendingPresence = function () {
    if (this._pendingSetPending) return;
    this._pendingSetPending = true;
    var presence = this;
    this._doc.whenNothingPending(function () {
      presence._pendingSetPending = false;
      if (!presence._pending) return;
      if (presence._pending.pv < presence.presenceVersion) return (presence._pending = null);
      if (presence._pending.v > presence._doc.version) {
        return presence._doc.fetch();
      }
      if (!presence._catchUpStalePresence()) return;
      presence.value = presence._pending.p;
      presence.presenceVersion = presence._pending.pv;
      presence._pending = null;
      presence.presence._updateRemotePresence(presence);
    });
  };
  RemoteDocPresence.prototype._handleOp = function (op, source, connectionId) {
    var isOwnOp = connectionId === this.src;
    this._transformAgainstOp(op, isOwnOp);
    this._cacheOp(op, isOwnOp);
    this._setPendingPresence();
  };
  RemoteDocPresence.prototype._transformAgainstOp = function (op, isOwnOp) {
    if (!this.value) return;
    try {
      this.value = this._doc.type.transformPresence(this.value, op, isOwnOp);
    } catch (error) {
      return this.presence.emit('error', error);
    }
    this.presence._updateRemotePresence(this);
  };
  RemoteDocPresence.prototype._catchUpStalePresence = function () {
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
  };
  RemoteDocPresence.prototype._startCachingOps = function () {
    this._opCache = [];
  };
  RemoteDocPresence.prototype._stopCachingOps = function () {
    this._opCache = null;
  };
  RemoteDocPresence.prototype._cacheOp = function (op, isOwnOp) {
    if (this._opCache) {
      op = op ? { op: op } : null;
      // Subtract 1 from the current doc version, because an op with v3
      // should be read as the op that takes a doc from v3 -> v4
      this._opCache[this._doc.version - 1] = { op: op, isOwnOp: isOwnOp };
    }
  };
  return RemoteDocPresence;
})(RemotePresence);
RemotePresence.prototype._handleCreateDel = function () {
  this._cacheOp(null);
  this._setPendingPresence();
};
RemotePresence.prototype._handleLoad = function () {
  this.value = null;
  this._pending = null;
  this._opCache = null;
  this.presence._updateRemotePresence(this);
};
module.exports = RemoteDocPresence;
