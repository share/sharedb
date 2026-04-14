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
var util = require('../util');
/**
 * A no-op implementation of the MilestoneDB class.
 *
 * This class exists as a simple, silent default drop-in for ShareDB, which allows the backend to call its methods with
 * no effect.
 */
var NoOpMilestoneDB = /** @class */ (function (_super) {
  __extends(NoOpMilestoneDB, _super);
  function NoOpMilestoneDB(options) {
    return _super.call(this, options) || this;
  }
  NoOpMilestoneDB.prototype.getMilestoneSnapshot = function (collection, id, version, callback) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  };
  NoOpMilestoneDB.prototype.saveMilestoneSnapshot = function (collection, snapshot, callback) {
    if (callback) return util.nextTick(callback, null);
    this.emit('save', collection, snapshot);
  };
  NoOpMilestoneDB.prototype.getMilestoneSnapshotAtOrBeforeTime = function (
    collection,
    id,
    timestamp,
    callback,
  ) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  };
  NoOpMilestoneDB.prototype.getMilestoneSnapshotAtOrAfterTime = function (
    collection,
    id,
    timestamp,
    callback,
  ) {
    var snapshot = undefined;
    util.nextTick(callback, null, snapshot);
  };
  return NoOpMilestoneDB;
})(MilestoneDB);
module.exports = NoOpMilestoneDB;
