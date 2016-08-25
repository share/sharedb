var async = require('async');
var Agent = require('./agent');
var Connection = require('./client/connection');
var emitter = require('./emitter');
var MemoryDB = require('./db/memory');
var MemoryPubSub = require('./pubsub/memory');
var ot = require('./ot');
var projections = require('./projections');
var QueryEmitter = require('./query-emitter');
var StreamSocket = require('./stream-socket');
var SubmitRequest = require('./submit-request');

function Backend(options) {
  if (!(this instanceof Backend)) return new Backend(options);
  emitter.EventEmitter.call(this);

  if (!options) options = {};
  this.db = options.db || new MemoryDB();
  this.pubsub = options.pubsub || new MemoryPubSub();
  // This contains any extra databases that can be queried
  this.extraDbs = options.extraDbs || {};

  // Map from projected collection -> {type, fields}
  this.projections = {};

  this.suppressPublish = !!options.suppressPublish;
  this.maxSubmitRetries = options.maxSubmitRetries || null;

  // Map from event name to a list of middleware
  this.middleware = {};

  // The number of open agents for monitoring and testing memory leaks
  this.agentsCount = 0;
  this.remoteAgentsCount = 0;
}
module.exports = Backend;
emitter.mixin(Backend);

Backend.prototype.close = function(callback) {
  var wait = 3;
  var backend = this;
  function finish(err) {
    if (err) {
      if (callback) return callback(err);
      return backend.emit('error', err);
    }
    if (--wait) return;
    if (callback) callback();
  }
  this.pubsub.close(finish);
  this.db.close(finish);
  for (var name in this.extraDbs) {
    wait++;
    this.extraDbs[name].close(finish);
  }
  finish();
};

Backend.prototype.connect = function(connection, req) {
  var socket = new StreamSocket();
  if (connection) {
    connection.bindToSocket(socket);
  } else {
    connection = new Connection(socket);
  }
  socket._open();
  var agent = this.listen(socket.stream, req);
  // Store a reference to the agent on the connection for convenience. This is
  // not used internal to ShareDB, but it is handy for server-side only user
  // code that may cache state on the agent and read it in middleware
  connection.agent = agent;
  return connection;
};

/** A client has connected through the specified stream. Listen for messages.
 *
 * The optional second argument (req) is an initial request which is passed
 * through to any connect() middleware. This is useful for inspecting cookies
 * or an express session or whatever on the request object in your middleware.
 *
 * (The agent is available through all middleware)
 */
Backend.prototype.listen = function(stream, req) {
  var agent = new Agent(this, stream);
  this.trigger('connect', agent, {stream: stream, req: req}, function(err) {
    if (err) return agent.close(err);
    agent._open();
  });
  return agent;
};

Backend.prototype.addProjection = function(name, collection, fields) {
  if (this.projections[name]) {
    throw new Error('Projection ' + name + ' already exists');
  }

  for (var key in fields) {
    if (fields[key] !== true) {
      throw new Error('Invalid field ' + key + ' - fields must be {somekey: true}. Subfields not currently supported.');
    }
  }

  this.projections[name] = {
    target: collection,
    fields: fields
  };
};

/**
 * Add middleware to an action or array of actions
 */
Backend.prototype.use = function(action, fn) {
  if (Array.isArray(action)) {
    for (var i = 0; i < action.length; i++) {
      this.use(action[i], fn);
    }
    return;
  }
  var fns = this.middleware[action] || (this.middleware[action] = []);
  fns.push(fn);
  return this;
};

/**
 * Passes request through the middleware stack
 *
 * Middleware may modify the request object. After all middleware have been
 * invoked we call `callback` with `null` and the modified request. If one of
 * the middleware resturns an error the callback is called with that error.
 */
