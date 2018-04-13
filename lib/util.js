"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var doNothing = function () { return void 0; };
exports.doNothing = doNothing;
var hasKeys = function (object) {
    for (var key in object)
        return true;
    return false;
};
exports.hasKeys = hasKeys;
