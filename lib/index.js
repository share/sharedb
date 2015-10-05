var async = require('async');
var emitter = require('./emitter');
var ot = require('./ot');
var projections = require('./projections');
var Agent = require('./agent');
var QueryEmitter = require('./query-emitter');
var SubmitRequest = require('./submit-request');

function ShareDB(options) {
  if (!(this instanceof ShareDB)) return new ShareDB(options);
  emitter.EventEmitter.call(this);

  if (!options) options = {};
  this.pubsub = options.pubsub || ShareDB.MemoryDB();
  this.db = options.db || ShareDB.MemoryPubSub();
  // This contains any extra databases that can be queried
  this.extraDbs = options.extraDbs || {};

  // Map from projected collection -> {type, fields}
  this.projections = {};

  this.suppressPublish = !!options.suppressPublish;
  this.maxSubmitRetries = options.maxSubmitRetries || null;

  // Map from event name to a list of middleware
  this.middleware = {};
}
module.exports = ShareDB;
emitter.mixin(ShareDB);

ShareDB.ot = ot;
ShareDB.projections = projections;
ShareDB.Agent = Agent;
ShareDB.QueryEmitter = QueryEmitter;
ShareDB.SubmitRequest = SubmitRequest;
ShareDB.types = require('./types');
ShareDB.DB = require('./db');
ShareDB.MemoryDB = require('./db/memory');
ShareDB.PubSub = require('./pubsub');
ShareDB.MemoryPubSub = require('./pubsub/memory');

ShareDB.prototype.close = function() {
  this.pubsub.close();
  this.db.close();
  for (var name in this.extraDbs) {
    this.extraDbs[name].close();
  }
};

/** A client has connected through the specified stream. Listen for messages.
 * Returns the useragent associated with the connected session.
 *
 * The optional second argument (req) is an initial request which is passed
 * through to any connect() middleware. This is useful for inspecting cookies
 * or an express session or whatever on the request object in your middleware.
 *
 * (The useragent is available through all middleware)
 */
ShareDB.prototype.listen = function(stream, req) {
  var agent = new Agent(this, stream);
  this.trigger('connect', agent, {stream: stream, req: req}, function(err) {
    if (err) return agent.close(err);
    agent.pump();
  });
  return agent;
};

ShareDB.prototype.addProjection = function(name, collection, type, fields) {
  if (this.projections[name]) {
    throw new Error('Projection ' + name + ' already exists');
  }

  for (var k in fields) {
    if (fields[k] !== true) {
      throw new Error('Invalid field ' + k + ' - fields must be {somekey:true}. Subfields not currently supported.');
    }
  }

  this.projections[name] = {
    target: collection,
    type: ot.normalizeType(type),
    fields: fields
  };
};

/**
 * Add middleware to an action or array of actions
 */
ShareDB.prototype.use = function(action, fn) {
  if (Array.isArray(action)) {
    for (var i = 0; i < action.length; i++) {
      this.use(action[i], fn);
    }
    return;
  }
  var fns = this.middleware[action] || (this.middleware[action] = []);
  fns.push(fn);
};

/**
 * Passes request through the middleware stack
 *
 * Middleware may modify the request object. After all middleware have been
 * invoked we call `callback` with `null` and the modified request. If one of
 * the middleware resturns an error the callback is called with that error.
 */
ShareDB.prototype.trigger = function(action, agent, request, callback) {
  request.action = action;
  request.agent = agent;
  request.share = this;

  var fns = this.middleware[action];
  if (!fns) return callback();

  // Copying the triggers we'll fire so they don't get edited while we iterate.
  fns = fns.slice();
  var next = function(err) {
    if (err) return callback(err);
    var fn = fns.shift();
    if (!fn) return callback(null, request);
    fn(request, next);
  };
  next();
};

ShareDB.prototype._sanitizeOp = function(agent, projection, collection, id, op, callback) {
  if (projection) {
    try {
      op = projections.projectOp(projection.fields, op);
    } catch (err) {
      return callback(err);
    }
  }
  this.trigger('op', agent, {collection: collection, id: id, op: op}, callback);
};
ShareDB.prototype._sanitizeOps = function(agent, projection, collection, id, ops, callback) {
  var share = this;
  async.each(ops, function(op, eachCb) {
    share._sanitizeOp(agent, projection, collection, id, op, eachCb);
  }, callback);
};
ShareDB.prototype._sanitizeOpsBulk = function(agent, projection, collection, opsMap, callback) {
  var share = this;
  async.forEachOf(opsMap, function(ops, id, eachCb) {
    share._sanitizeOps(agent, projection, collection, id, ops, eachCb);
  }, callback);
};

