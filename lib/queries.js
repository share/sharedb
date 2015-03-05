var rateLimit = require('./ratelimit');
var deepEquals = require('deep-is');
var arraydiff = require('arraydiff');
var projections = require('./projections');

module.exports = function(Livedb) {

  Livedb.prototype._sdcDbPrefix = function(options) {
    return 'livedb.db.' + ((options && options.backend) ? options.backend : 'default');
  };

  function projectResults(results, cName, projection) {
    if (!projection) return;
    var r = results.results ? results.results : results;
    for (var i = 0; i < r.length; i++) {
      var r = r[i];
      r.data = projections.projectSnapshot(r.type, projection.fields, r.data);
      if (r.c) r.c = cName;
    }
  }

  Livedb.prototype._dbQuery = function(db, index, query, options, callback) {
    var projection = this.projections[index];

    if (projection) {
      if (db.queryProjected)
        db.queryProjected(this, projection.target, projection.fields, query, options, callback);
      else {
        db.query(this, projection.target, query, options, function(err, results) {
          if (results) projectResults(results, index, projection);
          callback(err, results);
        });
      }
    } else {
      db.query(this, index, query, options, callback);
    }
  };

  Livedb.prototype._dbQueryDoc = function(db, index, cName, docName, query, callback) {
    // console.log('_dbQueryDoc', index, cName);

    // So, the index is the index that was originally passed into query(), and the cName is (if
    // overwritten) the collection that the document is actually in. Usually they'll be the same.
    // I'm going to assume they might both be projections and those projections could be different,
    // but this isn't tested. I'll probably rework this behaviour in upcoming iterations.

    // We ignore everything about the index's projection except for its target - which we use to map
    // the target (since if thats relevant, we used it in the initial query). But if its relevant,
    // its probably the same as cName. So whatever. Blah.
    var pIndex = this.projections[index];
    if (pIndex) index = pIndex.target;

    var projection = this.projections[cName];

    if (projection) {
      if (db.queryDocProjected) // What a mouthful!
        db.queryDocProjected(this, index, projection.target, docName, projection.fields, query, callback);
      else {
        db.queryDoc(this, index, projection.target, docName, query, function(err, result) {
          if (result) {
            result.data = projections.projectSnapshot(result.type, projection.fields, result.data);
            if (result.c) result.c = cName;
          }
          callback(err, result);
        });
      }
    } else {
      db.queryDoc(this, index, cName, docName, query, callback);
    }
  };

  Livedb.prototype.queryFetch = function(index, query, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    var start = Date.now();
    var livedb = this;

    var db;
    if (options && options.backend) {
      if (!this.extraDbs.hasOwnProperty(options.backend)) return callback('Backend not found');
      db = this.extraDbs[options.backend];
    } else {
      db = this.snapshotDb;
    }
    if (db.query.length < 5)
      throw Error("Livedb query backend " + (options.backend || 'default') + " is out of date " +
        "with spec (its probably missing the 'options' parameter). Update your livedb backend library");

    if (!this.snapshotDb.query) {
      return callback('Backend does not support queries');
    }

    this._dbQuery(db, index, query, {mode:'fetch'}, function(err, resultSet) {
      if (livedb.sdc) {
        var sdcPrefix = livedb._sdcDbPrefix(options);
        livedb.sdc.increment(sdcPrefix + '.query.fetch');
        livedb.sdc.timing(sdcPrefix + '.query.fetch', Date.now() - start);
      }

      if (err) {
        callback(err);
      } else if (Array.isArray(resultSet)) {
        callback(null, resultSet);
      } else {
        callback(null, resultSet.results, resultSet.extra);
      }
    });
  };

  Livedb.prototype.query = function(index, query, options, callback) {
    this.queryPoll(index, query, options, callback);
  };

  // For mongo, the index is just the collection itself. For something like
  // SOLR, the index refers to the core we're actually querying.
  //
  // Options can contain:
  // backend: the backend to use, or the name of the backend (if the backend
  //  is specified in the otherDbs when the livedb instance is created)
  // poll: true, false or undefined. Set true/false to force enable/disable
  //  polling mode. Undefined will let the database decide.
  // shouldPoll: function(collection, docName, opData, index, query) {return true or false; }
  //  this is a syncronous function which can be used as an early filter for
  //  operations going through the system to reduce the load on the backend.
  // pollDelay: Minimum delay between subsequent database polls. This is used
  //  to batch updates to reduce load on the database at the expense of
  //  liveness.
  Livedb.prototype.queryPoll = function(index, query, options, callback) {
    if (!this.driver.subscribeChannels) return callback("Driver does not support polling queries");

    if (typeof options === 'function') {
      callback = options;
      options = {};
    } else if (!options) {
      options = {};
    }

    var start = Date.now();
    var livedb = this;

    var db;
    if (options.backend) {
      if (!this.extraDbs.hasOwnProperty(options.backend)) return callback('Backend not found');
      db = this.extraDbs[options.backend];
    } else {
      db = this.snapshotDb;
    }

    if (db.query.length < 5)
      throw Error("Livedb query backend " + (options.backend || 'default') + " is out of date " +
        "with spec (its probably missing the 'options' parameter). Update your livedb backend library");

    if (!this.snapshotDb.query) {
      return callback('Backend does not support queries');
    }

    var channels = db.subscribedChannels ? db.subscribedChannels(index, query, options) : [index];

    // Map from target channel name -> projection if there are any projections.
    var unprojectedChannel = null;
    for (var i = 0; i < channels.length; i++) {
      var c = channels[i];
      var projection = this.projections[c];
      if (projection) {
        if (!unprojectedChannel) unprojectedChannel = {};
        unprojectedChannel[projection.target] = c;
        channels[i] = projection.target;
      }
    }
    if (!Array.isArray(channels)) channels = [channels];

    // subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
    // so if we get notified about an op here, the document's been saved.
    this.driver.subscribeChannels(channels, function(err, stream) {
      if (err) return callback(err);
      if (livedb.sdc) {
        var sdcPrefix = livedb._sdcDbPrefix(options);
        livedb.sdc.timing(sdcPrefix + '.query.driverSubscribe', Date.now() - start);
      }

      // Issue query on db to get our initial result set.
      livedb._dbQuery(db, index, query, {mode: 'initial'}, function(err, resultSet) {
        //console.log('-> pshotdb query', query, resultSet);
        if (err) {
          stream.destroy();
          return callback(err);
        }
        if (livedb.sdc) {
          var sdcPrefix = livedb._sdcDbPrefix(options);
          livedb.sdc.increment(sdcPrefix + '.query.subscribe');
          livedb.sdc.timing(sdcPrefix + '.query.subscribe', Date.now() - start);
        }

        var queryEmitter = new QueryEmitter(index, query, stream, resultSet);
        startStream(livedb, db, options, queryEmitter, unprojectedChannel, stream);
        callback(null, queryEmitter);
      });
    });
  };
};

