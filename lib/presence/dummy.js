function DummyPresence () {
}

function noop () {}

DummyPresence.prototype.flush = noop;
DummyPresence.prototype.destroy = noop;
DummyPresence.prototype.clearCachedOps = noop;
DummyPresence.prototype.processAllReceivedPresence = noop;
DummyPresence.prototype.hardRollback = function () { return []; };
DummyPresence.prototype.transformAllPresence = noop;
DummyPresence.prototype.cacheOp = noop;
DummyPresence.prototype.hasPending = function () { return false };
DummyPresence.prototype.pause = noop;
DummyPresence.prototype.submit = function () {
  console.warn('Attempted to submit presence, but presence is not enabled.');
};

module.exports = DummyPresence;
