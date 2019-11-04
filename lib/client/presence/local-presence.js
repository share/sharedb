var emitter = require('../../emitter');

module.exports = LocalPresence;
function LocalPresence(presence, presenceId) {
  emitter.EventEmitter.call(this);

  if (!presenceId || typeof presenceId !== 'string') {
    throw new Error('LocalPresence presenceId must be a string');
  }

  this.presence = presence;
  this.presenceId = presenceId;
  this.connection = presence.connection;

  this.value = null;

  this._pendingMessages = [];
  this._callbacksBySeq = {};
}
emitter.mixin(LocalPresence);

LocalPresence.prototype.submit = function(value, callback) {
  this.value = value;
  this.send(callback);
};

LocalPresence.prototype.send = function(callback) {
  var message = this._message();
  this._pendingMessages.push(message);
  this._callbacksBySeq[message.seq] = callback;
  this._sendPending();
};

LocalPresence.prototype.destroy = function(callback) {
  this.submit(null, function(error) {
    if (error) return this._callbackOrEmit(error, callback);
    delete this.presence.localPresences[this.presenceId];
    if (callback) callback();
  }.bind(this));
};

LocalPresence.prototype._sendPending = function() {
  if (!this.connection.canSend) return;
  this._pendingMessages.forEach(function(message) {
    this.connection.send(message);
  }.bind(this));

  this._pendingMessages = [];
};

LocalPresence.prototype._ack = function(error, seq) {
  var callback = this._getCallback(seq);
  this._callbackOrEmit(error, callback);
};

LocalPresence.prototype._message = function() {
  return {
    a: 'p',
    ch: this.presence.channel,
    id: this.presenceId,
    p: this.value,
    seq: this.connection.seq++
  };
};

LocalPresence.prototype._getCallback = function(seq) {
  var callback = this._callbacksBySeq[seq];
  delete this._callbacksBySeq[seq];
  return callback;
};

LocalPresence.prototype._callbackOrEmit = function(error, callback) {
  if (callback) return process.nextTick(callback, error);
  if (error) this.emit('error', error);
};