Backend.prototype.trigger = function(action, agent, request, callback) {
  request.action = action;
  request.agent = agent;
  request.backend = this;

  var fns = this.middleware[action];
  if (!fns) return callback();

  // Copying the triggers we'll fire so they don't get edited while we iterate.
  fns = fns.slice();
  var next = function(err) {
    if (err) return callback(err);
    var fn = fns.shift();
    if (!fn) return callback();
    fn(request, next);
  };
  next();
};

// Submit an operation on the named collection/docname. op should contain a
// {op:}, {create:} or {del:} field. It should probably contain a v: field (if
// it doesn't, it defaults to the current version).
Backend.prototype.submit = function(agent, index, id, op, options, callback) {
  var err = ot.checkOp(op);
  if (err) return callback(err);
  var request = new SubmitRequest(this, agent, index, id, op, options);
  var backend = this;
  backend.trigger('submit', agent, request, function(err) {
    if (err) return callback(err);
    request.submit(function(err) {
      if (err) return callback(err);
      backend.trigger('after submit', agent, request, function(err) {
        if (err) return callback(err);
        backend._sanitizeOps(agent, request.projection, request.collection, id, request.ops, function(err) {
          if (err) return callback(err);
          backend.emit('timing', 'submit.total', Date.now() - request.start, request);
          callback(err, request.ops);
        });
      });
    });
  });
};

Backend.prototype._sanitizeOp = function(agent, projection, collection, id, op, callback) {
  if (projection) {
    try {
      projections.projectOp(projection.fields, op);
    } catch (err) {
      return callback(err);
    }
  }
  this.trigger('op', agent, {collection: collection, id: id, op: op}, callback);
};
Backend.prototype._sanitizeOps = function(agent, projection, collection, id, ops, callback) {
  var backend = this;
  async.each(ops, function(op, eachCb) {
    backend._sanitizeOp(agent, projection, collection, id, op, eachCb);
  }, callback);
};
Backend.prototype._sanitizeOpsBulk = function(agent, projection, collection, opsMap, callback) {
  var backend = this;
  async.forEachOf(opsMap, function(ops, id, eachCb) {
    backend._sanitizeOps(agent, projection, collection, id, ops, eachCb);
  }, callback);
};

Backend.prototype._sanitizeSnapshot = function(agent, projection, collection, id, snapshot, callback) {
  if (projection) {
    try {
      projections.projectSnapshot(projection.fields, snapshot);
    } catch (err) {
      return callback(err);
    }
  }
  this.trigger('doc', agent, {collection: collection, id: id, snapshot: snapshot}, callback);
};
Backend.prototype._sanitizeSnapshots = function(agent, projection, collection, snapshots, callback) {
  var backend = this;
  async.each(snapshots, function(snapshot, eachCb) {
    backend._sanitizeSnapshot(agent, projection, collection, snapshot.id, snapshot, eachCb);
  }, callback);
};
Backend.prototype._sanitizeSnapshotBulk = function(agent, projection, collection, snapshotMap, callback) {
  var backend = this;
  async.forEachOf(snapshotMap, function(snapshot, id, eachCb) {
    backend._sanitizeSnapshot(agent, projection, collection, id, snapshot, eachCb);
  }, callback);
};

Backend.prototype._getSnapshotProjection = function(db, projection) {
  return (db.projectsSnapshots) ? null : projection;
};

// Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
// not defined (null or undefined) then it returns all ops.
Backend.prototype.getOps = function(agent, index, id, from, to, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var backend = this;
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    id: id,
    from: from,
    to: to
  };
  backend.db.getOps(collection, id, from, to, null, function(err, ops) {
    if (err) return callback(err);
    backend._sanitizeOps(agent, projection, collection, id, ops, function(err) {
      if (err) return callback(err);
      backend.emit('timing', 'getOps', Date.now() - start, request);
      callback(err, ops);
    });
  });
};

