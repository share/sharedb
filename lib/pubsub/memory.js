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
var PubSub = require('./index');
var util = require('../util');
/**
 * In-memory ShareDB pub/sub
 *
 * This is a fully functional implementation. Since ShareDB does not require
 * persistence of pub/sub state, it may be used in production environments
 * requiring only a single stand alone server process. Additionally, it is
 * easy to swap in an external pub/sub adapter if/when additional server
 * processes are desired. No pub/sub APIs are adapter specific.
 */
var MemoryPubSub = /** @class */ (function (_super) {
  __extends(MemoryPubSub, _super);
  function MemoryPubSub(options) {
    return _super.call(this, options) || this;
  }
  MemoryPubSub.prototype._subscribe = function (channel, callback) {
    util.nextTick(callback);
  };
  MemoryPubSub.prototype._unsubscribe = function (channel, callback) {
    util.nextTick(callback);
  };
  MemoryPubSub.prototype._publish = function (channels, data, callback) {
    var pubsub = this;
    util.nextTick(function () {
      for (var i = 0; i < channels.length; i++) {
        var channel = channels[i];
        if (pubsub.subscribed[channel]) {
          pubsub._emit(channel, data);
        }
      }
      callback();
    });
  };
  return MemoryPubSub;
})(PubSub);
module.exports = MemoryPubSub;
