module.exports = RemotePresence;
function RemotePresence(presence, presenceId) {
  this.presence = presence;
  this.presenceId = presenceId;
  this.connection = this.presence.connection;

  this.value = null;
  this.seq = 0;
}

RemotePresence.prototype.receiveUpdate = function(message) {
  if (message.seq < this.seq) return;
  this.value = message.p;
  this.seq = message.seq;
  this.presence._updateRemotePresence(this);
};

RemotePresence.prototype.destroy = function(callback) {
  delete this.presence._remotePresenceInstances[this.presenceId];
  delete this.presence.remotePresences[this.presenceId];
  if (callback) process.nextTick(callback);
};
