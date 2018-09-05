var Snapshot = require('../snapshot');
var util = require('../util');
var emitter = require('../emitter');

module.exports = SnapshotRequest;

function SnapshotRequest(connection, requestId, collection, id, version, callback) {
  emitter.EventEmitter.call(this);

  if (typeof callback !== 'function') {
    throw new Error('Callback is required for SnapshotRequest');
  }

  if (!util.isValidVersion(version)) {
    throw new Error('Snapshot version must be a positive integer or null');
  }

  this.requestId = requestId;
  this.connection = connection;
  this.id = id;
  this.collection = collection;
  this.version = version;
  this.callback = callback;

  this.sent = false;
}
emitter.mixin(SnapshotRequest);

SnapshotRequest.prototype.send = function () {
  if (!this.connection.canSend) {
    return;
  }

  var message = {
    a: 'nf',
    id: this.requestId,
    c: this.collection,
    d: this.id,
    v: this.version,
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
  this.emit('ready');

  if (error) {
    return this.callback(error);
  }

  var snapshot = new Snapshot(this.id, message.v, message.type, message.data, null);
  this.callback(null, snapshot);
};
