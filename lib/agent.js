var hat = require('hat');
var ShareDBError = require('./error');
var logger = require('./logger');
var ACTIONS = require('./message-actions').ACTIONS;
var types = require('./types');
var util = require('./util');
var protocol = require('./protocol');
var DocPresence = require('./client/presence/doc-presence');

var ERROR_CODE = ShareDBError.CODES;

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
  this.backend = backend;
  this.stream = stream;

  this.clientId = hat();
  // src is a client-configurable "id" which the client will set in its handshake,
  // and attach to its ops. This should take precedence over clientId if set.
  // Only legacy clients, or new clients connecting for the first time will use the
  // Agent-provided clientId.
  this.src = null;
  this.connectTime = Date.now();

  // We need to track which documents are subscribed by the client. This is a
  // map of collection -> id -> stream
  this.subscribedDocs = Object.create(null);

  // Map from queryId -> emitter
  this.subscribedQueries = Object.create(null);

  // Track which documents are subscribed to presence by the client. This is a
  // map of channel -> stream
  this.subscribedPresences = Object.create(null);
  // Highest seq received for a subscription request. Any seq lower than this
  // value is stale, and should be ignored. Used for keeping the subscription
  // state in sync with the client's desired state. Map of channel -> seq
  this.presenceSubscriptionSeq = Object.create(null);
  // Keep track of the last request that has been sent by each local presence
  // belonging to this agent. This is used to generate a new disconnection
  // request if the client disconnects ungracefully, and a presence that's
  // been replaced here by a request no longer in flight by the time it would
  // be published isn't sent. This is a map of channel -> id -> request
  this.presenceRequests = Object.create(null);
  // Keep track of the latest known Doc version, so that we can avoid fetching
  // ops to transform presence if not needed
  this.latestDocVersionStreams = Object.create(null);
  this.latestDocVersions = Object.create(null);

  // Every doc, doc version and presence stream this agent holds, so that
  // _cleanup() destroys them even if they've gone missing from their own map.
  // Map of key -> stream
  this._streams = Object.create(null);
  this._nextStreamKey = 1;
  // Presence broadcasts still in their doc version lookup, receivePresence
  // middleware or transform. _retractPresences() flags them to go out as a
  // leave if they're still in middleware, or to be dropped if they're being
  // transformed. A leave from the client that gets through middleware flags
  // its own older ones to be dropped, unless one of them is restored to
  // presenceRequests while it's still being transformed. Each one being
  // transformed holds the request it restores to presenceRequests if it's
  // rejected. Any presence that gets through middleware while a leave with
  // its ID is being transformed waits until that leave has been handed to
  // pubsub or rejected, since subscribers ignore a re-created presence's lower
  // presence version until they've seen the leave
  this._pendingPresenceBroadcasts = [];

  // We need to track this manually to make sure we don't reply to messages
  // after the stream was closed.
  this.closed = false;

  // For custom use in middleware. The agent is a convenient place to cache
  // session state in memory. It is in memory only as long as the session is
  // active, and it is passed to each middleware call
  this.custom = Object.create(null);

  this.protocol = Object.create(null);

  // The first message received over the connection. Stored to warn if messages
  // are being sent before the handshake.
  this._firstReceivedMessage = null;
  this._handshakeReceived = false;

  // Send the legacy message to initialize old clients with the random agent Id
  this.send(this._initMessage(ACTIONS.initLegacy));
}
module.exports = Agent;

// Close the agent with the client.
Agent.prototype.close = function(err) {
  if (err) {
    logger.warn('Agent closed due to error', this._src(), err.stack || err);
  }
  if (this.closed) return;
  // This will end the writable stream and emit 'finish'
  this.stream.end();
};

Agent.prototype._cleanup = function() {
  // Only clean up once if the stream emits both 'end' and 'close'.
  if (this.closed) return;

  this.closed = true;

  this.backend.agentsCount--;
  if (!this.stream.isServer) this.backend.remoteAgentsCount--;

  for (var channel in this.presenceRequests) {
    this._retractPresences(channel);
  }

  for (var key in this._streams) {
    this._streams[key].destroy();
  }
  this.subscribedDocs = Object.create(null);
  this.subscribedPresences = Object.create(null);
  this.latestDocVersionStreams = Object.create(null);

  // Clean up query subscription streams
  for (var id in this.subscribedQueries) {
    var emitter = this.subscribedQueries[id];
    emitter.destroy();
  }
  this.subscribedQueries = Object.create(null);
};

Agent.prototype._trackStream = function(stream) {
  if (stream.open === false) return;
  var streams = this._streams;
  var key = this._nextStreamKey++;
  streams[key] = stream;
  stream.once('close', function() {
    delete streams[key];
  });
};

/**
 * Passes operation data received on stream to the agent stream via
 * _sendOp()
 */
Agent.prototype._subscribeToStream = function(collection, id, stream) {
  var agent = this;
  this._subscribeMapToStream(this.subscribedDocs, collection, id, stream, function(data) {
    if (data.error) {
      // Log then silently ignore errors in a subscription stream, since these
      // may not be the client's fault, and they were not the result of a
      // direct request by the client
      logger.error('Doc subscription stream error', collection, id, data.error);
      return;
    }
    agent._onOp(collection, id, data);
  });
};

