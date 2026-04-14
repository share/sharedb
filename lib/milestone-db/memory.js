'use strict';
var __extends =
  (this && this.__extends) ||
  (function () {
    var extendStatics = function (d, b) {
      extendStatics =
        Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array &&
          function (d, b) {
            d.__proto__ = b;
          }) ||
        function (d, b) {
          for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
        };
      return extendStatics(d, b);
    };
    return function (d, b) {
      if (typeof b !== 'function' && b !== null)
        throw new TypeError('Class extends value ' + String(b) + ' is not a constructor or null');
      extendStatics(d, b);
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  })();
var MilestoneDB = require('./index');
var ShareDBError = require('../error');
var util = require('../util');
var ERROR_CODE = ShareDBError.CODES;
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
var MemoryMilestoneDB = /** @class */ (function (_super) {
  __extends(MemoryMilestoneDB, _super);
  function MemoryMilestoneDB(options) {
    var _this = _super.call(this, options) || this;
    _this._milestoneSnapshots = Object.create(null);
    return _this;
  }
  MemoryMilestoneDB.prototype.getMilestoneSnapshot = function (collection, id, version, callback) {
    if (!this._isValidVersion(version)) {
      return util.nextTick(
        callback,
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Invalid version'),
      );
    }
    var predicate = versionLessThanOrEqualTo(version);
    this._findMilestoneSnapshot(collection, id, predicate, callback);
  };
  MemoryMilestoneDB.prototype.saveMilestoneSnapshot = function (collection, snapshot, callback) {
    callback =
      callback ||
      function (error) {
        if (error) return this.emit('error', error);
        this.emit('save', collection, snapshot);
      }.bind(this);
    if (!collection)
      return callback(
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Missing collection'),
      );
    if (!snapshot)
      return callback(
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Missing snapshot'),
      );
    var milestoneSnapshots = this._getMilestoneSnapshotsSync(collection, snapshot.id);
    milestoneSnapshots.push(snapshot);
    milestoneSnapshots.sort(function (a, b) {
      return a.v - b.v;
    });
    util.nextTick(callback, null);
  };
  MemoryMilestoneDB.prototype.getMilestoneSnapshotAtOrBeforeTime = function (
    collection,
    id,
    timestamp,
    callback,
  ) {
    if (!this._isValidTimestamp(timestamp)) {
      return util.nextTick(
        callback,
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Invalid timestamp'),
      );
    }
    var filter = timestampLessThanOrEqualTo(timestamp);
    this._findMilestoneSnapshot(collection, id, filter, callback);
  };
  MemoryMilestoneDB.prototype.getMilestoneSnapshotAtOrAfterTime = function (
    collection,
    id,
    timestamp,
    callback,
  ) {
    if (!this._isValidTimestamp(timestamp)) {
      return util.nextTick(
        callback,
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Invalid timestamp'),
      );
    }
    var filter = timestampGreaterThanOrEqualTo(timestamp);
    this._findMilestoneSnapshot(collection, id, filter, function (error, snapshot) {
      if (error) return util.nextTick(callback, error);
      var mtime = snapshot && snapshot.m && snapshot.m.mtime;
      if (timestamp !== null && mtime < timestamp) {
        snapshot = undefined;
      }
      util.nextTick(callback, null, snapshot);
    });
  };
  MemoryMilestoneDB.prototype._findMilestoneSnapshot = function (
    collection,
    id,
    breakCondition,
    callback,
  ) {
    if (!collection) {
      return util.nextTick(
        callback,
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Missing collection'),
      );
    }
    if (!id)
      return util.nextTick(
        callback,
        new ShareDBError(ERROR_CODE.ERR_MILESTONE_ARGUMENT_INVALID, 'Missing ID'),
      );
    var milestoneSnapshots = this._getMilestoneSnapshotsSync(collection, id);
    var milestoneSnapshot;
    for (var i = 0; i < milestoneSnapshots.length; i++) {
      var nextMilestoneSnapshot = milestoneSnapshots[i];
      if (breakCondition(milestoneSnapshot, nextMilestoneSnapshot)) {
        break;
      } else {
        milestoneSnapshot = nextMilestoneSnapshot;
      }
    }
    util.nextTick(callback, null, milestoneSnapshot);
  };
  MemoryMilestoneDB.prototype._getMilestoneSnapshotsSync = function (collection, id) {
    var collectionSnapshots =
      this._milestoneSnapshots[collection] ||
      (this._milestoneSnapshots[collection] = Object.create(null));
    return collectionSnapshots[id] || (collectionSnapshots[id] = []);
  };
  return MemoryMilestoneDB;
})(MilestoneDB);
function versionLessThanOrEqualTo(version) {
  return function (currentSnapshot, nextSnapshot) {
    if (version === null) {
      return false;
    }
    return nextSnapshot.v > version;
  };
}
function timestampGreaterThanOrEqualTo(timestamp) {
  return function (currentSnapshot) {
    if (timestamp === null) {
      return false;
    }
    var mtime = currentSnapshot && currentSnapshot.m && currentSnapshot.m.mtime;
    return mtime >= timestamp;
  };
}
function timestampLessThanOrEqualTo(timestamp) {
  return function (currentSnapshot, nextSnapshot) {
    if (timestamp === null) {
      return !!currentSnapshot;
    }
    var mtime = nextSnapshot && nextSnapshot.m && nextSnapshot.m.mtime;
    return mtime > timestamp;
  };
}
module.exports = MemoryMilestoneDB;
