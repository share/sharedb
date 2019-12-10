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

  this._idToError = null;
}

/**
 * Rejects the read of a specific snapshot. A rejected snapshot read will not have that snapshot's
 * data sent down to the client.
 *
 * If the error has a `code` property of `"ERR_SNAPSHOT_READ_SILENT_REJECTION"`, then the Share
 * client will not pass the error to user code, but will still do things like cancel subscriptions.
 *
 * @param {Snapshot} snapshot
 * @param {string | Error} error
 *
 * @see ShareDBError.CODES.ERR_SNAPSHOT_READ_SILENT_REJECTION
 * @see ShareDBError.CODES.ERR_SNAPSHOT_READS_REJECTED
 */
ReadSnapshotsRequest.prototype.rejectSnapshotRead = function(snapshot, error) {
  if (!this._idToError) {
    this._idToError = {};
  }
  this._idToError[snapshot.id] = error;
};

/**
 * Returns whether this trigger of "readSnapshots" has had a snapshot read rejected.
 */
ReadSnapshotsRequest.prototype.hasSnapshotRejection = function() {
  return this._idToError != null;
};
