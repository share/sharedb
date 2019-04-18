/*
 * Dummy Presence
 * ------------------
 *
 * This module provides a dummy implementation of presence that does nothing.
 * Its purpose is to stand in for a real implementation, to simplify code in doc.js.
 */

// TODO use this
// TODO inherit from Presence, add test for that.
function DummyPresence () { }
function noop () {}

DummyPresence.prototype.submitPresence = noop;
DummyPresence.prototype.handlePresence = noop;
DummyPresence.prototype.processAllReceivedPresence = noop;
DummyPresence.prototype.transformAllPresence = noop;
DummyPresence.prototype.pausePresence = noop;
DummyPresence.prototype.cacheOp = noop;
DummyPresence.prototype.flushPresence = noop;
DummyPresence.prototype.destroyPresence = noop;
DummyPresence.prototype.clearCachedOps = noop;
DummyPresence.prototype.hardRollbackPresence = function () { return []; };
DummyPresence.prototype.hasPendingPresence = function () { return false };
DummyPresence.prototype._processReceivedPresence = noop;
DummyPresence.prototype._transformPresence = noop;
DummyPresence.prototype._setPresence = noop;
DummyPresence.prototype._emitPresence = noop;

module.exports = DummyPresence;
