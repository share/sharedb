/*
 * Dummy Presence
 * --------------
 *
 * This module provides a dummy implementation of presence that does nothing.
 * Its purpose is to stand in for a real implementation, to simplify code in doc.js.
 */
var presence = require('./index');

function DocPresence () { }

// Inherit from Presence to support instanceof type checking.
DocPresence.prototype = Object.create(presence.DocPresence.prototype);

function noop () {}
function returnEmptyArray () { return []; };
function returnFalse () { return false; };

Object.assign(DocPresence.prototype, {
  submitPresence: noop,
  handlePresence: noop,
  processAllReceivedPresence: noop,
  transformAllPresence: noop,
  pausePresence: noop,
  cacheOp: noop,
  flushPresence: noop,
  destroyPresence: noop,
  clearCachedOps: noop,
  hardRollbackPresence: returnEmptyArray,
  hasPendingPresence: returnFalse,
  getPendingPresence: returnEmptyArray,
  _processReceivedPresence: noop,
  _transformPresence: noop,
  _setPresence: noop,
  _emitPresence: noop
});

module.exports = {
  DocPresence: DocPresence
};
