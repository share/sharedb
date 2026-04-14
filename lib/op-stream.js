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
var stream_1 = require('stream');
var util = require('./util');
/** Stream of operations. Subscribe returns one of these */
var OpStream = /** @class */ (function (_super) {
  __extends(OpStream, _super);
  function OpStream() {
    var _this = _super.call(this, { objectMode: true }) || this;
    _this.id = null;
    _this.open = true;
    return _this;
  }
  OpStream.prototype.pushData = function (data) {
    // Ignore any messages after unsubscribe
    if (!this.open) return;
    // This data gets consumed in Agent#_subscribeToStream
    this.push(data);
  };
  OpStream.prototype.destroy = function () {
    // Only close stream once
    if (!this.open) return;
    this.open = false;
    this.push(null);
    this.emit('close');
  };
  return OpStream;
})(stream_1.Readable);
(function () {
  OpStream.prototype._read = util.doNothing;
})();
module.exports = OpStream;
