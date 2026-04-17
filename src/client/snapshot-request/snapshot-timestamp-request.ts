import SnapshotRequest = require('./snapshot-request');
import util = require('../../util');
import { ACTIONS } from '../../message-actions';

export = SnapshotTimestampRequest;

class SnapshotTimestampRequest extends SnapshotRequest {
  timestamp;

  constructor(connection, requestId, collection, id, timestamp, callback) {
    super(connection, requestId, collection, id, callback);

    if (!util.isValidTimestamp(timestamp)) {
      throw new Error('Snapshot timestamp must be a positive integer or null');
    }

    this.timestamp = timestamp;
  }

  _message() {
    return {
      a: ACTIONS.snapshotFetchByTimestamp,
      id: this.requestId,
      c: this.collection,
      d: this.id,
      ts: this.timestamp
    };
  }
}
