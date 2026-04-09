import MilestoneDB = require('./index');
import util = require('../util');

export = NoOpMilestoneDB;

/**
 * A no-op implementation of the MilestoneDB class.
 *
 * This class exists as a simple, silent default drop-in for ShareDB, which allows the backend to call its methods with
 * no effect.
 */
class NoOpMilestoneDB extends MilestoneDB {
  constructor(options) {
    super(options);
  }

  getMilestoneSnapshot(collection, id, version, callback) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  }

  saveMilestoneSnapshot(collection, snapshot, callback) {
    if (callback) return util.nextTick(callback, null);
    this.emit('save', collection, snapshot);
  }

  getMilestoneSnapshotAtOrBeforeTime(collection, id, timestamp, callback) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  }

  getMilestoneSnapshotAtOrAfterTime(collection, id, timestamp, callback) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  }
}
