var MilestoneDB = require('./index');
var ShareDBError = require('../error');

/**
 * In-memory ShareDB milestone database
 *
 * Milestone snapshots exist to speed up Backend.fetchSnapshot by providing milestones
 * on top of which fewer ops can be applied to reach a desired version of the document.
 * This very concept relies on persistence, which means that an in-memory database like
 * this is in no way appropriate for production use.
 *
 * The main purpose of this class is to provide a simple example of implementation,
 * and for use in tests.
 */
module.exports = MemoryMilestoneDB;
function MemoryMilestoneDB(options) {
  MilestoneDB.call(this, options);

  // Map from collection name -> doc id -> array of milestone snapshots
  this._milestoneSnapshots = {};
}

MemoryMilestoneDB.prototype = Object.create(MilestoneDB.prototype);

MemoryMilestoneDB.prototype.getMilestoneSnapshot = function (collection, id, version, callback) {
  if (!callback) callback = function () {};
  if (!collection) return process.nextTick(callback, new ShareDBError(4001, 'Missing collection'));
  if (!id) return process.nextTick(callback, new ShareDBError(4001, 'Missing ID'));
  if (!this._isValidVersion(version)) return process.nextTick(callback, new ShareDBError(4001, 'Invalid version'));

  var milestoneSnapshots = this._getMilestoneSnapshotsSync(collection, id);

  var milestoneSnapshot;
  for (var i = 0; i < milestoneSnapshots.length; i++) {
    var nextMilestoneSnapshot = milestoneSnapshots[i];
    if (nextMilestoneSnapshot.v <= version || version === null) {
      milestoneSnapshot = nextMilestoneSnapshot;
    } else {
      break;
    }
  }

  process.nextTick(callback, null, milestoneSnapshot);
};

MemoryMilestoneDB.prototype.saveMilestoneSnapshot = function (collection, snapshot, callback) {
  callback = callback || function (error) {
    if (error) return this.emit('error', error);
    this.emit('save', collection, snapshot);
  }.bind(this);

  if (!collection) return callback(new ShareDBError(4001, 'Missing collection'));
  if (!snapshot) return callback(new ShareDBError(4001, 'Missing snapshot'));

  var milestoneSnapshots = this._getMilestoneSnapshotsSync(collection, snapshot.id);
  milestoneSnapshots.push(snapshot);
  milestoneSnapshots.sort(function (a, b) {
    return a.v - b.v;
  });

  process.nextTick(callback, null);
};

MemoryMilestoneDB.prototype._getMilestoneSnapshotsSync = function (collection, id) {
  var collectionSnapshots = this._milestoneSnapshots[collection] || (this._milestoneSnapshots[collection] = {});
  return collectionSnapshots[id] || (collectionSnapshots[id] = []);
};
