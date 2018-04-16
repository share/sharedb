"use strict";
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
var stream_1 = require("stream");
// Stream of operations. Subscribe returns one of these
var OpStream = /** @class */ (function (_super) {
    __extends(OpStream, _super);
    function OpStream() {
        var _this = _super.call(this, { objectMode: true }) || this;
        _this.id = null;
        _this.backend = null;
        _this.agent = null;
        _this.projection = null;
        _this.open = true;
        return _this;
    }
    // This function is for notifying us that the stream is empty and needs data.
    // For now, we'll just ignore the signal and assume the reader reads as fast
    // as we fill it. I could add a buffer in this function, but really I don't
    // think that is any better than the buffer implementation in nodejs streams
    // themselves.
    OpStream.prototype._read = function () {
    };
    OpStream.prototype.initProjection = function (backend, agent, projection) {
        this.backend = backend;
        this.agent = agent;
        this.projection = projection;
    };
    ;
    OpStream.prototype.pushOp = function (collection, id, op) {
        if (this.backend) {
            var stream = this;
            this.backend._sanitizeOp(this.agent, this.projection, collection, id, op, function (err) {
                if (!stream.open)
                    return;
                stream.push(err ? { error: err } : op);
            });
        }
        else {
            // Ignore any messages after unsubscribe
            if (!this.open)
                return;
            this.push(op);
        }
    };
    ;
    OpStream.prototype.pushOps = function (collection, id, ops) {
        for (var i = 0; i < ops.length; i++) {
            this.pushOp(collection, id, ops[i]);
        }
    };
    ;
    OpStream.prototype.destroy = function () {
        if (!this.open)
            return;
        this.open = false;
        this.push(null);
        this.emit('close');
    };
    ;
    return OpStream;
}(stream_1.Readable));
module.exports = OpStream;
