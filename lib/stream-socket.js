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
var logger = require('./logger');
var util = require('./util');
var StreamSocket = /** @class */ (function () {
  function StreamSocket() {
    this.readyState = 0;
    this.stream = new ServerStream(this);
  }
  StreamSocket.prototype._open = function () {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen();
  };
  StreamSocket.prototype.close = function (reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // Signal data writing is complete. Emits the 'end' event
    this.stream.push(null);
    this.onclose(reason || 'closed');
  };
  StreamSocket.prototype.send = function (data) {
    // Data is an object
    this.stream.push(JSON.parse(data));
  };
  return StreamSocket;
})();
(function () {
  StreamSocket.prototype.onmessage = util.doNothing;
})();
(function () {
  StreamSocket.prototype.onclose = util.doNothing;
})();
(function () {
  StreamSocket.prototype.onerror = util.doNothing;
})();
(function () {
  StreamSocket.prototype.onopen = util.doNothing;
})();
var ServerStream = /** @class */ (function (_super) {
  __extends(ServerStream, _super);
  function ServerStream(socket) {
    var _this = _super.call(this, { objectMode: true }) || this;
    _this.socket = socket;
    _this.on('error', function (error) {
      logger.warn('ShareDB client message stream error', error);
      socket.close('stopped');
    });
    // The server ended the writable stream. Triggered by calling stream.end()
    // in agent.close()
    _this.on('finish', function () {
      socket.close('stopped');
    });
    return _this;
  }
  ServerStream.prototype._write = function (chunk, encoding, callback) {
    var socket = this.socket;
    util.nextTick(function () {
      if (socket.readyState !== 1) return;
      socket.onmessage({ data: JSON.stringify(chunk) });
      callback();
    });
  };
  return ServerStream;
})(stream_1.Duplex);
(function () {
  ServerStream.prototype.isServer = true;
})();
(function () {
  ServerStream.prototype._read = util.doNothing;
})();
module.exports = StreamSocket;
