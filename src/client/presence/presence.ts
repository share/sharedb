import emitter = require('../../emitter');
import LocalPresence = require('./local-presence');
import RemotePresence = require('./remote-presence');
import util = require('../../util');
import async = require('async');
import hat = require('hat');
import { ACTIONS } from '../../message-actions';

export = Presence;

class Presence {
  connection;
  channel;
  wantSubscribe;
  subscribed;
  remotePresences;
  localPresences;
  _remotePresenceInstances;
  _subscriptionCallbacksBySeq;
  _wantsDestroy;

  constructor(connection, channel) {
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

  subscribe(callback) {
    this._sendSubscriptionAction(true, callback);
  }

  unsubscribe(callback) {
    this._sendSubscriptionAction(false, callback);
  }

  create(id) {
    if (this._wantsDestroy) {
      throw new Error('Presence is being destroyed');
    }
    id = id || hat();
    var localPresence = this._createLocalPresence(id);
    this.localPresences[id] = localPresence;
    return localPresence;
  }

  destroy(callback) {
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
  }

  _sendSubscriptionAction(wantSubscribe, callback) {
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
  }

  _requestRemotePresence() {
    this.connection._requestRemotePresence(this.channel);
  }

  _handleSubscribe(error, seq) {
    if (this.wantSubscribe) this.subscribed = true;
    var callback = this._subscriptionCallback(seq);
    this._callbackOrEmit(error, callback);
  }

  _handleUnsubscribe(error, seq) {
    this.subscribed = false;
    var callback = this._subscriptionCallback(seq);
    this._callbackOrEmit(error, callback);
  }

  _receiveUpdate(error, message) {
    var localPresence = util.dig(this.localPresences, message.id);
    if (localPresence) return localPresence._ack(error, message.pv);

    if (error) return this.emit('error', error);
    var presence = this;
    var remotePresence = util.digOrCreate(this._remotePresenceInstances, message.id, function() {
      return presence._createRemotePresence(message.id);
    });

    remotePresence.receiveUpdate(message);
  }

  _updateRemotePresence(remotePresence) {
    this.remotePresences[remotePresence.presenceId] = remotePresence.value;
    if (remotePresence.value === null) this._removeRemotePresence(remotePresence.presenceId);
    this.emit('receive', remotePresence.presenceId, remotePresence.value);
  }

  _broadcastAllLocalPresence(error) {
    if (error) return this.emit('error', error);
    for (var id in this.localPresences) {
      var localPresence = this.localPresences[id];
      if (localPresence.value !== null) localPresence.send();
    }
  }

  _removeRemotePresence(id) {
    this._remotePresenceInstances[id].destroy();
    delete this._remotePresenceInstances[id];
    delete this.remotePresences[id];
  }

  _onConnectionStateChanged() {
    if (!this.connection.canSend) {
      this.subscribed = false;
      return;
    }
    this._resubscribe();
    for (var id in this.localPresences) {
      this.localPresences[id]._sendPending();
    }
  }

  _resubscribe() {
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
  }

  _subscriptionCallback(seq) {
    var callback = this._subscriptionCallbacksBySeq[seq];
    delete this._subscriptionCallbacksBySeq[seq];
    return callback;
  }

  _callbackOrEmit(error, callback) {
    if (callback) return util.nextTick(callback, error);
    if (error) this.emit('error', error);
  }

  _createLocalPresence(id) {
    return new LocalPresence(this, id);
  }

  _createRemotePresence(id) {
    return new RemotePresence(this, id);
  }

  _callEachOrEmit(callbacks, error) {
    var called = util.callEach(callbacks, error);
    if (!called && error) this.emit('error', error);
  }

  _combineSubscribeCallbackWithLastAdded(callback) {
    var seqs = Object.keys(this._subscriptionCallbacksBySeq);
    var lastSeq = seqs[seqs.length - 1];
    var originalCallback = this._subscriptionCallbacksBySeq[lastSeq];
    if (!originalCallback) return this._subscriptionCallbacksBySeq[lastSeq] = callback;
    this._subscriptionCallbacksBySeq[lastSeq] = function(error) {
      originalCallback(error);
      callback(error);
    };
  }
}

emitter.mixin(Presence);
