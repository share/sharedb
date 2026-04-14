'use strict';
var Snapshot = /** @class */ (function () {
  function Snapshot(id, version, type, data, meta) {
    this.id = id;
    this.v = version;
    this.type = type;
    this.data = data;
    this.m = meta;
  }
  return Snapshot;
})();
module.exports = Snapshot;
