var hat = require('hat');

module.exports = SnapshotRequest;

function SnapshotRequest(connection, collection, id, version, callback) {
  this.requestId = hat();

  this.connection = connection;
  this.id = id;
  this.collection = collection;
  this.callback = callback;

  this.parseVersion(version);

  this.ready = false;
  this.sent = false;
}

SnapshotRequest.prototype.parseVersion = function (version) {
  if (typeof version === 'number') {
    this.version = version;
  } else if (version instanceof Date) {
    this.timestamp = version.getTime();
  } else if (version == null) {
    this.version = null;
  } else {
    this.callback && this.callback({ code: 4024, message: 'Invalid version' });
  }
}

SnapshotRequest.prototype.hasPending = function () {
  return !this.ready;
};

SnapshotRequest.prototype.send = function () {
  if (!this.connection.canSend) {
    return;
  }

  var message = {
    a: 'sf',
    id: this.requestId,
    c: this.collection,
    d: this.id,
    v: this.version,
    ts: this.timestamp
  };

  this.connection.send(message);
  this.sent = true;
};

SnapshotRequest.prototype._onConnectionStateChanged = function () {
  if (this.connection.canSend && !this.sent) {
    this.send();
  } else if (!this.connection.canSend) {
    this.sent = false;
  }
};

SnapshotRequest.prototype._handleResponse = function (error, message) {
  this.ready = true;

  if (!this.callback) {
    return;
  }

  if (error) {
    return this.callback(error);
  }

  this.callback(null, {
    id: this.id,
    collection: this.collection,
    version: message.version,
    data: message.data,
    timestamp: message.timestamp,
    type: message.type
  });
};