Agent.prototype._subscribeMapToStream = function(map, collection, id, stream, dataHandler) {
  if (this.closed) return stream.destroy();
  this._trackStream(stream);

  var streams = map[collection] || (map[collection] = Object.create(null));

  // If already subscribed to this document, destroy the previously subscribed stream
  var previous = streams[id];
  if (previous) previous.destroy();
  streams[id] = stream;

  stream.on('data', dataHandler);
  stream.on('end', function() {
    // The op stream is done sending, so release its reference
    var streams = map[collection];
    if (!streams || streams[id] !== stream) return;
    delete streams[id];
    if (util.hasKeys(streams)) return;
    delete map[collection];
  });
};

Agent.prototype._subscribeToPresenceStream = function(channel, stream) {
  if (this.closed) return stream.destroy();
  this._trackStream(stream);
  var agent = this;

  var previous = this.subscribedPresences[channel];
  if (previous) previous.destroy();
  this.subscribedPresences[channel] = stream;

  stream.on('data', function(data) {
    if (data.error) {
      logger.error('Presence subscription stream error', channel, data.error);
    }
    agent._handlePresenceData(data);
  });

  stream.on('end', function() {
    if (agent.subscribedPresences[channel] === stream) {
      delete agent.subscribedPresences[channel];
    }
  });
};

Agent.prototype._retractPresences = function(channel) {
  var pendingBroadcasts = this._pendingPresenceBroadcasts;
  for (var i = 0; i < pendingBroadcasts.length; i++) {
    if (pendingBroadcasts[i].channel === channel) pendingBroadcasts[i].retracted = true;
  }

  var requests = this.presenceRequests[channel];
  for (var id in requests) {
    var request = requests[id];
    var alreadyLeft = request.p === null;
    if (alreadyLeft) this._unsubscribeDocVersion(request.c, request.d, function() {});
    else this._broadcastLeave(request);
  }
  delete this.presenceRequests[channel];
};

Agent.prototype._broadcastLeave = function(presence, callback) {
  var agent = this;
  presence.p = null;
  this._broadcastPresence(presence, [], false, function(error, result) {
    if (error) logger.error('Error broadcasting disconnect presence', presence.ch, presence.id, agent._src(), error);
    if (callback) callback(error, result);
  });
};

Agent.prototype._subscribeToQuery = function(emitter, queryId, collection, query) {
  var previous = this.subscribedQueries[queryId];
  if (previous) previous.destroy();
  this.subscribedQueries[queryId] = emitter;

  var agent = this;
  emitter.onExtra = function(extra) {
    agent.send({a: ACTIONS.queryUpdate, id: queryId, extra: extra});
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
    agent.send({a: ACTIONS.queryUpdate, id: queryId, diff: diff});
  };

  emitter.onError = function(err) {
    // Log then silently ignore errors in a subscription stream, since these
    // may not be the client's fault, and they were not the result of a
    // direct request by the client
    logger.error('Query subscription stream error', collection, query, err);
  };

  emitter.onOp = function(op) {
    var id = op.d;
    agent._onOp(collection, id, op);
  };

  emitter._open();
};

Agent.prototype._onOp = function(collection, id, op) {
  if (this._isOwnOp(collection, op)) return;
  if (this._isOpFromCollidingChannel(collection, id, op)) return;

  // Ops emitted here are coming directly from pubsub, which emits the same op
  // object to listeners without making a copy. The pattern in middleware is to
  // manipulate the passed in object, and projections are implemented the same
  // way currently.
  //
  // Deep copying the op would be safest, but deep copies are very expensive,
  // especially over arbitrary objects. This function makes a shallow copy of an
  // op, and it requires that projections and any user middleware copy deep
  // properties as needed when they modify the op.
  //
  // Polling of query subscriptions is determined by the same op objects. As a
  // precaution against op middleware breaking query subscriptions, we delay
  // before calling into projection and middleware code
  var agent = this;
  util.nextTick(function() {
    var copy = shallowCopy(op);
    agent.backend.sanitizeOp(agent, collection, id, copy, function(err) {
      if (err) {
        logger.error('Error sanitizing op emitted from subscription', collection, id, copy, err);
        return;
      }
      agent._sendOp(collection, id, copy);
    });
  });
};

Agent.prototype._isOwnOp = function(collection, op) {
  // Detect ops from this client on the same projection. Since the client sent
  // these in, the submit reply will be sufficient and we can silently ignore
  // them in the streams for subscribed documents or queries
  return (this._src() === op.src) && (collection === (op.i || op.c));
};

Agent.prototype._isOpFromCollidingChannel = function(collection, id, op) {
  var projection = this.backend.projections[collection];
  var target = (projection) ? projection.target : collection;
  return op.c !== target || op.d !== id;
};

Agent.prototype.send = function(message) {
  // Quietly drop replies if the stream was closed
  if (this.closed) return;

  this.backend.emit('send', this, message);
  this.stream.write(message);
};

Agent.prototype._sendOp = function(collection, id, op) {
  var message = {
    a: ACTIONS.op,
    c: collection,
    d: id,
    v: op.v,
    src: op.src,
    seq: op.seq
  };
  if ('op' in op) message.op = op.op;
  if (op.create) message.create = op.create;
  if (op.del) message.del = true;

  this.send(message);
};
Agent.prototype._sendOps = function(collection, id, ops) {
  for (var i = 0; i < ops.length; i++) {
    this._sendOp(collection, id, ops[i]);
  }
};
Agent.prototype._sendOpsBulk = function(collection, opsMap) {
  for (var id in opsMap) {
    var ops = opsMap[id];
    this._sendOps(collection, id, ops);
  }
};

