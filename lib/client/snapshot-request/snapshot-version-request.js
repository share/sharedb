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
var SnapshotRequest = require('./snapshot-request');
var util = require('../../util');
var message_actions_1 = require('../../message-actions');
var SnapshotVersionRequest = /** @class */ (function (_super) {
  __extends(SnapshotVersionRequest, _super);
  function SnapshotVersionRequest(connection, requestId, collection, id, version, callback) {
    var _this = _super.call(this, connection, requestId, collection, id, callback) || this;
    if (!util.isValidVersion(version)) {
      throw new Error('Snapshot version must be a positive integer or null');
    }
    _this.version = version;
    return _this;
  }
  SnapshotVersionRequest.prototype._message = function () {
    return {
      a: message_actions_1.ACTIONS.snapshotFetch,
      id: this.requestId,
      c: this.collection,
      d: this.id,
      v: this.version,
    };
  };
  return SnapshotVersionRequest;
})(SnapshotRequest);
module.exports = SnapshotVersionRequest;
