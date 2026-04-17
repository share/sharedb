import emitter = require('../emitter');
import ShareDBError = require('../error');
import util = require('../util');

var ERROR_CODE = ShareDBError.CODES;

export = MilestoneDB;

class MilestoneDB {
  /** The interval at which milestone snapshots should be saved */
  interval;

  constructor(options) {
    emitter.EventEmitter.call(this);

    this.interval = options && options.interval;
  }

  close(callback) {
    if (callback) util.nextTick(callback);
  }

  /**
   * Fetch a milestone snapshot from the database
   * @param {string} collection - name of the snapshot's collection
   * @param {string} id - ID of the snapshot to fetch
   * @param {number} version - the desired version of the milestone snapshot. The database will return
   *   the most recent milestone snapshot whose version is equal to or less than the provided value
   * @param {Function} callback - a callback to invoke once the snapshot has been fetched. Should have
   *   the signature (error, snapshot) => void;
   */
  getMilestoneSnapshot(collection, id, version, callback) {
    var error = new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      'getMilestoneSnapshot MilestoneDB method unimplemented'
    );
    this._callBackOrEmitError(error, callback);
  }

  /**
   * @param {string} collection - name of the snapshot's collection
   * @param {Snapshot} snapshot - the milestone snapshot to save
   * @param {Function} callback (optional) - a callback to invoke after the snapshot has been saved.
   *   Should have the signature (error) => void;
   */
  saveMilestoneSnapshot(collection, snapshot, callback) {
    var error = new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      'saveMilestoneSnapshot MilestoneDB method unimplemented'
    );
    this._callBackOrEmitError(error, callback);
  }

  getMilestoneSnapshotAtOrBeforeTime(collection, id, timestamp, callback) {
    var error = new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      'getMilestoneSnapshotAtOrBeforeTime MilestoneDB method unimplemented'
    );
    this._callBackOrEmitError(error, callback);
  }

  getMilestoneSnapshotAtOrAfterTime(collection, id, timestamp, callback) {
    var error = new ShareDBError(
      ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED,
      'getMilestoneSnapshotAtOrAfterTime MilestoneDB method unimplemented'
    );
    this._callBackOrEmitError(error, callback);
  }

  _isValidVersion(version) {
    return util.isValidVersion(version);
  }

  _isValidTimestamp(timestamp) {
    return util.isValidTimestamp(timestamp);
  }

  _callBackOrEmitError(error, callback) {
    if (callback) return util.nextTick(callback, error);
    this.emit('error', error);
  }
}

emitter.mixin(MilestoneDB);
