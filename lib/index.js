'use strict';
var Backend = require('./backend');
module.exports = Object.assign(Backend, {
  Agent: require('./agent'),
  Backend: Backend,
  DB: require('./db'),
  Error: require('./error'),
  logger: require('./logger'),
  MemoryDB: require('./db/memory'),
  MemoryMilestoneDB: require('./milestone-db/memory'),
  MemoryPubSub: require('./pubsub/memory'),
  MESSAGE_ACTIONS: require('./message-actions').ACTIONS,
  MilestoneDB: require('./milestone-db'),
  ot: require('./ot'),
  projections: require('./projections'),
  PubSub: require('./pubsub'),
  QueryEmitter: require('./query-emitter'),
  SubmitRequest: require('./submit-request'),
  types: require('./types'),
});
