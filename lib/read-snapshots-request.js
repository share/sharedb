var ShareDBError = require('./error');

module.exports = ReadSnapshotsRequest;

/**
 * Context object passed to "readSnapshots" middleware functions
 *
 * @param {string} collection
 * @param {Snapshot[]} snapshots - snapshots being read
 * @param {keyof Backend.prototype.SNAPSHOT_TYPES} snapshotType - the type of snapshot read being
 *   performed
 */
function ReadSnapshotsRequest(collection, snapshots, snapshotType) {
  this.collection = collection;
  this.snapshots = snapshots;
  this.snapshotType = snapshotType;

  // Added by Backend#trigger
  this.action = null;
  this.agent = null;
  this.backend = null;

  /**
   * Map of doc id to error: `{[docId: string]: string | Error}`
   */
  this._idToError = null;
}

/**
 * Rejects the read of a specific snapshot. A rejected snapshot read will not have that snapshot's
 * data sent down to the client.
 *
 * If the error has a `code` property of `"ERR_SNAPSHOT_READ_SILENT_REJECTION"`, then the Share
 * client will not pass the error to user code, but will still do things like cancel subscriptions.
 * The `#rejectSnapshotReadSilent(snapshot, errorMessage)` method can also be used for convenience.
 *
 * @param {Snapshot} snapshot
 * @param {string | Error} error
 *
 * @see #rejectSnapshotReadSilent
 * @see ShareDBError.CODES.ERR_SNAPSHOT_READ_SILENT_REJECTION
 * @see ShareDBError.CODES.ERR_SNAPSHOT_READS_REJECTED
 */
ReadSnapshotsRequest.prototype.rejectSnapshotRead = function(snapshot, error) {
  if (!this._idToError) {
    this._idToError = Object.create(null);
  }
  this._idToError[snapshot.id] = error;
};

/**
 * Rejects the read of a specific snapshot. A rejected snapshot read will not have that snapshot's
 * data sent down to the client.
 *
 * This method will set a special error code that causes the Share client to not pass the error to
 * user code, though it will still do things like cancel subscriptions.
 *
 * @param {Snapshot} snapshot
 * @param {string} errorMessage
 */
ReadSnapshotsRequest.prototype.rejectSnapshotReadSilent = function(snapshot, errorMessage) {
  this.rejectSnapshotRead(snapshot, this.silentRejectionError(errorMessage));
};

ReadSnapshotsRequest.prototype.silentRejectionError = function(errorMessage) {
  return new ShareDBError(ShareDBError.CODES.ERR_SNAPSHOT_READ_SILENT_REJECTION, errorMessage);
};

/**
 * Returns whether this trigger of "readSnapshots" has had a snapshot read rejected.
 */
ReadSnapshotsRequest.prototype.hasSnapshotRejection = function() {
  return this._idToError != null;
};

/**
 * Returns an overall error from "readSnapshots" based on the snapshot-specific errors.
 *
 * - If there's exactly one snapshot and it has an error, then that error is returned.
 * - If there's more than one snapshot and at least one has an error, then an overall
 *   "ERR_SNAPSHOT_READS_REJECTED" is returned, with an `idToError` property.
 */
ReadSnapshotsRequest.prototype.getReadSnapshotsError = function() {
  var snapshots = this.snapshots;
  var idToError = this._idToError;
  // If there are 0 snapshots, there can't be any snapshot-specific errors.
  if (snapshots.length === 0) {
    return;
  }

  // Single snapshot with error is treated as a full error.
  if (snapshots.length === 1) {
    var snapshotError = idToError[snapshots[0].id];
    if (snapshotError) {
      return snapshotError;
    } else {
      return;
    }
  }

  // Errors in specific snapshots result in an overall ERR_SNAPSHOT_READS_REJECTED.
  //
  // fetchBulk and subscribeBulk know how to handle that special error by sending a doc-by-doc
  // success/failure to the client. Other methods that don't or can't handle partial failures
  // will treat it as a full rejection.
  var err = new ShareDBError(ShareDBError.CODES.ERR_SNAPSHOT_READS_REJECTED);
  err.idToError = idToError;
  return err;
};
