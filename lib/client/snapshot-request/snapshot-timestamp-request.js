var SnapshotRequest = require('./snapshot-request');
var util = require('../../util');
var ACTIONS = require('../../message-actions').ACTIONS;

module.exports = SnapshotTimestampRequest;

function SnapshotTimestampRequest(connection, requestId, collection, id, timestamp, callback) {
  SnapshotRequest.call(this, connection, requestId, collection, id, callback);

  if (!util.isValidTimestamp(timestamp)) {
    throw new Error('Snapshot timestamp must be a positive integer or null');
  }

  this.timestamp = timestamp;
}

SnapshotTimestampRequest.prototype = Object.create(SnapshotRequest.prototype);

SnapshotTimestampRequest.prototype._message = function() {
  return {
    a: ACTIONS.snapshotFetchByTimestamp,
    id: this.requestId,
    c: this.collection,
    d: this.id,
    ts: this.timestamp
  };
};
