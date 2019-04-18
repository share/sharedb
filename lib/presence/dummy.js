function DummyPresence () { }
function noop () {}

DummyPresence.prototype.flushPresence = noop;
DummyPresence.prototype.destroyPresence = noop;
DummyPresence.prototype.clearCachedOps = noop; // this.presence.cachedOps.length = 0;
DummyPresence.prototype.processAllReceivedPresence = noop;
DummyPresence.prototype.hardRollbackPresence = function () { return []; };
DummyPresence.prototype.transformAllPresence = noop;
DummyPresence.prototype.cacheOp = noop;
DummyPresence.prototype.hasPending = function () { return false }; // (this.presence.inflight || this.presence.pending)
DummyPresence.prototype.pause = noop;

module.exports = DummyPresence;
