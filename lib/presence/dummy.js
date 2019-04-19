/*
 * Dummy Presence
 * --------------
 *
 * This module provides a dummy implementation of presence that does nothing.
 * Its purpose is to stand in for a real implementation, to simplify code in doc.js.
 */
var presence = require('./index');

function noop () {}
function returnEmptyArray () { return []; };
function returnFalse () { return false; };

function DocPresence () {}
DocPresence.prototype = Object.create(presence.DocPresence.prototype);
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

function ConnectionPresence() {}
ConnectionPresence.prototype = Object.create(presence.ConnectionPresence.prototype);
Object.assign(ConnectionPresence.prototype, {
  isPresenceMessage: returnFalse,
  handlePresenceMessage: noop,
  sendPresence: noop
});

function AgentPresence() {}
AgentPresence.prototype = Object.create(presence.AgentPresence.prototype);
Object.assign(AgentPresence.prototype, {
  isPresenceData: returnFalse,
  processPresenceData: returnFalse,
  //maxPresenceSeq: 0,
  createPresence: noop,
  subscribeToStream: noop,
  checkRequest: noop,
  handlePresenceMessage: noop
});

module.exports = {
  DocPresence: DocPresence,
  ConnectionPresence: ConnectionPresence,
  AgentPresence: AgentPresence
};
