var hat = require('hat');
var types = require('../types');
var Snapshot = require('../snapshot');

module.exports = SnapshotRequest;

function SnapshotRequest(connection, collection, id, callback) {
  this.requestId = hat();

  this.connection = connection;
  this.id = id;
  this.collection = collection;
  this.callback = callback;

  this.sent = false;
}

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
  if (!this.callback) {
    return;
  }

  if (error) {
    return this.callback(error);
  }

  var type = types.map[message.type] || null;

  var metadata = {
    ts: message.ts,
  };

  var snapshot = new Snapshot(this.collection, this.id, message.v, type, message.data, metadata);
  this.callback(null, snapshot);
};