function getReplyErrorObject(err) {
  if (typeof err === 'string') {
    return {
      code: ERROR_CODE.ERR_UNKNOWN_ERROR,
      message: err
    };
  } else {
    if (err.stack) {
      logger.info(err.stack);
    }
    return {
      code: err.code,
      message: err.message
    };
  }
}

Agent.prototype._reply = function(request, err, message) {
  var agent = this;
  var backend = agent.backend;
  if (err) {
    request.error = getReplyErrorObject(err);
    agent.send(request);
    return;
  }
  if (!message) message = {};

  message.a = request.a;
  if (request.id) {
    message.id = request.id;
  } else {
    if (request.c) message.c = request.c;
    if (request.d) message.d = request.d;
    if (request.b && !message.data) message.b = request.b;
  }

  var middlewareContext = {request: request, reply: message};
  backend.trigger(backend.MIDDLEWARE_ACTIONS.reply, agent, middlewareContext, function(err) {
    if (err) {
      request.error = getReplyErrorObject(err);
      agent.send(request);
    } else {
      agent.send(middlewareContext.reply);
    }
  });
};

// Start processing events from the stream
Agent.prototype._open = function() {
  if (this.closed) return;
  this.backend.agentsCount++;
  if (!this.stream.isServer) this.backend.remoteAgentsCount++;

  var agent = this;
  this.stream.on('data', function(chunk) {
    if (agent.closed) return;

    if (typeof chunk !== 'object') {
      var err = new ShareDBError(ERROR_CODE.ERR_MESSAGE_BADLY_FORMED, 'Received non-object message');
      return agent.close(err);
    }

    var request = {data: chunk};
    agent.backend.trigger(agent.backend.MIDDLEWARE_ACTIONS.receive, agent, request, function(err) {
      var callback = function(err, message) {
        agent._reply(request.data, err, message);
      };
      if (err) return callback(err);
      agent._handleMessage(request.data, callback);
    });
  });

  var cleanup = agent._cleanup.bind(agent);
  this.stream.on('end', cleanup);
  this.stream.on('close', cleanup);
};

function isInvalidName(name) {
  return typeof name !== 'string' || util.isDangerousProperty(name);
}

function isInvalidVersion(version) {
  return version != null && (typeof version !== 'number' || version < 0);
}

function isInvalidProtocol(value) {
  return value != null && typeof value !== 'number' && typeof value !== 'string';
}

function checkBulkData(data) {
  if (!data || typeof data !== 'object') return 'Invalid bulk subscribe data';
  if (Array.isArray(data)) {
    if (data.some(isInvalidName)) return 'Invalid id';
    return;
  }
  for (var id in data) {
    if (isInvalidName(id)) return 'Invalid id';
    if (isInvalidVersion(data[id])) return 'Invalid version';
  }
}

function checkQueryResults(results) {
  if (!Array.isArray(results)) return 'Invalid query results';
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    if (!Array.isArray(result)) return 'Invalid query results';
    var id = result[0];
    var version = result[1];
    if (isInvalidName(id)) return 'Invalid id';
    if (isInvalidVersion(version)) return 'Invalid version';
  }
}

// Check a request to see if its valid. Returns an error if there's a problem.
Agent.prototype._checkRequest = function(request) {
  if (
    request.a === ACTIONS.queryFetch ||
    request.a === ACTIONS.querySubscribe ||
    request.a === ACTIONS.queryUnsubscribe
  ) {
    // Query messages need an ID property.
    if (typeof request.id !== 'number') return 'Missing query ID';
    if (request.r != null) {
      var resultsError = checkQueryResults(request.r);
      if (resultsError) return resultsError;
    }
  } else if (request.a === ACTIONS.op ||
      request.a === ACTIONS.fetch ||
      request.a === ACTIONS.subscribe ||
      request.a === ACTIONS.unsubscribe ||
      request.a === ACTIONS.snapshotFetch ||
      request.a === ACTIONS.snapshotFetchByTimestamp ||
      request.a === ACTIONS.presence) {
    // Doc-based request.
    if (request.d != null && isInvalidName(request.d)) return 'Invalid id';

    if (request.a === ACTIONS.snapshotFetch || request.a === ACTIONS.snapshotFetchByTimestamp) {
      if (request.c == null) return 'Invalid collection';
      if (request.d == null) return 'Invalid id';
    }

    if (isInvalidVersion(request.v)) return 'Invalid version';
    if (request.ts != null && typeof request.ts !== 'number') return 'Invalid timestamp';

    if (request.a === ACTIONS.op || request.a === ACTIONS.presence) {
      if (request.v != null && !util.isInteger(request.v)) return 'Invalid version';
    }

    if (request.a === ACTIONS.presence) {
      if (isInvalidName(request.id)) return 'Invalid presence ID';
      if (isInvalidVersion(request.pv)) return 'Invalid presence version';
      if (isDocPresence(request) && request.v == null) return 'Invalid version';
    }
  } else if (
    request.a === ACTIONS.bulkFetch ||
    request.a === ACTIONS.bulkSubscribe ||
    request.a === ACTIONS.bulkUnsubscribe
  ) {
    // Bulk request
    var bulkError = checkBulkData(request.b);
    if (bulkError) return bulkError;
  } else if (request.a === ACTIONS.handshake) {
    if (isInvalidProtocol(request.protocol) || isInvalidProtocol(request.protocolMinor)) return 'Invalid protocol';
  }
  if (request.c != null && isInvalidName(request.c)) return 'Invalid collection';
  if (request.ch != null && isInvalidName(request.ch)) return 'Invalid presence channel';
  if (request.seq != null && typeof request.seq !== 'number') return 'Invalid seq';
  if (request.a === ACTIONS.presence && isDocPresence(request) && !matchesDocPresenceChannel(request)) {
    return 'Presence collection and doc ID do not match channel';
  }
};

