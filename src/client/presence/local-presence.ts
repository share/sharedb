import emitter = require('../../emitter');
import { ACTIONS } from '../../message-actions';
import util = require('../../util');

export = LocalPresence;

class LocalPresence {
  presence;
  presenceId;
  connection;
  presenceVersion;
  value;
  _pendingMessages;
  _callbacksByPresenceVersion;

  constructor(presence, presenceId) {
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
    this._callbacksByPresenceVersion = Object.create(null);
  }

  submit(value, callback) {
    this.value = value;
    this.send(callback);
  }

  send(callback) {
    var message = this._message();
    this._pendingMessages.push(message);
    this._callbacksByPresenceVersion[message.pv] = callback;
    this._sendPending();
  }

  destroy(callback) {
    var presence = this;
    this.submit(null, function(error) {
      if (error) return presence._callbackOrEmit(error, callback);
      delete presence.presence.localPresences[presence.presenceId];
      if (callback) callback();
    });
  }

  _sendPending() {
    if (!this.connection.canSend) return;
    var presence = this;
    this._pendingMessages.forEach(function(message) {
      presence.connection.send(message);
    });

    this._pendingMessages = [];
  }

  _ack(error, presenceVersion) {
    var callback = this._getCallback(presenceVersion);
    this._callbackOrEmit(error, callback);
  }

  _message() {
    return {
      a: ACTIONS.presence,
      ch: this.presence.channel,
      id: this.presenceId,
      p: this.value,
      pv: this.presenceVersion++
    };
  }

  _getCallback(presenceVersion) {
    var callback = this._callbacksByPresenceVersion[presenceVersion];
    delete this._callbacksByPresenceVersion[presenceVersion];
    return callback;
  }

  _callbackOrEmit(error, callback) {
    if (callback) return util.nextTick(callback, error);
    if (error) this.emit('error', error);
  }
}

emitter.mixin(LocalPresence);
