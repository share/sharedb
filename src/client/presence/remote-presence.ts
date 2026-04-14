import util = require('../../util');

export = RemotePresence;

class RemotePresence {
  presence;
  presenceId;
  connection;
  value;
  presenceVersion;

  constructor(presence, presenceId) {
    this.presence = presence;
    this.presenceId = presenceId;
    this.connection = this.presence.connection;

    this.value = null;
    this.presenceVersion = 0;
  }

  receiveUpdate(message) {
    if (message.pv < this.presenceVersion) return;
    this.value = message.p;
    this.presenceVersion = message.pv;
    this.presence._updateRemotePresence(this);
  }

  destroy(callback) {
    delete this.presence._remotePresenceInstances[this.presenceId];
    delete this.presence.remotePresences[this.presenceId];
    if (callback) util.nextTick(callback);
  }
}