function isDocPresence(request) {
  return request.c != null || request.d != null;
}

function matchesDocPresenceChannel(request) {
  return !!request.c && !!request.d && request.ch === DocPresence.channel(request.c, request.d);
}

// Handle an incoming message from the client
Agent.prototype._handleMessage = function(request, callback) {
  try {
    var errMessage = this._checkRequest(request);
    if (errMessage) return callback(new ShareDBError(ERROR_CODE.ERR_MESSAGE_BADLY_FORMED, errMessage));
    this._checkFirstMessage(request);

    switch (request.a) {
      case ACTIONS.handshake:
        if (request.id) this.src = request.id;
        this._setProtocol(request);
        return callback(null, this._initMessage(ACTIONS.handshake));
      case ACTIONS.queryFetch:
        return this._queryFetch(request.id, request.c, request.q, getQueryOptions(request), callback);
      case ACTIONS.querySubscribe:
        return this._querySubscribe(request.id, request.c, request.q, getQueryOptions(request), callback);
      case ACTIONS.queryUnsubscribe:
        return this._queryUnsubscribe(request.id, callback);
      case ACTIONS.bulkFetch:
        return this._fetchBulk(request.c, request.b, callback);
      case ACTIONS.bulkSubscribe:
        return this._subscribeBulk(request.c, request.b, callback);
      case ACTIONS.bulkUnsubscribe:
        return this._unsubscribeBulk(request.c, request.b, callback);
      case ACTIONS.fetch:
        return this._fetch(request.c, request.d, request.v, callback);
      case ACTIONS.subscribe:
        return this._subscribe(request.c, request.d, request.v, callback);
      case ACTIONS.unsubscribe:
        return this._unsubscribe(request.c, request.d, callback);
      case ACTIONS.op:
        // Normalize the properties submitted
        var op = createClientOp(request, this._src());
        if (op.seq >= util.MAX_SAFE_INTEGER) {
          return callback(new ShareDBError(
            ERROR_CODE.ERR_CONNECTION_SEQ_INTEGER_OVERFLOW,
            'Connection seq has exceeded the max safe integer, maybe from being open for too long'
          ));
        }
        if (!op) return callback(new ShareDBError(ERROR_CODE.ERR_MESSAGE_BADLY_FORMED, 'Invalid op message'));
        return this._submit(request.c, request.d, op, callback);
      case ACTIONS.snapshotFetch:
        return this._fetchSnapshot(request.c, request.d, request.v, callback);
      case ACTIONS.snapshotFetchByTimestamp:
        return this._fetchSnapshotByTimestamp(request.c, request.d, request.ts, callback);
      case ACTIONS.presence:
        if (!this.backend.presenceEnabled) return;
        var presence = this._createPresence(request);
        if (presence.t && !util.supportsPresence(types.map[presence.t])) {
          return callback({
            code: ERROR_CODE.ERR_TYPE_DOES_NOT_SUPPORT_PRESENCE,
            message: 'Type does not support presence: ' + presence.t
          });
        }
        var olderBroadcasts = presence.p === null ? this._olderPendingPresenceBroadcasts(presence) : [];
        return this._broadcastPresence(presence, olderBroadcasts, true, callback);
      case ACTIONS.presenceSubscribe:
        if (!this.backend.presenceEnabled) return;
        return this._subscribePresence(request.ch, request.seq, callback);
      case ACTIONS.presenceUnsubscribe:
        return this._unsubscribePresence(request.ch, request.seq, callback);
      case ACTIONS.presenceRequest:
        return this._requestPresence(request.ch, callback);
      case ACTIONS.pingPong:
        return this._pingPong(callback);
      default:
        callback(new ShareDBError(ERROR_CODE.ERR_MESSAGE_BADLY_FORMED, 'Invalid or unknown message'));
    }
  } catch (err) {
    callback(err);
  }
};
function getQueryOptions(request) {
  var results = request.r;
  var ids;
  var fetch;
  var fetchOps;
  if (results) {
    ids = [];
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var id = result[0];
      var version = result[1];
      ids.push(id);
      if (version == null) {
        if (fetch) {
          fetch.push(id);
        } else {
          fetch = [id];
        }
      } else {
        if (!fetchOps) fetchOps = Object.create(null);
        fetchOps[id] = version;
      }
    }
  }
  var options = request.o || {};
  delete options.pollInterval;
  delete options.pollDebounce;
  options.ids = ids;
  options.fetch = fetch;
  options.fetchOps = fetchOps;
  return options;
}

