import SnapshotRequest = require('./snapshot-request');
import util = require('../../util');
import { ACTIONS } from '../../message-actions';

export = SnapshotVersionRequest;

class SnapshotVersionRequest extends SnapshotRequest {
  version;

  constructor(connection, requestId, collection, id, version, callback) {
    super(connection, requestId, collection, id, callback);

    if (!util.isValidVersion(version)) {
      throw new Error('Snapshot version must be a positive integer or null');
    }

    this.version = version;
  }

  _message() {
    return {
      a: ACTIONS.snapshotFetch,
      id: this.requestId,
      c: this.collection,
      d: this.id,
      v: this.version
    };
  }
}
