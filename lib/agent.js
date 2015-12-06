var hat = require('hat');
var util = require('./util');

/**
 * Agent deserializes the wire protocol messages received from the stream and
 * calls the corresponding functions on its Agent. It uses the return values
 * to send responses back. Agent also handles piping the operation streams
 * provided by a Agent.
 *
 * @param {Backend} backend
 * @param {Duplex} stream connection to a client
 */
function Agent(backend, stream) {
  // The stream passed in should be a nodejs 0.10-style stream.
  this.backend = backend;
  this.stream = stream;

  this.clientId = hat();
  this.connectTime = Date.now();

  // We need to track which documents are subscribed by the client. This is a
  // map of collection -> id -> stream
  this.subscribedDocs = {};

  // Map from queryId -> emitter
  this.subscribedQueries = {};

  // Subscriptions care about the stream being destroyed. We end up with a
  // listener per subscribed document for the client, which can be a lot.
  stream.setMaxListeners(0);

  // We need to track this manually to make sure we don't reply to messages
  // after the stream was closed. There's no built-in way to ask a stream
  // whether its actually still open.
  this.closed = false;

  var agent = this;
  stream.once('end', function() {
    agent._cleanup();
  });

  // Initialize the remote client by sending it its agent Id.
  this._send({a: 'init', protocol: 1, id: this.clientId});
}
module.exports = Agent;

// Close the agent with the client.
Agent.prototype.close = function(err) {
  if (err) {
    console.warn('Agent closed due to error', err);
    this.stream.emit('error', err);
  }
  if (this.closed) return;
  // This will emit 'end', which will call _cleanup
  this.stream.end();
};

Agent.prototype._cleanup = function() {
  if (this.closed) return;
  this.closed = true;

  // Remove the pump listener
  this.stream.removeAllListeners('readable');

  // Clean up all the subscriptions.
  for (var collection in this.subscribedDocs) {
    var docs = this.subscribedDocs[collection];
    for (var id in docs) {
      var stream = docs[id];
      stream.destroy();
    }
  }
  // Cancel the subscribes
  this.subscribedDocs = {};

  for (var id in this.subscribedQueries) {
    var emitter = this.subscribedQueries[id];
    emitter.destroy();
  }
  // Cancel the subscribes
  this.subscribedQueries = {};
};

/**
 * Passes operation data received on stream to the agent stream via
 * _sendOp()
 */
Agent.prototype._subscribeToStream = function(collection, id, stream) {
  if (this.closed) return stream.destroy();

  var streams = this.subscribedDocs[collection] || (this.subscribedDocs[collection] = {});

  // If already subscribed to this document, destroy the previously subscribed stream
  var previous = streams[id];
  if (previous) previous.destroy();
  streams[id] = stream;

  var agent = this;
  stream.on('data', function(data) {
    if (data.error) {
      // Log then silently ignore errors in a subscription stream, since these
      // may not be the client's fault, and they were not the result of a
      // direct request by the client
      console.error('Doc subscription stream error', collection, id, data.error);
      return;
    }
    if (agent._isOwnOp(collection, data)) return;
    agent._sendOp(collection, id, data);
  });
  stream.on('end', function() {
    // Livedb has closed the op stream, so release its reference
    var streams = agent.subscribedDocs[collection];
    if (!streams) return;
    delete streams[id];
    if (util.hasKeys(streams)) return;
    delete agent.subscribedDocs[collection];
  });
};

Agent.prototype._subscribeToQuery = function(emitter, queryId, collection, query) {
  if (this.closed) return emitter.destroy();

  var previous = this.subscribedQueries[queryId];
  if (previous) previous.destroy();
  this.subscribedQueries[queryId] = emitter;

  var agent = this;
  emitter.onExtra = function(extra) {
    agent._send({a: 'q', id: queryId, extra: extra});
  };

  emitter.onDiff = function(diff) {
    for (var i = 0; i < diff.length; i++) {
      var item = diff[i];
      if (item.type === 'insert') {
        item.values = getResultsData(item.values);
      }
    }
    // Consider stripping the collection out of the data we send here
    // if it matches the query's collection.
    agent._send({a: 'q', id: queryId, diff: diff});
  };

  emitter.onError = function(err) {
    // Log then silently ignore errors in a subscription stream, since these
    // may not be the client's fault, and they were not the result of a
    // direct request by the client
    console.error('Query subscription stream error', collection, query, err);
  };

  emitter.onOp = function(op) {
    var id = op.d;
    if (agent._isOwnOp(collection, op)) return;
    agent._sendOp(collection, id, op);
  };
};

Agent.prototype._isOwnOp = function(collection, op) {
  // Detect ops from this client on the same projection. Since the client sent
  // these in, the submit reply will be sufficient and we can silently ignore
  // them in the streams for subscribed documents or queries
  return (this.clientId === op.src) && (collection === (op.i || op.c));
};

Agent.prototype._send = function(msg) {
  // Quietly drop replies if the stream was closed
  if (this.closed) return;

  this.stream.write(msg);
};

