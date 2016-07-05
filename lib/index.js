var Backend = require('./backend');
module.exports = Backend;

Backend.Agent = require('./agent');
Backend.Backend = Backend;
Backend.DB = require('./db');
Backend.Error = require('./error');
Backend.MemoryDB = require('./db/memory');
Backend.MemoryPubSub = require('./pubsub/memory');
Backend.ot = require('./ot');
Backend.projections = require('./projections');
Backend.PubSub = require('./pubsub');
Backend.QueryEmitter = require('./query-emitter');
Backend.SubmitRequest = require('./submit-request');
Backend.types = require('./types');