Agent.prototype._queryFetch = function(queryId, collection, query, options, callback) {
  // Fetch the results of a query once
  this.backend.queryFetch(this, collection, query, options, function(err, results, extra) {
    if (err) return callback(err);
    var message = {
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
  if (options.fetch) {
    wait++;
    this.backend.fetchBulk(this, collection, options.fetch, function(err, snapshotMap) {
      if (err) return finish(err);
      message = getMapResult(snapshotMap);
      finish();
    });
  }
  if (options.fetchOps) {
    wait++;
    this._fetchBulkOps(collection, options.fetchOps, finish);
  }
  this.backend.querySubscribe(this, collection, query, options, function(err, emitter, results, extra) {
    if (err) return finish(err);
    if (agent.closed) return emitter.destroy();

    agent._subscribeToQuery(emitter, queryId, collection, query);
    // No results are returned when ids are passed in as an option. Instead,
    // want to re-poll the entire query once we've established listeners to
    // emit any diff in results
    if (!results) {
      emitter.queryPoll(finish);
      return;
    }
    message = {
      data: getResultsData(results),
      extra: extra
    };
    finish();
  });
};

Agent.prototype._pingPong = function(callback) {
  var error = null;
  var message = {
    a: ACTIONS.pingPong
  };
  callback(error, message);
};

function getResultsData(results) {
  var items = [];
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var item = getSnapshotData(result);
    item.d = result.id;
    items.push(item);
  }
  return items;
}

function getMapResult(snapshotMap) {
  var data = Object.create(null);
  for (var id in snapshotMap) {
    var mapValue = snapshotMap[id];
    // fetchBulk / subscribeBulk map data can have either a Snapshot or an object
    // `{error: Error | string}` as a value.
    if (mapValue.error) {
      // Transform errors to serialization-friendly objects.
      data[id] = {error: getReplyErrorObject(mapValue.error)};
    } else {
      data[id] = getSnapshotData(mapValue);
    }
  }
  return {data: data};
}

function getSnapshotData(snapshot) {
  var data = {
    v: snapshot.v,
    data: snapshot.data
  };
  if (types.defaultType !== types.map[snapshot.type]) {
    data.type = snapshot.type;
  }
  return data;
}

Agent.prototype._queryUnsubscribe = function(queryId, callback) {
  var emitter = this.subscribedQueries[queryId];
  if (emitter) {
    emitter.destroy();
    delete this.subscribedQueries[queryId];
  }
  util.nextTick(callback);
};

Agent.prototype._fetch = function(collection, id, version, callback) {
  if (version == null) {
    // Fetch a snapshot
    this.backend.fetch(this, collection, id, function(err, snapshot) {
      if (err) return callback(err);
      callback(null, {data: getSnapshotData(snapshot)});
    });
  } else {
    // It says fetch on the tin, but if a version is specified the client
    // actually wants me to fetch some ops
    this._fetchOps(collection, id, version, callback);
  }
};

Agent.prototype._fetchOps = function(collection, id, version, callback) {
  var agent = this;
  this.backend.getOps(this, collection, id, version, null, function(err, ops) {
    if (err) return callback(err);
    agent._sendOps(collection, id, ops);
    callback();
  });
};

Agent.prototype._fetchBulk = function(collection, versions, callback) {
  if (Array.isArray(versions)) {
    this.backend.fetchBulk(this, collection, versions, function(err, snapshotMap) {
      if (err) {
        return callback(err);
      }
      if (snapshotMap) {
        var result = getMapResult(snapshotMap);
        callback(null, result);
      } else {
        callback();
      }
    });
  } else {
    this._fetchBulkOps(collection, versions, callback);
  }
};

Agent.prototype._fetchBulkOps = function(collection, versions, callback) {
  var agent = this;
  this.backend.getOpsBulk(this, collection, versions, null, function(err, opsMap) {
    if (err) return callback(err);
    agent._sendOpsBulk(collection, opsMap);
    callback();
  });
};

Agent.prototype._subscribe = function(collection, id, version, callback) {
  // If the version is specified, catch the client up by sending all ops
  // since the specified version
  var agent = this;
  this.backend.subscribe(this, collection, id, version, function(err, stream, snapshot, ops) {
    if (err) return callback(err);
    // If we're subscribing from a known version, send any ops committed since
    // the requested version to bring the client's doc up to date
    if (ops) {
      agent._sendOps(collection, id, ops);
    }
    // In addition, ops may already be queued on the stream by pubsub.
    // Subscribe is called before the ops or snapshot are fetched, so it is
    // possible that some ops may be duplicates. Clients should ignore any
    // duplicate ops they may receive. This will flush ops already queued and
    // subscribe to ongoing ops from the stream
    agent._subscribeToStream(collection, id, stream);
    // Snapshot is returned only when subscribing from a null version.
    // Otherwise, ops will have been pushed into the stream
    if (snapshot) {
      callback(null, {data: getSnapshotData(snapshot)});
    } else {
      callback();
    }
  });
};

Agent.prototype._subscribeBulk = function(collection, versions, callback) {
  // See _subscribe() above. This function's logic should match but in bulk
  var agent = this;
  this.backend.subscribeBulk(this, collection, versions, function(err, streams, snapshotMap, opsMap) {
    if (err) {
      return callback(err);
    }
    if (opsMap) {
      agent._sendOpsBulk(collection, opsMap);
    }
    for (var id in streams) {
      agent._subscribeToStream(collection, id, streams[id]);
    }
    if (snapshotMap) {
      var result = getMapResult(snapshotMap);
      callback(null, result);
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
  util.nextTick(callback);
};

Agent.prototype._unsubscribeBulk = function(collection, ids, callback) {
  var docs = this.subscribedDocs[collection];
  if (!docs) return util.nextTick(callback);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var stream = docs[id];
    if (stream) stream.destroy();
  }
  util.nextTick(callback);
};

Agent.prototype._submit = function(collection, id, op, callback) {
  var agent = this;
  this.backend.submit(this, collection, id, op, null, function(err, ops, request) {
    // Message to acknowledge the op was successfully submitted
    var ack = {src: op.src, seq: op.seq, v: op.v};
    if (request._fixupOps.length) ack[ACTIONS.fixup] = request._fixupOps;
    if (err) {
      // Occasional 'Op already submitted' errors are expected to happen as
      // part of normal operation, since inflight ops need to be resent after
      // disconnect. In this case, ack the op so the client can proceed
      if (err.code === ERROR_CODE.ERR_OP_ALREADY_SUBMITTED) return callback(null, ack);
      return callback(err);
    }

    // Reply with any operations that the client is missing.
    agent._sendOps(collection, id, ops);
    callback(null, ack);
  });
};

Agent.prototype._fetchSnapshot = function(collection, id, version, callback) {
  this.backend.fetchSnapshot(this, collection, id, version, callback);
};

Agent.prototype._fetchSnapshotByTimestamp = function(collection, id, timestamp, callback) {
  this.backend.fetchSnapshotByTimestamp(this, collection, id, timestamp, callback);
};

Agent.prototype._initMessage = function(action) {
  return {
    a: action,
    protocol: protocol.major,
    protocolMinor: protocol.minor,
    id: this._src(),
    type: types.defaultType.uri
  };
};

Agent.prototype._src = function() {
  return this.src || this.clientId;
};

Agent.prototype._broadcastPresence = function(presence, supersededBroadcasts, fromClient, callback) {
  var agent = this;
  var backend = this.backend;
  var pendingBroadcast = this._addPendingPresenceBroadcast(presence);
  var leaving = pendingBroadcast.leaving;
  var context = {
    presence: presence,
    collection: presence.c
  };
  var start = Date.now();
  var docVersionBeforeUpdate = util.dig(this.latestDocVersions, presence.c, presence.d);

  var subscriptionUpdater = leaving ?
    this._unsubscribeDocVersion.bind(this) :
    this._subscribeDocVersion.bind(this);

  subscriptionUpdater(presence.c, presence.d, function(error) {
    if (error) {
      agent._removePendingPresenceBroadcast(pendingBroadcast);
      return callback(error);
    }
    backend.trigger(backend.MIDDLEWARE_ACTIONS.receivePresence, agent, context, function(error) {
      if (error) {
        agent._removePendingPresenceBroadcast(pendingBroadcast);
        return callback(error);
      }
      for (var i = 0; i < supersededBroadcasts.length; i++) {
        supersededBroadcasts[i].superseded = true;
      }
      if (pendingBroadcast.superseded && !leaving) {
        agent._removePendingPresenceBroadcast(pendingBroadcast);
        return agent._unsubscribeDocVersion(presence.c, presence.d, function() {
          callback(null, presence);
        });
      }
      var clientHasLeft = agent.closed || pendingBroadcast.retracted;
      if (clientHasLeft && !leaving) {
        agent._removePendingPresenceBroadcast(pendingBroadcast);
        return agent._broadcastLeave(presence, callback);
      }
      var requests = agent.presenceRequests[presence.ch] || (agent.presenceRequests[presence.ch] = Object.create(null));
      var previousRequest = requests[presence.id];
      if (!previousRequest || previousRequest.p === null || previousRequest.pv < presence.pv) {
        requests[presence.id] = presence;
      }
      pendingBroadcast.fallbackRequest = previousRequest;
      pendingBroadcast.transforming = true;

      agent._waitForTransformingLeaves(pendingBroadcast, function() {
        var latestDocVersion = util.dig(agent.latestDocVersions, presence.c, presence.d);
        if (latestDocVersion == null) latestDocVersion = docVersionBeforeUpdate;

        var checkReadAccess = fromClient && leaving;
        backend._transformPresenceToLatestVersion(agent, presence, latestDocVersion, checkReadAccess, onTransformed);
      });

      function onTransformed(error, latestPresence) {
        agent._removePendingPresenceBroadcast(pendingBroadcast);
        if (error) {
          agent._rejectPresenceTransform(requests, pendingBroadcast);
          releaseWaiters(pendingBroadcast);
          return callback(error);
        }
        var overtakenByLeave = pendingBroadcast.superseded || pendingBroadcast.retracted;
        if (overtakenByLeave && !leaving) return callback(null, latestPresence);
        var reCreatedSinceLeaving = leaving && agent._isPresenceRequestInFlight(requests[presence.id]);
        if (!reCreatedSinceLeaving) cacheNewerPresenceRequest(requests, presence);
        agent._raiseTransformingPresenceFallbacks(presence);
        var cachedRequest = util.dig(agent.presenceRequests, presence.ch, presence.id);
        var replacedBySettledRequest = cachedRequest !== presence && !agent._isPresenceRequestInFlight(cachedRequest);
        if (replacedBySettledRequest && !leaving) return callback(null, latestPresence);
        var channel = agent._getPresenceChannel(latestPresence.ch);
        agent.backend.pubsub.publish([channel], latestPresence, function(error) {
          if (error) return callback(error);
          backend.emit('timing', 'presence.broadcast', Date.now() - start, context);
          callback(null, latestPresence);
        });
        releaseWaiters(pendingBroadcast);
      }
    });
  });
};

Agent.prototype._addPendingPresenceBroadcast = function(presence) {
  var broadcast = {
    channel: presence.ch,
    id: presence.id,
    pv: presence.pv,
    leaving: presence.p === null,
    request: presence,
    fallbackRequest: null,
    transforming: false,
    retracted: false,
    superseded: false,
    waiters: []
  };
  this._pendingPresenceBroadcasts.push(broadcast);
  return broadcast;
};

Agent.prototype._removePendingPresenceBroadcast = function(broadcast) {
  var index = this._pendingPresenceBroadcasts.indexOf(broadcast);
  if (index !== -1) this._pendingPresenceBroadcasts.splice(index, 1);
};

Agent.prototype._olderPendingPresenceBroadcasts = function(presence) {
  var olderBroadcasts = [];
  var pendingBroadcasts = this._pendingPresenceBroadcasts;
  for (var i = 0; i < pendingBroadcasts.length; i++) {
    var broadcast = pendingBroadcasts[i];
    if (isBroadcastOf(broadcast, presence) && broadcast.pv < presence.pv) olderBroadcasts.push(broadcast);
  }
  return olderBroadcasts;
};

Agent.prototype._transformingPresenceBroadcasts = function(presence) {
  return this._pendingPresenceBroadcasts.filter(function(broadcast) {
    return broadcast.transforming && isBroadcastOf(broadcast, presence);
  });
};

Agent.prototype._raiseTransformingPresenceFallbacks = function(acceptedRequest) {
  var broadcasts = this._transformingPresenceBroadcasts(acceptedRequest);
  for (var i = 0; i < broadcasts.length; i++) {
    var fallbackRequest = broadcasts[i].fallbackRequest;
    var fallbackIsOlder = !fallbackRequest || fallbackRequest.pv < acceptedRequest.pv;
    if (broadcasts[i].pv > acceptedRequest.pv && fallbackIsOlder) {
      broadcasts[i].fallbackRequest = acceptedRequest;
    }
  }
};

Agent.prototype._rejectPresenceTransform = function(requests, rejectedBroadcast) {
  var rejectedRequest = rejectedBroadcast.request;
  var fallbackRequest = rejectedBroadcast.fallbackRequest;
  var broadcasts = this._pendingPresenceBroadcasts;
  for (var i = 0; i < broadcasts.length; i++) {
    if (broadcasts[i].fallbackRequest === rejectedRequest) broadcasts[i].fallbackRequest = fallbackRequest;
  }
  var previousRequest = fallbackRequest || this._newestTransformingPresenceRequest(rejectedRequest);
  this._withdrawPresenceRequest(requests, rejectedRequest, previousRequest);
};

Agent.prototype._withdrawPresenceRequest = function(requests, presence, previousRequest) {
  if (requests[presence.id] !== presence) return;
  if (previousRequest) this._restorePresenceRequest(requests, previousRequest);
  else presence.p = null;
};

Agent.prototype._restorePresenceRequest = function(requests, request) {
  requests[request.id] = request;
  var broadcasts = this._pendingPresenceBroadcasts;
  for (var i = 0; i < broadcasts.length; i++) {
    if (broadcasts[i].request === request) broadcasts[i].superseded = false;
  }
};

Agent.prototype._newestTransformingPresenceRequest = function(presence) {
  var newestBroadcast;
  var broadcasts = this._transformingPresenceBroadcasts(presence);
  for (var i = 0; i < broadcasts.length; i++) {
    if (!newestBroadcast || newestBroadcast.pv < broadcasts[i].pv) newestBroadcast = broadcasts[i];
  }
  return newestBroadcast && newestBroadcast.request;
};

Agent.prototype._isPresenceRequestInFlight = function(request) {
  var broadcasts = this._pendingPresenceBroadcasts;
  for (var i = 0; i < broadcasts.length; i++) {
    if (broadcasts[i].request === request) return true;
  }
  return false;
};

Agent.prototype._waitForTransformingLeaves = function(pendingBroadcast, callback) {
  var leaves = this._transformingPresenceBroadcasts(pendingBroadcast.request).filter(function(broadcast) {
    return broadcast.leaving && broadcast !== pendingBroadcast;
  });
  var remaining = leaves.length;
  if (!remaining) return callback();
  for (var i = 0; i < leaves.length; i++) {
    leaves[i].waiters.push(function() {
      if (--remaining === 0) callback();
    });
  }
};

function releaseWaiters(leave) {
  for (var i = 0; i < leave.waiters.length; i++) leave.waiters[i]();
}

function cacheNewerPresenceRequest(requests, request) {
  var cachedRequest = requests[request.id];
  if (!cachedRequest || cachedRequest.pv < request.pv) requests[request.id] = request;
}

function isBroadcastOf(broadcast, presence) {
  return broadcast.channel === presence.ch && broadcast.id === presence.id;
}

Agent.prototype._subscribeDocVersion = function(collection, id, callback) {
  if (!collection || !id) return callback();

  var latestDocVersions = this.latestDocVersions;
  var isSubscribed = util.dig(latestDocVersions, collection, id) !== undefined;
  if (isSubscribed) return callback();

  var agent = this;
  this.backend.subscribe(this, collection, id, null, function(error, stream, snapshot) {
    if (error) return callback(error);

    var versions = latestDocVersions[collection] || (latestDocVersions[collection] = Object.create(null));
    versions[id] = snapshot.v;

    agent._subscribeMapToStream(agent.latestDocVersionStreams, collection, id, stream, function(op) {
      // op.v behind snapshot.v by 1
      latestDocVersions[collection][id] = op.v + 1;
    });

    callback();
  });
};

Agent.prototype._unsubscribeDocVersion = function(collection, id, callback) {
  var stream = util.dig(this.latestDocVersionStreams, collection, id);
  if (stream) stream.destroy();
  util.digAndRemove(this.latestDocVersions, collection, id);
  util.nextTick(callback);
};

Agent.prototype._createPresence = function(request) {
  return {
    a: ACTIONS.presence,
    ch: request.ch,
    src: this._src(),
    id: request.id, // Presence ID, not Doc ID (which is 'd')
    p: request.p,
    pv: request.pv,
    // The c,d,v,t fields are only set for DocPresence
    c: request.c,
    d: request.d,
    v: request.v,
    t: request.t
  };
};

Agent.prototype._subscribePresence = function(channel, seq, cb) {
  var agent = this;

  function callback(error) {
    cb(error, {ch: channel, seq: seq});
  }

  var existingStream = agent.subscribedPresences[channel];
  if (existingStream) {
    agent.presenceSubscriptionSeq[channel] = seq;
    return callback();
  }

  var presenceChannel = this._getPresenceChannel(channel);
  this.backend.pubsub.subscribe(presenceChannel, function(error, stream) {
    if (error) return callback(error);
    if (seq < agent.presenceSubscriptionSeq[channel]) {
      stream.destroy();
      return callback();
    }
    agent.presenceSubscriptionSeq[channel] = seq;
    agent._subscribeToPresenceStream(channel, stream);
    agent._requestPresence(channel, function(error) {
      callback(error);
    });
  });
};

Agent.prototype._unsubscribePresence = function(channel, seq, callback) {
  this.presenceSubscriptionSeq[channel] = seq;
  var stream = this.subscribedPresences[channel];
  if (stream) stream.destroy();
  delete this.subscribedPresences[channel];
  this._retractPresences(channel);
  callback(null, {ch: channel, seq: seq});
};

Agent.prototype._getPresenceChannel = function(channel) {
  return '$presence.' + channel;
};

Agent.prototype._requestPresence = function(channel, callback) {
  var presenceChannel = this._getPresenceChannel(channel);
  this.backend.pubsub.publish([presenceChannel], {ch: channel, r: true, src: this.clientId}, callback);
};

Agent.prototype._handlePresenceData = function(presence) {
  if (presence.src === this._src()) return;

  if (presence.r) return this.send({a: ACTIONS.presenceRequest, ch: presence.ch});

  var backend = this.backend;
  var context = {
    collection: presence.c,
    presence: presence
  };
  var agent = this;
  backend.trigger(backend.MIDDLEWARE_ACTIONS.sendPresence, this, context, function(error) {
    if (error) {
      if (backend.doNotForwardSendPresenceErrorsToClient) backend.errorHandler(error, {agent: agent});
      else agent.send({a: ACTIONS.presence, ch: presence.ch, id: presence.id, error: getReplyErrorObject(error)});
      return;
    }
    agent.send(presence);
  });
};

Agent.prototype._checkFirstMessage = function(request) {
  if (this._handshakeReceived) return;
  if (!this._firstReceivedMessage) this._firstReceivedMessage = request;

  if (request.a === ACTIONS.handshake) {
    this._handshakeReceived = true;
    if (this._firstReceivedMessage.a !== ACTIONS.handshake) {
      logger.warn('Unexpected message received before handshake', this._firstReceivedMessage);
    }
    // Release memory
    this._firstReceivedMessage = null;
  }
};

Agent.prototype._setProtocol = function(request) {
  this.protocol.major = request.protocol;
  this.protocol.minor = request.protocolMinor;
};

function createClientOp(request, clientId) {
  // src can be provided if it is not the same as the current agent,
  // such as a resubmission after a reconnect, but it usually isn't needed
  var src = request.src || clientId;
  // c, d, and m arguments are intentionally undefined. These are set later
  return ('op' in request) ? new EditOp(src, request.seq, request.v, request.op, request.x) :
    (request.create) ? new CreateOp(src, request.seq, request.v, request.create, request.x) :
      (request.del) ? new DeleteOp(src, request.seq, request.v, request.del, request.x) :
        undefined;
}

function shallowCopy(object) {
  var out = {};
  for (var key in object) {
    if (util.hasOwn(object, key)) {
      out[key] = object[key];
    }
  }
  return out;
}

function CreateOp(src, seq, v, create, x, c, d, m) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.create = create;
  this.c = c;
  this.d = d;
  this.m = m;
  this.x = x;
}
function EditOp(src, seq, v, op, x, c, d, m) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.op = op;
  this.c = c;
  this.d = d;
  this.m = m;
  this.x = x;
}
function DeleteOp(src, seq, v, del, x, c, d, m) {
  this.src = src;
  this.seq = seq;
  this.v = v;
  this.del = del;
  this.c = c;
  this.d = d;
  this.m = m;
  this.x = x;
}