Agent.prototype._sendOp = function(collection, id, op) {
  var msg = {
    a: 'op',
    c: collection,
    d: id,
    v: op.v,
    src: op.src,
    seq: op.seq
  };
  if (op.op) msg.op = op.op;
  if (op.create) msg.create = op.create;
  if (op.del) msg.del = true;

  this._send(msg);
};

Agent.prototype._sendOps = function(collection, id, ops) {
  for (var i = 0; i < ops.length; i++) {
    this._sendOp(collection, id, ops[i]);
  }
};

Agent.prototype._reply = function(req, err, msg) {
  if (err) {
    req.error = err;
    this._send(req);
    return;
  }
  if (!msg) msg = {};

  msg.a = req.a;
  if (req.c) msg.c = req.c;
  if (req.d) msg.d = req.d;
  if (req.id) msg.id = req.id;
  if (req.b && !msg.data) msg.b = req.b;

  this._send(msg);
};

// start processing events from the stream. This calls itself recursively.
// Use .close() to drain the pump.
Agent.prototype.pump = function() {
  if (this.closed) return;

  var req = this.stream.read();
  var agent = this;
  if (req == null) {
    // Retry when there's a message waiting for us.
    this.stream.once('readable', function() {
      agent.pump();
    });
    return;
  }
  if (typeof req === 'string') {
    try {
      req = JSON.parse(req);
    } catch(e) {
      console.warn('Client sent invalid JSON', e.stack);
      this.close(e);
    }
  }
  this._handleMessage(req);
  // Clean up the stack then read the next message
  process.nextTick(function() {
    agent.pump();
  });
};

// Check a request to see if its valid. Returns an error if there's a problem.
Agent.prototype._checkRequest = function(req) {
  if (req.a === 'qf' || req.a === 'qs' || req.a === 'qu') {
    // Query messages need an ID property.
    if (typeof req.id !== 'number') return 'Missing query ID';
  } else if (req.a === 'op' || req.a === 'f' || req.a === 's' || req.a === 'u') {
    // Doc-based request.
    if (req.c != null && typeof req.c !== 'string') return 'Invalid collection';
    if (req.d != null && typeof req.d !== 'string') return 'Invalid id';

    if (req.a === 'op') {
      if (req.v != null && (typeof req.v !== 'number' || req.v < 0)) return 'Invalid version';
    }
  } else if (req.a === 'bf' || req.a === 'bs' || req.a === 'bu') {
    // Bulk request
    if (req.c != null && typeof req.c !== 'string') return 'Invalid collection';
    if (typeof req.b !== 'object') return 'Invalid bulk subscribe data';
  }
};

// Handle an incoming message from the client
Agent.prototype._handleMessage = function(req) {
  var agent = this;
  var callback = function(err, message) {
    agent._reply(req, err, message);
  };

  try {
    var errMessage = this._checkRequest(req);
    if (errMessage) return callback({code: 4000, message: errMessage});

    switch (req.a) {
      case 'qf':
        return this._queryFetch(req.id, req.c, req.q, getQueryOptions(req), callback);
      case 'qs':
        return this._querySubscribe(req.id, req.c, req.q, getQueryOptions(req), callback);
      case 'qu':
        return this._queryUnsubscribe(req.id, callback);
      case 'bf':
        return this._fetchBulk(req.c, req.b, callback);
      case 'bs':
        return this._subscribeBulk(req.c, req.b, callback);
      case 'bu':
        return this._unsubscribeBulk(req.c, req.b, callback);
      case 'f':
        return this._fetch(req.c, req.d, req.v, callback);
      case 's':
        return this._subscribe(req.c, req.d, req.v, callback);
      case 'u':
        return this._unsubscribe(req.c, req.d, callback);
      case 'op':
        var op = this._createOp(req);
        return this._submit(req.c, req.d, op, callback);
      default:
        callback({
          code: 4000,
          message: 'Invalid or unknown message'
        });
    }
  } catch (err) {
    callback(err);
  }
};
function getQueryOptions(req) {
  var results = req.r;
  var ids, versions;
  if (results) {
    ids = [];
    versions = (results.length) ? {} : null;
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var id = result[0];
      var version = result[1];
      ids.push(id);
      versions[id] = version;
    }
  }
  return {
    ids: ids,
    versions: versions,
    db: req.db
  };
}

Agent.prototype._queryFetch = function(queryId, collection, query, options, callback) {
  // Fetch the results of a query once
  var agent = this;
  this.backend.queryFetch(this, collection, query, options, function(err, results, extra) {
    if (err) return callback(err);
    var message = {
      id: queryId,
      data: getResultsData(results),
      extra: extra
    };
    callback(null, message);
  });
};

