var emitter = require('../emitter');
var ShareDBError = require('../error');
var util = require('../util');

module.exports = MilestoneDB;
function MilestoneDB(options) {
  emitter.EventEmitter.call(this);

  // The interval at which milestone snapshots should be saved
  this.interval = options && options.interval;
}
emitter.mixin(MilestoneDB);

MilestoneDB.prototype.close = function(callback) {
  if (callback) process.nextTick(callback);
};

/**
 * Fetch a milestone snapshot from the database
 * @param {string} collection - name of the snapshot's collection
 * @param {string} id - ID of the snapshot to fetch
 * @param {number} version - the desired version of the milestone snapshot. The database will return
 *   the most recent milestone snapshot whose version is equal to or less than the provided value
 * @param {Function} callback - a callback to invoke once the snapshot has been fetched. Should have
 *   the signature (error, snapshot) => void;
 */
MilestoneDB.prototype.getMilestoneSnapshot = function (collection, id, version, callback) {
  var error = new ShareDBError(5019, 'getMilestoneSnapshot MilestoneDB method unimplemented');
  if (callback) return process.nextTick(callback, error);
  this.emit('error', error);
};

/**
 * @param {string} collection - name of the snapshot's collection
 * @param {Snapshot} snapshot - the milestone snapshot to save
 * @param {Function} callback (optional) - a callback to invoke after the snapshot has been saved.
 *   Should have the signature (error) => void;
 */
MilestoneDB.prototype.saveMilestoneSnapshot = function (collection, snapshot, callback) {
  var error = new ShareDBError(5020, 'saveMilestoneSnapshot MilestoneDB method unimplemented');
  if (callback) return process.nextTick(callback, error);
  this.emit('error', error);
};

MilestoneDB.prototype._isValidVersion = function (version) {
  return util.isValidVersion(version);
};
