var emitter = require('../../emitter');
var util = require('../../util');

module.exports = LocalPresence;
function LocalPresence(presence, presenceId) {
  emitter.EventEmitter.call(this);

  if (!presenceId || typeof presenceId !== 'string') {
    throw new Error('LocalPresence presenceId must be a string');
  }

  this.presence = presence;
  this.presenceId = presenceId;
  this.connection = presence.connection;
  this.presenceVersion = 0;

  this.value = null;

  this._pendingMessages = [];
  this._callbacksByPresenceVersion = {};
}
emitter.mixin(LocalPresence);

LocalPresence.prototype.submit = function(value, callback) {
  this.value = value;
  this.send(callback);
};

LocalPresence.prototype.send = function(callback) {
  var message = this._message();
  this._pendingMessages.push(message);
  this._callbacksByPresenceVersion[message.pv] = callback;
  this._sendPending();
};

LocalPresence.prototype.destroy = function(callback) {
  var presence = this;
  this.submit(null, function(error) {
    if (error) return presence._callbackOrEmit(error, callback);
    delete presence.presence.localPresences[presence.presenceId];
    if (callback) callback();
  });
};

LocalPresence.prototype._sendPending = function() {
  if (!this.connection.canSend) return;
  var presence = this;
  this._pendingMessages.forEach(function(message) {
    presence.connection.send(message);
  });

  this._pendingMessages = [];
};

LocalPresence.prototype._ack = function(error, presenceVersion) {
  var callback = this._getCallback(presenceVersion);
  this._callbackOrEmit(error, callback);
};

LocalPresence.prototype._message = function() {
  return {
    a: 'p',
    ch: this.presence.channel,
    id: this.presenceId,
    p: this.value,
    pv: this.presenceVersion++
  };
};

LocalPresence.prototype._getCallback = function(presenceVersion) {
  var callback = this._callbacksByPresenceVersion[presenceVersion];
  delete this._callbacksByPresenceVersion[presenceVersion];
  return callback;
};

LocalPresence.prototype._callbackOrEmit = function(error, callback) {
  if (callback) return util.nextTick(callback, error);
  if (error) this.emit('error', error);
};
