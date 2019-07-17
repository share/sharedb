var MilestoneDB = require('./index');

/**
 * A no-op implementation of the MilestoneDB class.
 *
 * This class exists as a simple, silent default drop-in for ShareDB, which allows the backend to call its methods with
 * no effect.
 */
module.exports = NoOpMilestoneDB;
function NoOpMilestoneDB(options) {
  MilestoneDB.call(this, options);
}

NoOpMilestoneDB.prototype = Object.create(MilestoneDB.prototype);

NoOpMilestoneDB.prototype.getMilestoneSnapshot = function(collection, id, version, callback) {
  var snapshot = undefined;
  process.nextTick(callback, null, snapshot);
};

NoOpMilestoneDB.prototype.saveMilestoneSnapshot = function(collection, snapshot, callback) {
  if (callback) return process.nextTick(callback, null);
  this.emit('save', collection, snapshot);
};

NoOpMilestoneDB.prototype.getMilestoneSnapshotAtOrBeforeTime = function(collection, id, timestamp, callback) {
  var snapshot = undefined;
  process.nextTick(callback, null, snapshot);
};

NoOpMilestoneDB.prototype.getMilestoneSnapshotAtOrAfterTime = function(collection, id, timestamp, callback) {
  var snapshot = undefined;
  process.nextTick(callback, null, snapshot);
};