function startStream(livedb, db, options, queryEmitter, unprojectedChannel, stream) {
  var pollQuery = getPollQuery(livedb, db, options, queryEmitter);
  function readStream() {
    var data;
    while (data = stream.read()) {
      // Collection name.
      data.c = (unprojectedChannel && unprojectedChannel[data.channel]) ?
         unprojectedChannel[data.channel] : data.channel;
      readStreamItem(livedb, db, options, queryEmitter, pollQuery, data);
    }
  }
  readStream();
  stream.on('readable', readStream);
}

function getPollQuery(livedb, db, options, queryEmitter) {
  var poll;
  if (!db.queryDoc) {
    poll = true;
  } else if (options.poll == null && db.queryNeedsPollMode) {
    poll = db.queryNeedsPollMode(queryEmitter.index, queryEmitter.query);
  } else {
    poll = options.poll;
  }
  if (!poll) return;

  // Default to 2 seconds
  var delay = typeof options.pollDelay === 'number' ? options.pollDelay : 2000;

  return rateLimit(delay, function pollQuery() {
    // We need to do a full poll of the query, because the query uses limits or something.
    var start = Date.now();
    livedb._dbQuery(db, queryEmitter.index, queryEmitter.query, {mode: 'poll'}, function(err, resultSet) {
      if (err) return queryEmitter.emitError(err);

      if (livedb.sdc) {
        var sdcPrefix = livedb._sdcDbPrefix(options);
        livedb.sdc.timing(sdcPrefix + '.query.poll', Date.now() - start);
      }

      queryEmitter.emitResults(resultSet)
    });
  });
}