ShareDB.prototype._sanitizeSnapshot = function(agent, projection, collection, id, snapshot, callback) {
  if (projection) {
    try {
      snapshot = projections.projectSnapshot(projection.fields, snapshot);
    } catch (err) {
      return callback(err);
    }
  }
  this.trigger('doc', agent, {collection: collection, id: id, snapshot: snapshot}, callback);
};
ShareDB.prototype._sanitizeSnapshots = function(agent, projection, collection, snapshots, callback) {
  var share = this;
  async.each(snapshots, function(snapshot, eachCb) {
    share._sanitizeSnapshot(agent, projection, collection, snapshot.id, snapshot, eachCb);
  }, callback);
};
ShareDB.prototype._sanitizeSnapshotBulk = function(agent, projection, collection, snapshotMap, callback) {
  var share = this;
  async.forEachOf(snapshotMap, function(ops, id, eachCb) {
    share._sanitizeSnapshot(agent, projection, collection, id, snapshot, eachCb);
  }, callback);
};

ShareDB.prototype._getSnapshotProjection = function(db, projection) {
  return (db.projectsSnapshot) ? null : projection;
};

// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops.
ShareDB.prototype.getOps = function(agent, index, id, from, to, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var share = this;
  share.db.getOps(collection, id, from, to, function(err, ops) {
    if (err) return callback(err);
    share._sanitizeOps(agent, projection, collection, id, ops, function(err) {
      if (err) return callback(err);
      share.emit('timing', 'getOps', Date.now() - start);
      callback(err, ops);
    });
  });
};

ShareDB.prototype.getOpsBulk = function(agent, index, fromMap, toMap, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var share = this;
  share.db.getOpsBulk(collection, fromMap, toMap, function(err, opsMap) {
    if (err) return callback(err);
    share._sanitizeOpsBulk(agent, projection, collection, opsMap, function(err) {
      if (err) return callback(err);
      share.emit('timing', 'getOpsBulk', Date.now() - start);
      callback(err, opsMap);
    });
  });
};

// Submit an operation on the named collection/docname. op should contain a
// {op:}, {create:} or {del:} field. It should probably contain a v: field (if
// it doesn't, it defaults to the current version).
//
// callback called with (err, snapshot, ops)
ShareDB.prototype.submit = function(agent, index, id, op, callback) {
  var err = ot.checkOp(op);
  if (err) return callback(err);
  var request = new SubmitRequest(this, agent, index, id, op);
  var share = this;
  share.trigger('submit', agent, request, function(err) {
    if (err) return callback(err);
    request.run(function(err, snapshot, ops) {
      if (err) return callback(err);
      share.trigger('after submit', agent, request, function(err) {
        if (err) return callback(err);
        share._sanitizeOps(agent, request.projection, request.collection, id, ops, function(err) {
          if (err) return callback(err);
          share.emit('timing', 'submit.total', Date.now() - request.start);
          callback(err, ops);
        });
      });
    });
  });
};

ShareDB.prototype.fetch = function(agent, index, id, callback) {
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var start = Date.now();
  var share = this;
  share.db.getSnapshot(collection, id, fields, function(err, snapshot) {
    if (err) return callback(err);
    var snapshotProjection = share._getSnapshotProjection(share.db, projection);
    share._sanitizeSnapshot(agent, snapshotProjection, collection, id, snapshot, function(err) {
      if (err) return callback(err);
      share.emit('timing', 'fetch', Date.now() - start);
      callback(null, snapshot);
    });
  });
};

ShareDB.prototype.fetchBulk = function(agent, index, ids, callback) {
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var start = Date.now();
  var share = this;
  share.db.getSnapshotBulk(collection, ids, fields, function(err, snapshotMap) {
    if (err) return done(err);
    var snapshotProjection = share._getSnapshotProjection(share.db, projection);
    share._sanitizeSnapshotBulk(agent, snapshotProjection, collection, snapshotMap, function(err) {
      if (err) return callback(err);
      share.emit('timing', 'fetchBulk', Date.now() - start);
      callback(null, snapshotMap);
    });
  });
};

// Subscribe to the document from the specified version or null version
ShareDB.prototype.subscribe = function(agent, index, id, version, callback) {
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var channel = this.getDocChannel(collection, id);
  var start = Date.now();
  var share = this;
  share.pubsub.subscribe(channel, function(err, stream) {
    if (err) return callback(err);
    stream.initDocSubscribe(share, agent, projection, version);
    if (version == null) {
      // Subscribing from null means that the agent doesn't have a document
      // and needs to fetch it as well as subscribing
      share.fetch(index, id, function(err, snapshot) {
        if (err) return callback(err);
        share.emit('timing', 'subscribe', Date.now() - start);
        callback(null, stream, snapshot);
      });
    } else {
      share.db.getOps(collection, id, version, null, function(err, ops) {
        if (err) return callback(err);
        stream.pack(version, ops);
        share.emit('timing', 'subscribe', Date.now() - start);
        callback(null, stream);
      });
    }
  });
};

