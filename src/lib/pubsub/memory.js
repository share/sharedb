"use strict";
// In-memory ShareDB pub/sub
//
// This is a fully functional implementation. Since ShareDB does not require
// persistence of pub/sub state, it may be used in production environments
// requiring only a single stand alone server process. Additionally, it is
// easy to swap in an external pub/sub adapter if/when additional server
// processes are desired. No pub/sub APIs are adapter specific.
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var pubsub_1 = require("./pubsub");
var MemoryPubSub = /** @class */ (function (_super) {
    __extends(MemoryPubSub, _super);
    function MemoryPubSub(options) {
        var _this = _super.call(this, options) || this;
        if (!(_this instanceof MemoryPubSub))
            return new MemoryPubSub(options);
        return _this;
    }
    MemoryPubSub.prototype._subscribe = function (channel, callback) {
        if (callback)
            process.nextTick(callback);
    };
    ;
    MemoryPubSub.prototype._unsubscribe = function (channel, callback) {
        if (callback)
            process.nextTick(callback);
    };
    ;
    MemoryPubSub.prototype._publish = function (channels, data, callback) {
        var pubsub = this;
        process.nextTick(function () {
            for (var i = 0; i < channels.length; i++) {
                var channel = channels[i];
                if (pubsub.subscribed[channel]) {
                    pubsub._emit(channel, data);
                }
            }
            if (callback)
                callback();
        });
    };
    ;
    return MemoryPubSub;
}(pubsub_1.PubSub));
module.exports = MemoryPubSub;