Backend.prototype.getOpsBulk = function(agent, index, fromMap, toMap, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var backend = this;
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    fromMap: fromMap,
    toMap: toMap
  };
  backend.db.getOpsBulk(collection, fromMap, toMap, null, function(err, opsMap) {
    if (err) return callback(err);
    backend._sanitizeOpsBulk(agent, projection, collection, opsMap, function(err) {
      if (err) return callback(err);
      backend.emit('timing', 'getOpsBulk', Date.now() - start, request);
      callback(err, opsMap);
    });
  });
};

Backend.prototype.fetch = function(agent, index, id, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var backend = this;
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    id: id
  };
  backend.db.getSnapshot(collection, id, fields, null, function(err, snapshot) {
    if (err) return callback(err);
    var snapshotProjection = backend._getSnapshotProjection(backend.db, projection);
    backend._sanitizeSnapshot(agent, snapshotProjection, collection, id, snapshot, function(err) {
      if (err) return callback(err);
      backend.emit('timing', 'fetch', Date.now() - start, request);
      callback(null, snapshot);
    });
  });
};

Backend.prototype.fetchBulk = function(agent, index, ids, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var fields = projection && projection.fields;
  var backend = this;
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    ids: ids
  };
  backend.db.getSnapshotBulk(collection, ids, fields, null, function(err, snapshotMap) {
    if (err) return callback(err);
    var snapshotProjection = backend._getSnapshotProjection(backend.db, projection);
    backend._sanitizeSnapshotBulk(agent, snapshotProjection, collection, snapshotMap, function(err) {
      if (err) return callback(err);
      backend.emit('timing', 'fetchBulk', Date.now() - start, request);
      callback(null, snapshotMap);
    });
  });
};

// Subscribe to the document from the specified version or null version
Backend.prototype.subscribe = function(agent, index, id, version, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var channel = this.getDocChannel(collection, id);
  var backend = this;
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    id: id,
    version: version
  };
  backend.pubsub.subscribe(channel, function(err, stream) {
    if (err) return callback(err);
    stream.initProjection(backend, agent, projection);
    if (version == null) {
      // Subscribing from null means that the agent doesn't have a document
      // and needs to fetch it as well as subscribing
      backend.fetch(agent, index, id, function(err, snapshot) {
        if (err) return callback(err);
        backend.emit('timing', 'subscribe.snapshot', Date.now() - start, request);
        callback(null, stream, snapshot);
      });
    } else {
      backend.db.getOps(collection, id, version, null, null, function(err, ops) {
        if (err) return callback(err);
        stream.pushOps(collection, id, ops);
        backend.emit('timing', 'subscribe.ops', Date.now() - start, request);
        callback(null, stream);
      });
    }
  });
};

Backend.prototype.subscribeBulk = function(agent, index, versions, callback) {
  var start = Date.now();
  var projection = this.projections[index];
  var collection = (projection) ? projection.target : index;
  var backend = this;
  var streams = {};
  var doFetch = Array.isArray(versions);
  var ids = (doFetch) ? versions : Object.keys(versions);
  var request = {
    agent: agent,
    index: index,
    collection: collection,
    versions: versions
  };
  async.each(ids, function(id, eachCb) {
    var channel = backend.getDocChannel(collection, id);
    backend.pubsub.subscribe(channel, function(err, stream) {
      if (err) return eachCb(err);
      stream.initProjection(backend, agent, projection);
      streams[id] = stream;
      eachCb();
    });
  }, function(err) {
    if (err) {
      destroyStreams(streams);
      return callback(err);
    }
    if (doFetch) {
      // If an array of ids, get current snapshots
      backend.fetchBulk(agent, index, ids, function(err, snapshotMap) {
        if (err) {
          destroyStreams(streams);
          return callback(err);
        }
        backend.emit('timing', 'subscribeBulk.snapshot', Date.now() - start, request);
        callback(null, streams, snapshotMap);
      });
    } else {
      // If a versions map, get ops since requested versions
      backend.db.getOpsBulk(collection, versions, null, null, function(err, opsMap) {
        if (err) {
          destroyStreams(streams);
          return callback(err);
        }
        for (var id in opsMap) {
          var ops = opsMap[id];
          streams[id].pushOps(collection, id, ops);
        }
        backend.emit('timing', 'subscribeBulk.ops', Date.now() - start, request);
        callback(null, streams);
      });
    }
  });
};
function destroyStreams(streams) {
  for (var id in streams) {
    streams[id].destroy();
  }
}

