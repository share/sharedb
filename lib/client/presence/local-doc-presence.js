var LocalPresence = require('./local-presence');
var ShareDBError = require('../../error');
var ERROR_CODE = ShareDBError.CODES;

module.exports = LocalDocPresence;
function LocalDocPresence(presence, presenceId) {
  LocalPresence.call(this, presence, presenceId);

  this.collection = this.presence.collection;
  this.id = this.presence.id;

  this._doc = this.connection.get(this.collection, this.id);
  this._seq = null;
  this._isSending = false;

  this._opHandler = this._transformAgainstOp.bind(this);
  this._createOrDelHandler = this._handleCreateOrDel.bind(this);
  this._loadHandler = this._handleLoad.bind(this);
  this._destroyHandler = this.destroy.bind(this);
  this._registerWithDoc();
}

LocalDocPresence.prototype = Object.create(LocalPresence.prototype);

LocalDocPresence.prototype.submit = function(value, callback) {
  if (!this._doc.type) {
    var error = {
      code: ERROR_CODE.ERR_DOC_DOES_NOT_EXIST,
      message: 'Cannot submit presence. Document has not been created'
    };
    return this._callbackOrEmit(error, callback);
  };

  LocalPresence.prototype.submit.call(this, value, callback);
};

LocalDocPresence.prototype.destroy = function(callback) {
  this._doc.removeListener('op', this._opHandler);
  this._doc.removeListener('create', this._createOrDelHandler);
  this._doc.removeListener('del', this._createOrDelHandler);
  this._doc.removeListener('load', this._loadHandler);
  this._doc.removeListener('destroy', this._destroyHandler);

  LocalPresence.prototype.destroy.call(this, callback);
};

LocalDocPresence.prototype._sendPending = function() {
  if (this._isSending) return;
  this._isSending = true;
  this._doc.whenNothingPending(function() {
    this._isSending = false;
    if (!this.connection.canSend) return;

    this._pendingMessages.forEach(function(message) {
      message.t = this._doc.type.uri;
      message.v = this._doc.version;
      this.connection.send(message);
    }.bind(this));

    this._pendingMessages = [];
  }.bind(this));
};

LocalPresence.prototype._registerWithDoc = function() {
  this._doc.on('op', this._opHandler);
  this._doc.on('create', this._createOrDelHandler);
  this._doc.on('del', this._createOrDelHandler);
  this._doc.on('load', this._loadHandler);
  this._doc.on('destroy', this._destroyHandler);
};

LocalDocPresence.prototype._transformAgainstOp = function(op, source) {
  this._pendingMessages.forEach(function(message) {
    try {
      message.p = this._doc.type.transformPresence(message.p, op, source);
    } catch (error) {
      var callback = this._getCallback(message.seq);
      this._callbackOrEmit(error, callback);
    }
  }.bind(this));

  try {
    this.value = this._doc.type.transformPresence(this.value, op, source);
  } catch (error) {
    this.emit('error', error);
  }
};

LocalPresence.prototype._handleCreateOrDel = function() {
  this._pendingMessages.forEach(function(message) {
    message.p = null;
  });

  this.value = null;
};

LocalPresence.prototype._handleLoad = function() {
  this.value = null;
  this._pendingMessages = [];
};

LocalDocPresence.prototype._message = function() {
  var message = LocalPresence.prototype._message.call(this);
  message.c = this.collection,
  message.d = this.id,
  message.v = null;
  message.t = null;
  return message;
};
