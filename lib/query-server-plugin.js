var Agent = require('./agent');

exports.Plugin = QueryServerPlugin;

/**
 * @typedef { import('./backend').RequestHandlerContext<S> } RequestHandlerContext
 * @template S
 */

/**
 * Core plugin to handle queries
 */
function QueryServerPlugin() {
  this.name = 'sharedb.query';
  this.requestHandlers = {
    qf: queryFetch,
    qs: querySubscribe,
    qu: queryUnsubscribe
  };
}

QueryServerPlugin.prototype.close = function(callback) {
  callback();
};

QueryServerPlugin.prototype.createAgentState = function() {
  return new QueriesAgentState();
};

/**
 * @param {QueriesAgentState} agentState
 */
QueryServerPlugin.prototype.destroyAgentState = function(agentState) {
  // Clean up query subscription streams
  for (var id in agentState.subscribedQueries) {
    var emitter = agentState.subscribedQueries[id];
    emitter.destroy();
  }
  agentState.subscribedQueries = {};
};

QueryServerPlugin.prototype.checkRequest = function(request) {
  if (typeof request.id !== 'number') {
    throw new Error('Missing query ID');
  }
};

/**
 * Fetch the results of a query once
 *
 * @param {TReq} request Request message from a client
 * @param {RequestHandlerContext<QueriesAgentState>} context
 * @param {(err?: Error | null, reply?: TResp) => void} callback Callback to be called with the
 *   reply message
 */
function queryFetch(request, context, callback) {
  var collection = request.c;
  var query = request.q;
  var options = getQueryOptions(request);
  var agent = context.agent;
  var backend = context.backend;

  backend.queryFetch(agent, collection, query, options, function(err, results, extra) {
    if (err) return callback(err);
    var message = {
      data: getResultsData(results),
      extra: extra
    };
    callback(null, message);
  });
}

/**
 * Subscribe to a query. The client is sent the query results, and it's notified whenever there's a
 * change
 *
 * @param {TReq} request Request message from a client
 * @param {RequestHandlerContext<QueriesAgentState>} context
 * @param {(err?: Error | null, reply?: TResp) => void} callback Callback to be called with the
 *   reply message
 */
function querySubscribe(request, context, callback) {
  var queryId = request.id;
  var collection = request.c;
  var query = request.q;
  var options = getQueryOptions(request);
  var agent = context.agent;
  var backend = context.backend;

  var wait = 1;
  var message;
  function finish(err) {
    if (err) return callback(err);
    if (--wait) return;
    callback(null, message);
  }
  if (options.fetch) {
    wait++;
    backend.fetchBulk(agent, collection, options.fetch, function(err, snapshotMap) {
      if (err) return finish(err);
      message = Agent._getMapResult(snapshotMap);
      finish();
    });
  }
  if (options.fetchOps) {
    wait++;
    agent._fetchBulkOps(collection, options.fetchOps, finish);
  }
  backend.querySubscribe(agent, collection, query, options, function(err, emitter, results, extra) {
    if (err) return finish(err);
    if (agent.closed) return emitter.destroy();

    _subscribeToQuery(context, emitter, queryId, collection, query);
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
}

function _subscribeToQuery(context, emitter, queryId, collection, query) {
  var previous = context.agentState.subscribedQueries[queryId];
  if (previous) previous.destroy();
  context.agentState.subscribedQueries[queryId] = emitter;

  var agent = context.agent;
  emitter.onExtra = function(extra) {
    agent.send({a: 'q', id: queryId, extra: extra});
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
    agent.send({a: 'q', id: queryId, diff: diff});
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

/**
 * @param {TReq} request Request message from a client
 * @param {RequestHandlerContext<QueriesAgentState>} context
 * @param {(err?: Error | null, reply?: TResp) => void} callback Callback to be called with the
 *   reply message
 */
function queryUnsubscribe(request, context, callback) {
  var queryId = request.id;

  var emitter = this.subscribedQueries[queryId];
  if (emitter) {
    emitter.destroy();
    delete this.subscribedQueries[queryId];
  }
  process.nextTick(callback);
}

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
        if (!fetchOps) fetchOps = {};
        fetchOps[id] = version;
      }
    }
  }
  var options = request.o || {};
  options.ids = ids;
  options.fetch = fetch;
  options.fetchOps = fetchOps;
  return options;
}

function getResultsData(results) {
  var items = [];
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var item = Agent._getSnapshotData(result);
    item.d = result.id;
    items.push(item);
  }
  return items;
}

function QueriesAgentState() {
  // Map from queryId -> QueryEmitter
  /** @type {{[queryId: number]: import('./query-emitter')}} */
  this.subscribedQueries = {};
}
