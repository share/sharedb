var SnapshotRequest = require('./snapshot-request');
var util = require('../../util');
var ACTIONS = require('../../message-actions').ACTIONS;

module.exports = SnapshotVersionRequest;

function SnapshotVersionRequest(connection, requestId, collection, id, version, callback) {
  SnapshotRequest.call(this, connection, requestId, collection, id, callback);

  if (!util.isValidVersion(version)) {
    throw new Error('Snapshot version must be a positive integer or null');
  }

  this.version = version;
}

SnapshotVersionRequest.prototype = Object.create(SnapshotRequest.prototype);

SnapshotVersionRequest.prototype._message = function() {
  return {
    a: ACTIONS.snapshotFetch,
    id: this.requestId,
    c: this.collection,
    d: this.id,
    v: this.version
  };
};