ShareDB.prototype.subscribeBulk = function(agent, index, versions, callback) {
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var start = Date.now();
  var share = this;
  var streams = {};
  var fetchIds = [];
  var opsVersions = null;
  async.forEachOf(versions, function(version, id, eachCb) {
    if (version == null) {
      fetchIds.push(version);
    } else {
      if (!opsVersions) opsVersions = {};
      opsVersions[id] = version;
    }
    var channel = share.getDocChannel(collection, id);
    share.pubsub.subscribe(channel, function(err, stream) {
      if (err) return eachCb(err);
      stream.initDocSubscribe(share, agent, projection, version);
      streams[id] = stream;
      eachCb();
    });
  }, function(err) {
    if (err) {
      closeStreams(streams);
      return callback(err);
    }
    async.parallel({
      snapshotMap: function(parallelCb) {
        if (!fetchIds.length) return parallelCb(null, {});
        share.fetchBulk(agent, index, fetchIds, parallelCb);
      },
      ops: function(parallelCb) {
        if (!opsVersions) return parallelCb();
        this.db.getOpsBulk(collection, opsVersions, null, function(err, opsMap) {
          if (err) return parallelCb(err);
          for (var id in opsVersions) {
            var version = opsVersions[id];
            var ops = opsMap[id];
            streams[index][id].pack(version, ops);
          }
          parallelCb();
        });
      }
    }, function(err, results) {
      if (err) {
        closeStreams(streams);
        return callback(err);
      }
      share.emit('timing', 'subscribeBulk', Date.now() - start);
      callback(null, streams, results.snapshotMap);
    });
  });
};

ShareDB.prototype.queryFetch = function(agent, index, query, options, callback) {
  var start = Date.now();
  var share = this;
  share._triggerQuery(agent, index, query, options, function(err, request) {
    if (err) return callback(err);
    share._query(agent, request, function(err, snapshots, extra) {
      if (err) return callback(err);
      share.emit('timing', 'queryFetch', Date.now() - start, request);
      callback(null, snapshots, extra);
    });
  });
};

// Options can contain:
// db: The name of the DB (if the DB is specified in the otherDbs when the share instance is created)
// skipPoll: function(collection, id, op, query) {return true or false; }
//  this is a syncronous function which can be used as an early filter for
//  operations going through the system to reduce the load on the DB.
// pollDebounce: Minimum delay between subsequent database polls. This is
//  used to batch updates to reduce load on the database at the expense of
//  liveness. Defaults to 1000 (1 second)
ShareDB.prototype.querySubscribe = function(agent, index, query, options, callback) {
  var start = Date.now();
  var share = this;
  share._triggerQuery(agent, index, query, options, function(err, request) {
    if (err) return callback(err);
    if (request.db.disableSubscribe) return callback({message: 'DB does not support subscribe'});
    share.pubsub.subscribe(request.channel, function(err, stream) {
      if (err) return callback(err);
      // Issue query on db to get our initial results
      stream.projection = request.projection;
      stream.share = share;
      stream.agent = agent;
      share._query(agent, request, function(err, snapshots, extra) {
        if (err) {
          stream.destroy();
          return callback(err);
        }
        var queryEmitter = new QueryEmitter(request, stream, snapshots, extra);
        share.emit('timing', 'querySubscribe', Date.now() - start, request);
        callback(null, queryEmitter, snapshots, extra);
      });
    });
  });
};

ShareDB.prototype._triggerQuery = function(agent, index, query, options, callback) {
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var request = {
    index: index,
    collection: collection,
    projection: projection,
    fields: fields,
    channel: this.getCollectionChannel(collection),
    query: query,
    options: options,
    db: null,
    snapshotProjection: null,
  };
  var share = this;
  share.trigger('query', agent, request, function(err) {
    if (err) return callback(err);
    // Set the DB reference for the request after the middleware trigger so
    // that the db option can be changed in middleware
    request.db = (options.db) ? this.extraDbs[options.db] : share.db;
    if (!request.db) return callback({message: 'DB not found'});
    request.snapshotProjection = share._getSnapshotProjection(request.db, projection);
    callback(null, request);
  });
};

ShareDB.prototype._query = function(agent, request, callback) {
  var share = this;
  request.db.query(request.collection, request.query, request.fields, request.options, function(err, snapshots, extra) {
    if (err) return callback(err);
    share._sanitizeSnapshots(agent, request.snapshotProjection, request.collection, snapshots, function(err) {
      callback(err, snapshots, extra);
    });
  });
};

ShareDB.prototype.getCollectionChannel = function(collection) {
  return collection;
};

ShareDB.prototype.getDocChannel = function(collection, id) {
  return collection + '.' + id;
};

ShareDB.prototype.getChannels = function(collection, id) {
  return [
    this.getCollectionChannel(collection),
    this.getDocChannel(collection, id)
  ];
};