Backend.prototype.queryFetch = function(agent, index, query, options, callback) {
  var start = Date.now();
  var backend = this;
  backend._triggerQuery(agent, index, query, options, function(err, request) {
    if (err) return callback(err);
    backend._query(agent, request, function(err, snapshots, extra) {
      if (err) return callback(err);
      backend.emit('timing', 'queryFetch', Date.now() - start, request);
      callback(null, snapshots, extra);
    });
  });
};

// Options can contain:
// db: The name of the DB (if the DB is specified in the otherDbs when the backend instance is created)
// skipPoll: function(collection, id, op, query) {return true or false; }
//  this is a syncronous function which can be used as an early filter for
//  operations going through the system to reduce the load on the DB.
// pollDebounce: Minimum delay between subsequent database polls. This is
//  used to batch updates to reduce load on the database at the expense of
//  liveness
Backend.prototype.querySubscribe = function(agent, index, query, options, callback) {
  var start = Date.now();
  var backend = this;
  backend._triggerQuery(agent, index, query, options, function(err, request) {
    if (err) return callback(err);
    if (request.db.disableSubscribe) {
      return callback({code: 4002, message: 'DB does not support subscribe'});
    }
    backend.pubsub.subscribe(request.channel, function(err, stream) {
      if (err) return callback(err);
      stream.initProjection(backend, agent, request.projection);
      if (options.ids) {
        var queryEmitter = new QueryEmitter(request, stream, options.ids);
        backend.emit('timing', 'querySubscribe.reconnect', Date.now() - start, request);
        callback(null, queryEmitter);
        return;
      }
      // Issue query on db to get our initial results
      backend._query(agent, request, function(err, snapshots, extra) {
        if (err) {
          stream.destroy();
          return callback(err);
        }
        var ids = pluckIds(snapshots);
        var queryEmitter = new QueryEmitter(request, stream, ids, extra);
        backend.emit('timing', 'querySubscribe.initial', Date.now() - start, request);
        callback(null, queryEmitter, snapshots, extra);
      });
    });
  });
};

Backend.prototype._triggerQuery = function(agent, index, query, options, callback) {
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
  var backend = this;
  backend.trigger('query', agent, request, function(err) {
    if (err) return callback(err);
    // Set the DB reference for the request after the middleware trigger so
    // that the db option can be changed in middleware
    request.db = (options.db) ? backend.extraDbs[options.db] : backend.db;
    if (!request.db) return callback({code: 4003, message: 'DB not found'});
    request.snapshotProjection = backend._getSnapshotProjection(request.db, projection);
    callback(null, request);
  });
};

Backend.prototype._query = function(agent, request, callback) {
  var backend = this;
  request.db.query(request.collection, request.query, request.fields, request.options, function(err, snapshots, extra) {
    if (err) return callback(err);
    backend._sanitizeSnapshots(agent, request.snapshotProjection, request.collection, snapshots, function(err) {
      callback(err, snapshots, extra);
    });
  });
};

Backend.prototype.getCollectionChannel = function(collection) {
  return collection;
};

Backend.prototype.getDocChannel = function(collection, id) {
  return collection + '.' + id;
};

Backend.prototype.getChannels = function(collection, id) {
  return [
    this.getCollectionChannel(collection),
    this.getDocChannel(collection, id)
  ];
};

function pluckIds(snapshots) {
  var ids = [];
  for (var i = 0; i < snapshots.length; i++) {
    ids.push(snapshots[i].id);
  }
  return ids;
}