Agent.prototype._querySubscribe = function(queryId, collection, query, options, callback) {
  // Subscribe to a query. The client is sent the query results and its
  // notified whenever there's a change
  var agent = this;
  var wait = 1;
  var message;
  function finish(err) {
    if (err) return callback(err);
    if (--wait) return;
    callback(null, message);
  }
  if (options.versions) {
    wait++;
    this._fetchBulk(collection, options.versions, finish);
  }
  this.backend.querySubscribe(this, collection, query, options, function(err, emitter, results, extra) {
    if (err) return finish(err);
    agent._subscribeToQuery(emitter, queryId, collection, query);
    message = {
      id: queryId,
      data: results && getResultsData(results),
      extra: extra
    };
    finish();
  });
};

function getResultsData(results) {
  var items = [];
  var lastType = null;
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var item = {
      d: result.id,
      v: result.v,
      data: result.data
    };
    if (lastType !== result.type) {
      lastType = item.type = result.type;
    }
    items.push(item);
  }
  return items;
}

Agent.prototype._queryUnsubscribe = function(queryId, callback) {
  var emitter = this.subscribedQueries[queryId];
  if (emitter) {
    emitter.destroy();
    delete this.subscribedQueries[queryId];
  }
  process.nextTick(callback);
};

Agent.prototype._fetch = function(collection, id, version, callback) {
  if (version == null) {
    // Fetch a snapshot
    this.backend.fetch(this, collection, id, function(err, data) {
      if (err) return callback(err);
      callback(null, {data: data});
    });
  } else {
    // It says fetch on the tin, but if a version is specified the client
    // actually wants me to fetch some ops
    var agent = this;
    this.backend.getOps(this, collection, id, version, null, function(err, ops) {
      if (err) return callback(err);
      agent._sendOps(collection, id, ops);
      callback();
    });
  }
};

Agent.prototype._fetchBulk = function(collection, versions, callback) {
  if (Array.isArray(versions)) {
    this.backend.fetchBulk(this, collection, versions, function(err, snapshotMap) {
      if (err) return callback(err);
      callback(null, {data: snapshotMap});
    });
  } else {
    var agent = this;
    this.backend.getOpsBulk(this, collection, versions, null, function(err, opsMap) {
      if (err) return callback(err);
      for (var id in opsMap) {
        var ops = opsMap[id];
        agent._sendOps(collection, id, ops);
      }
      callback();
    });
  }
};

Agent.prototype._subscribe = function(collection, id, version, callback) {
  // If the version is specified, catch the client up by sending all ops
  // since the specified version
  var agent = this;
  this.backend.subscribe(this, collection, id, version, function(err, stream, data) {
    if (err) return callback(err);
    agent._subscribeToStream(collection, id, stream);
    // Snapshot data is returned only when subscribing from a null version.
    // Otherwise, ops will have been pushed into the stream
    if (data) {
      callback(null, {data: data});
    } else {
      callback();
    }
  });
};

Agent.prototype._subscribeBulk = function(collection, versions, callback) {
  var agent = this;
  this.backend.subscribeBulk(this, collection, versions, function(err, streams, snapshotMap) {
    if (err) return callback(err);
    for (var id in streams) {
      agent._subscribeToStream(collection, id, streams[id]);
    }
    if (snapshotMap) {
      callback(null, {data: snapshotMap});
    } else {
      callback();
    }
  });
};

Agent.prototype._unsubscribe = function(collection, id, callback) {
  // Unsubscribe from the specified document. This cancels the active
  // stream or an inflight subscribing state
  var docs = this.subscribedDocs[collection];
  var stream = docs && docs[id];
  if (stream) stream.destroy();
  process.nextTick(callback);
};

Agent.prototype._unsubscribeBulk = function(collection, ids, callback) {
  var docs = this.subscribedDocs[collection];
  if (!docs) return process.nextTick(callback);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var stream = docs[id];
    if (stream) stream.destroy();
  }
  process.nextTick(callback);
};

Agent.prototype._submit = function(collection, id, op, callback) {
  var agent = this;
  this.backend.submit(this, collection, id, op, function(err, ops) {
    // Message to acknowledge the op was successfully submitted
    var ack = {src: op.src, seq: op.seq, v: op.v};
    if (err) {
      // Occassional 'Op already submitted' errors are expected to happen as
      // part of normal operation, since inflight ops need to be resent after
      // disconnect. In this case, ack the op so the client can proceed
      if (err.code === 4001) return callback(null, ack);
      return callback(err);
    }

    // Reply with any operations that the client is missing.
    agent._sendOps(collection, id, ops);
    callback(null, ack);
  });
};

function CreateOp(src, seq, v, create) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.create = create;
  this.m = null;
}
function EditOp(src, seq, v, op) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.op = op;
  this.m = null;
}
function DeleteOp(src, seq, v, del) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.del = del;
  this.m = null;
}
// Normalize the properties submitted
Agent.prototype._createOp = function(req) {
  // src can be provided if it is not the same as the current agent,
  // such as a resubmission after a reconnect, but it usually isn't needed
  var src = req.src || this.clientId;
  if (req.op) {
    return new EditOp(src, req.seq, req.v, req.op);
  } else if (req.create) {
    return new CreateOp(src, req.seq, req.v, req.create);
  } else if (req.del) {
    return new DeleteOp(src, req.seq, req.v, req.del);
  }
};
