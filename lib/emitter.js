'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.EventEmitter = void 0;
exports.mixin = mixin;
var events_1 = require('events');
Object.defineProperty(exports, 'EventEmitter', {
  enumerable: true,
  get: function () {
    return events_1.EventEmitter;
  },
});
function mixin(Constructor) {
  for (var key in events_1.EventEmitter.prototype) {
    Constructor.prototype[key] = events_1.EventEmitter.prototype[key];
  }
}