function readStreamItem(livedb, db, options, queryEmitter, pollQuery, data) {
  // Ignore if the user or database say we don't need to poll
  if (options.shouldPoll && !options.shouldPoll(data.c, data.docName, data, queryEmitter.index, queryEmitter.query)) return;
  if (db.queryShouldPoll && !db.queryShouldPoll(this, data.c, data.docName, data, queryEmitter.index, queryEmitter.query)) return;

  // We have some data from the channel stream about an updated document.
  var i = findResultIndex(queryEmitter.results, data);
  var cachedData = queryEmitter.results[i];

  // Ignore ops that are older than our data. This is possible
  // because we subscribe before issuing the query.
  if (cachedData && cachedData.v > data.v) return;

  // Not sure whether the changed document should be in the result set
  if (pollQuery) return pollQuery();

  livedb._dbQueryDoc(db, queryEmitter.index, data.c, data.docName, queryEmitter.query, function(err, result) {
    if (err === 'Irrelevant') return;
    if (err) return queryEmitter.emitError(err);

    if (result && !cachedData) {
      // Add doc to the collection. Order isn't important, so
      // we'll just whack it at the end.
      result.c = data.c;
      var index = queryEmitter.results.push(result) - 1;
      queryEmitter.emitDiff([{
        type: 'insert',
        index: index,
        values: [result]
      }]);

    } else if (!result && cachedData) {
      queryEmitter.results.splice(i, 1);
      queryEmitter.emitDiff([{
        type: 'remove',
        index: i,
        howMany: 1
      }]);
    }
  });
}

function findResultIndex(results, data) {
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    if (result.c === data.c && result.docName === data.docName) return i;
  }
}

function QueryEmitter(index, query, stream, resultSet) {
  this.index = index;
  this.query = query;
  this.stream = stream;
  if (Array.isArray(resultSet)) {
    this.results = resultSet;
    this.extra = null;
  } else {
    // Resultset is an object. It should look like {results:[..], data:....}
    this.results = resultSet.results;
    this.extra = resultSet.extra;
  }
  this._updateResultsIndex(this.results);
}

QueryEmitter.prototype.destroy = function() {
  this.stream.destroy();
  this.onError = doNothing;
  this.onDiff = doNothing;
  this.onExtra = doNothing;
  this.emitError = doNothing;
  this.emitDiff = doNothing;
  this.emitExtra = doNothing;
};

QueryEmitter.prototype._updateResultsIndex = function(results) {
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    result.c = result.c || this.index;
  }
};

QueryEmitter.prototype.emitResults = function(resultSet) {
  var results;
  if (Array.isArray(resultSet)) {
    results = resultSet;
  } else {
    if (resultSet.extra !== undefined) {
      // This is pretty inefficient... be nice to not have to do this.
      if (!deepEquals(this.extra, resultSet.extra)) {
        this.extra = resultSet.extra;
        this.emitExtra(resultSet.extra);
      }
    }
    results = resultSet.results;
  }

  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    result.c = result.c || this.index;
  }

  var diff = arraydiff(this.results, results, function(a, b) {
    if (!a || !b) return false;
    return a.docName === b.docName && a.c === b.c;
  });

  if (diff.length) {
    this.results = results;

    // copy the diff type from the data prototype to the data
    // object itself for JSON.stringify later.
    for (var i = 0; i < diff.length; i++) {
      diff[i].type = diff[i].type;
    }
    this.emitDiff(diff);
  }
};

// These methods can be overriden to extend default behavior
QueryEmitter.prototype.emitError = function(err) {
  this.onError(err);
};
QueryEmitter.prototype.emitDiff = function(diff) {
  this.onDiff(diff);
};
QueryEmitter.prototype.emitExtra = function(extra) {
  this.onExtra(extra);
};

// Clients should define these functions
QueryEmitter.prototype.onError = doNothing;
QueryEmitter.prototype.onDiff = doNothing;
QueryEmitter.prototype.onExtra = doNothing;

function doNothing() {}
