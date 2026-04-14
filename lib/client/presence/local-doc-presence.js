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
var LocalPresence = require('./local-presence');
var ShareDBError = require('../../error');
var util = require('../../util');
var ERROR_CODE = ShareDBError.CODES;
var LocalDocPresence = /** @class */ (function (_super) {
  __extends(LocalDocPresence, _super);
  function LocalDocPresence(presence, presenceId) {
    var _this = _super.call(this, presence, presenceId) || this;
    _this.collection = _this.presence.collection;
    _this.id = _this.presence.id;
    _this._doc = _this.connection.get(_this.collection, _this.id);
    _this._emitter = _this.connection._docPresenceEmitter;
    _this._isSending = false;
    _this._docDataVersionByPresenceVersion = Object.create(null);
    _this._opHandler = _this._transformAgainstOp.bind(_this);
    _this._createOrDelHandler = _this._handleCreateOrDel.bind(_this);
    _this._loadHandler = _this._handleLoad.bind(_this);
    _this._destroyHandler = _this.destroy.bind(_this);
    _this._registerWithDoc();
    return _this;
  }
  LocalDocPresence.prototype.submit = function (value, callback) {
    if (!this._doc.type) {
      // If the Doc hasn't been created, we already assume all presence to
      // be null. Let's early return, instead of error since this is a harmless
      // no-op
      if (value === null) return this._callbackOrEmit(null, callback);
      var error = null;
      if (this._doc._isInHardRollback) {
        error = {
          code: ERROR_CODE.ERR_DOC_IN_HARD_ROLLBACK,
          message: 'Cannot submit presence. Document is processing hard rollback',
        };
      } else {
        error = {
          code: ERROR_CODE.ERR_DOC_DOES_NOT_EXIST,
          message: 'Cannot submit presence. Document has not been created',
        };
      }
      return this._callbackOrEmit(error, callback);
    }
    // Record the current data state version to check if we need to transform
    // the presence later
    this._docDataVersionByPresenceVersion[this.presenceVersion] = this._doc._dataStateVersion;
    LocalPresence.prototype.submit.call(this, value, callback);
  };
  LocalDocPresence.prototype.destroy = function (callback) {
    this._emitter.removeEventListener(this._doc, 'op', this._opHandler);
    this._emitter.removeEventListener(this._doc, 'create', this._createOrDelHandler);
    this._emitter.removeEventListener(this._doc, 'del', this._createOrDelHandler);
    this._emitter.removeEventListener(this._doc, 'load', this._loadHandler);
    this._emitter.removeEventListener(this._doc, 'destroy', this._destroyHandler);
    LocalPresence.prototype.destroy.call(this, callback);
  };
  LocalDocPresence.prototype._sendPending = function () {
    if (this._isSending) return;
    this._isSending = true;
    var presence = this;
    this._doc.whenNothingPending(function () {
      presence._isSending = false;
      if (!presence.connection.canSend) return;
      presence._pendingMessages.forEach(function (message) {
        message.t = presence._doc.type.uri;
        message.v = presence._doc.version;
        presence.connection.send(message);
      });
      presence._pendingMessages = [];
      presence._docDataVersionByPresenceVersion = Object.create(null);
    });
  };
  LocalDocPresence.prototype._registerWithDoc = function () {
    this._emitter.addEventListener(this._doc, 'op', this._opHandler);
    this._emitter.addEventListener(this._doc, 'create', this._createOrDelHandler);
    this._emitter.addEventListener(this._doc, 'del', this._createOrDelHandler);
    this._emitter.addEventListener(this._doc, 'load', this._loadHandler);
    this._emitter.addEventListener(this._doc, 'destroy', this._destroyHandler);
  };
  LocalDocPresence.prototype._transformAgainstOp = function (op, source) {
    var presence = this;
    var docDataVersion = this._doc._dataStateVersion;
    this._pendingMessages.forEach(function (message) {
      // Check if the presence needs transforming against the op - this is to check against
      // edge cases where presence is submitted from an 'op' event
      var messageDocDataVersion = presence._docDataVersionByPresenceVersion[message.pv];
      if (messageDocDataVersion >= docDataVersion) return;
      try {
        message.p = presence._transformPresence(message.p, op, source);
        // Ensure the presence's data version is kept consistent to deal with "deep" op
        // submissions
        presence._docDataVersionByPresenceVersion[message.pv] = docDataVersion;
      } catch (error) {
        var callback = presence._getCallback(message.pv);
        presence._callbackOrEmit(error, callback);
      }
    });
    try {
      this.value = this._transformPresence(this.value, op, source);
    } catch (error) {
      this.emit('error', error);
    }
  };
  LocalDocPresence.prototype._handleCreateOrDel = function () {
    this._pendingMessages.forEach(function (message) {
      message.p = null;
    });
    this.value = null;
  };
  LocalDocPresence.prototype._handleLoad = function () {
    this.value = null;
    this._pendingMessages = [];
    this._docDataVersionByPresenceVersion = Object.create(null);
  };
  LocalDocPresence.prototype._message = function () {
    var message = LocalPresence.prototype._message.call(this);
    ((message.c = this.collection), (message.d = this.id), (message.v = null));
    message.t = null;
    return message;
  };
  LocalDocPresence.prototype._transformPresence = function (value, op, source) {
    var type = this._doc.type;
    if (!util.supportsPresence(type)) {
      throw new ShareDBError(
        ERROR_CODE.ERR_TYPE_DOES_NOT_SUPPORT_PRESENCE,
        'Type does not support presence: ' + type.name,
      );
    }
    return type.transformPresence(value, op, source);
  };
  return LocalDocPresence;
})(LocalPresence);
module.exports = LocalDocPresence;
