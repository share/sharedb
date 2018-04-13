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
var inherits = require('util').inherits;
var util = require('./util');
var StreamSocket = /** @class */ (function () {
    function StreamSocket() {
        this.isServer = true;
        this.readyState = 0;
        this.stream = new ServerStream(this);
    }
    StreamSocket.prototype._open = function () {
        if (this.readyState !== 0)
            return;
        this.readyState = 1;
        this.onopen();
    };
    ;
    StreamSocket.prototype.close = function (reason) {
        if (this.readyState === 3)
            return;
        this.readyState = 3;
        // Signal data writing is complete. Emits the 'end' event
        this.stream.push(null);
        this.onclose(reason || 'closed');
    };
    ;
    StreamSocket.prototype.send = function (data) {
        // Data is an object
        this.stream.push(JSON.parse(data));
    };
    ;
    StreamSocket.prototype.onmessage = function () {
    };
    StreamSocket.prototype.onclose = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
    };
    StreamSocket.prototype.onerror = function () {
    };
    StreamSocket.prototype.onopen = function () {
    };
    return StreamSocket;
}());
var ServerStream = /** @class */ (function (_super) {
    __extends(ServerStream, _super);
    function ServerStream(socket) {
        var _this = _super.call(this, { objectMode: true }) || this;
        _this.socket = socket;
        _this.on('error', function (error) {
            console.warn('ShareDB client message stream error', error);
            socket.close('stopped');
        });
        // The server ended the writable stream. Triggered by calling stream.end()
        // in agent.close()
        _this.on('finish', function () {
            socket.close('stopped');
        });
        return _this;
    }
    ServerStream.prototype._read = function () {
    };
    ;
    ServerStream.prototype._write = function (chunk, encoding, callback) {
        var socket = this.socket;
        process.nextTick(function () {
            if (socket.readyState !== 1)
                return;
            socket.onmessage({ data: JSON.stringify(chunk) });
            callback();
        });
    };
    ;
    return ServerStream;
}(stream_1.Duplex));
module.exports = StreamSocket;
