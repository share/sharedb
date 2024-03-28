var emitter = require('../../emitter');
var LocalPresence = require('./local-presence');
var RemotePresence = require('./remote-presence');
var util = require('../../util');
var async = require('async');
var hat = require('hat');
var ACTIONS = require('../../message-actions').ACTIONS;

module.exports = Presence;
function Presence(connection, channel) {
  emitter.EventEmitter.call(this);

  if (!channel || typeof channel !== 'string') {
    throw new Error('Presence channel must be provided');
  }

  this.connection = connection;
  this.channel = channel;

  this.wantSubscribe = false;
  this.subscribed = false;
  this.remotePresences = Object.create(null);
  this.localPresences = Object.create(null);

  this._remotePresenceInstances = Object.create(null);
  this._subscriptionCallbacksBySeq = Object.create(null);
  this._wantsDestroy = false;
}
emitter.mixin(Presence);

Presence.prototype.subscribe = function(callback) {
  this._sendSubscriptionAction(true, callback);
};

Presence.prototype.unsubscribe = function(callback) {
  this._sendSubscriptionAction(false, callback);
};

Presence.prototype.create = function(id) {
  if (this._wantsDestroy) {
    throw new Error('Presence is being destroyed');
  }
  id = id || hat();
  var localPresence = this._createLocalPresence(id);
  this.localPresences[id] = localPresence;
  return localPresence;
};

Presence.prototype.destroy = function(callback) {
  this._wantsDestroy = true;
  var presence = this;
  // Store these at the time of destruction: any LocalPresence on this
  // instance at this time will be destroyed, but if the destroy is
  // cancelled, any future LocalPresence objects will be kept.
  // See: https://github.com/share/sharedb/pull/579
  var localIds = Object.keys(presence.localPresences);
  this.unsubscribe(function(error) {
    if (error) return presence._callbackOrEmit(error, callback);
    var remoteIds = Object.keys(presence._remotePresenceInstances);
    async.parallel(
      [
        function(next) {
          async.each(localIds, function(presenceId, next) {
            var localPresence = presence.localPresences[presenceId];
            if (!localPresence) return next();
            localPresence.destroy(next);
          }, next);
        },
        function(next) {
          // We don't bother stashing the RemotePresence instances because
          // they're not really bound to our local state: if we want to
          // destroy, we destroy them all, but if we cancel the destroy,
          // we'll want to keep them all
          if (!presence._wantsDestroy) return next();
          async.each(remoteIds, function(presenceId, next) {
            presence._remotePresenceInstances[presenceId].destroy(next);
          }, next);
        }
      ],
      function(error) {
        if (presence._wantsDestroy) delete presence.connection._presences[presence.channel];
        presence._callbackOrEmit(error, callback);
      }
    );
  });
};

Presence.prototype._sendSubscriptionAction = function(wantSubscribe, callback) {
  wantSubscribe = !!wantSubscribe;
  if (wantSubscribe === this.wantSubscribe) {
    if (!callback) return;
    if (wantSubscribe === this.subscribed) return util.nextTick(callback);
    if (Object.keys(this._subscriptionCallbacksBySeq).length) {
      return this._combineSubscribeCallbackWithLastAdded(callback);
    }
  }
  this.wantSubscribe = wantSubscribe;
  var action = this.wantSubscribe ? ACTIONS.presenceSubscribe : ACTIONS.presenceUnsubscribe;
  var seq = this.connection._presenceSeq++;
  this._subscriptionCallbacksBySeq[seq] = callback;
  if (this.connection.canSend) {
    this.connection._sendPresenceAction(action, seq, this);
  }
};

Presence.prototype._requestRemotePresence = function() {
  this.connection._requestRemotePresence(this.channel);
};

Presence.prototype._handleSubscribe = function(error, seq) {
  if (this.wantSubscribe) this.subscribed = true;
  var callback = this._subscriptionCallback(seq);
  this._callbackOrEmit(error, callback);
};

Presence.prototype._handleUnsubscribe = function(error, seq) {
  this.subscribed = false;
  var callback = this._subscriptionCallback(seq);
  this._callbackOrEmit(error, callback);
};

Presence.prototype._receiveUpdate = function(error, message) {
  var localPresence = util.dig(this.localPresences, message.id);
  if (localPresence) return localPresence._ack(error, message.pv);

  if (error) return this.emit('error', error);
  var presence = this;
  var remotePresence = util.digOrCreate(this._remotePresenceInstances, message.id, function() {
    return presence._createRemotePresence(message.id);
  });

  remotePresence.receiveUpdate(message);
};

Presence.prototype._updateRemotePresence = function(remotePresence) {
  this.remotePresences[remotePresence.presenceId] = remotePresence.value;
  if (remotePresence.value === null) this._removeRemotePresence(remotePresence.presenceId);
  this.emit('receive', remotePresence.presenceId, remotePresence.value);
};

Presence.prototype._broadcastAllLocalPresence = function(error) {
  if (error) return this.emit('error', error);
  for (var id in this.localPresences) {
    var localPresence = this.localPresences[id];
    if (localPresence.value !== null) localPresence.send();
  }
};

Presence.prototype._removeRemotePresence = function(id) {
  this._remotePresenceInstances[id].destroy();
  delete this._remotePresenceInstances[id];
  delete this.remotePresences[id];
};

Presence.prototype._onConnectionStateChanged = function() {
  if (!this.connection.canSend) {
    this.subscribed = false;
    return;
  }
  this._resubscribe();
  for (var id in this.localPresences) {
    this.localPresences[id]._sendPending();
  }
};

Presence.prototype._resubscribe = function() {
  var callbacks = [];
  for (var seq in this._subscriptionCallbacksBySeq) {
    var callback = this._subscriptionCallback(seq);
    callbacks.push(callback);
  }

  if (!this.wantSubscribe) return this._callEachOrEmit(callbacks);

  var presence = this;
  this.subscribe(function(error) {
    presence._callEachOrEmit(callbacks, error);
  });
};

Presence.prototype._subscriptionCallback = function(seq) {
  var callback = this._subscriptionCallbacksBySeq[seq];
  delete this._subscriptionCallbacksBySeq[seq];
  return callback;
};

Presence.prototype._callbackOrEmit = function(error, callback) {
  if (callback) return util.nextTick(callback, error);
  if (error) this.emit('error', error);
};

Presence.prototype._createLocalPresence = function(id) {
  return new LocalPresence(this, id);
};

Presence.prototype._createRemotePresence = function(id) {
  return new RemotePresence(this, id);
};

Presence.prototype._callEachOrEmit = function(callbacks, error) {
  var called = util.callEach(callbacks, error);
  if (!called && error) this.emit('error', error);
};

Presence.prototype._combineSubscribeCallbackWithLastAdded = function(callback) {
  var seqs = Object.keys(this._subscriptionCallbacksBySeq);
  var lastSeq = seqs[seqs.length - 1];
  var originalCallback = this._subscriptionCallbacksBySeq[lastSeq];
  if (!originalCallback) return this._subscriptionCallbacksBySeq[lastSeq] = callback;
  this._subscriptionCallbacksBySeq[lastSeq] = function(error) {
    originalCallback(error);
    callback(error);
  };
};
