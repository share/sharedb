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

  Livedb.prototype._dbQueryDoc = function(db, index, docName, query, callback) {
    var projection = this.projections[index];
    if (projection) {
      if (db.queryDocProjected) // What a mouthful!
        db.queryDocProjected(this, index, projection.target, docName, projection.fields, query, callback);
      else {
        db.queryDoc(this, index, projection.target, docName, query, function(err, result) {
          if (result) {
            result.data = projections.projectSnapshot(result.type, projection.fields, result.data);
          }
          callback(err, result);
        });
      }
    } else {
      db.queryDoc(this, index, index, docName, query, callback);
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
    if (!this.driver.subscribeCollection) return callback("Driver does not support polling queries");

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

    if (db.disableSubscribe) {
      return callback('Backend does not support subscribe');
    }

    if (!this.snapshotDb.query) {
      return callback('Backend does not support queries');
    }

    var projection = this.projections[index];
    var collection = (projection) ? projection.target : index;
    // subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
    // so if we get notified about an op here, the document's been saved.
    this.driver.subscribeCollection(collection, function(err, stream) {
      if (err) return callback(err);
      if (livedb.sdc) {
        var sdcPrefix = livedb._sdcDbPrefix(options);
        livedb.sdc.timing(sdcPrefix + '.query.driverSubscribe', Date.now() - start);
      }

      // Issue query on db to get our initial result set.
      livedb._dbQuery(db, index, query, {mode: 'initial'}, function(err, resultSet) {
        if (err) {
          stream.destroy();
          return callback(err);
        }
        if (livedb.sdc) {
          var sdcPrefix = livedb._sdcDbPrefix(options);
          livedb.sdc.timing(sdcPrefix + '.query.subscribe', Date.now() - start);
        }
        var results, extra;
        if (Array.isArray(resultSet)) {
          results = resultSet;
        } else {
          results = resultSet.results;
          extra = resultSet.extra;
        }
        var docNames = mapResults(results);
        var queryEmitter = new QueryEmitter(index, query, stream, docNames, extra, projection);
        var pollQuery = getPollQuery(livedb, db, options, queryEmitter)
        startStream(livedb, db, options, queryEmitter, collection, pollQuery);
        callback(null, queryEmitter, results, extra);
      });
    });
  };
};

function startStream(livedb, db, options, queryEmitter, collection, pollQuery) {
  function readStream() {
    var data;
    while (data = queryEmitter.stream.read()) {
      queryEmitter.emitOp(data);
      readStreamItem(livedb, db, options, queryEmitter, collection, pollQuery, data);
    }
  }
  readStream();
  queryEmitter.stream.on('readable', readStream);
  return queryEmitter;
}

function getPollQuery(livedb, db, options, queryEmitter) {
  var poll = (!db.queryDoc) ? true :
    (options.poll != null) ? options.poll :
    (db.queryNeedsPollMode) ? db.queryNeedsPollMode(queryEmitter.index, queryEmitter.query) :
    true;
  if (!poll) return;

  // Default to 2 seconds
  var delay = (typeof options.pollDelay === 'number') ? options.pollDelay : 2000;
  return rateLimit(delay, function pollQuery() {
    // We need to do a full poll of the query, because the query uses limits or something.
    var start = Date.now();
    livedb._dbQuery(db, queryEmitter.index, queryEmitter.query, {mode: 'poll'}, function(err, resultSet) {
      if (err) return queryEmitter.emitError(err);

      if (livedb.sdc) {
        var sdcPrefix = livedb._sdcDbPrefix(options);
        livedb.sdc.timing(sdcPrefix + '.query.poll', Date.now() - start);
      }

      var results, extra;
      if (Array.isArray(resultSet)) {
        results = resultSet;
      } else {
        results = resultSet.results;
        extra = resultSet.extra;
      }
      queryEmitter.emitResults(results, extra);
    });
  });
}

function readStreamItem(livedb, db, options, queryEmitter, collection, pollQuery, data) {
  // Ignore if the user or database say we don't need to poll
  if (options.shouldPoll && !options.shouldPoll(collection, data.docName, data, queryEmitter.index, queryEmitter.query)) return;
  if (db.queryShouldPoll && !db.queryShouldPoll(this, collection, data.docName, data, queryEmitter.index, queryEmitter.query)) return;

  // Not sure whether the changed document should be in the result set
  if (pollQuery) return pollQuery();

  var start = Date.now();
  livedb._dbQueryDoc(db, queryEmitter.index, data.docName, queryEmitter.query, function(err, result) {
    if (err === 'Irrelevant') return;
    if (err) return queryEmitter.emitError(err);

    if (livedb.sdc) {
      var sdcPrefix = livedb._sdcDbPrefix(options);
      livedb.sdc.timing(sdcPrefix + '.query.pollDoc', Date.now() - start);
    }

    // Check if the document was in the previous results set
    var i = queryEmitter.docNames.indexOf(data.docName);

    if (i === -1 && result) {
      // Add doc to the collection. Order isn't important, so
      // we'll just whack it at the end.
      var index = queryEmitter.docNames.push(result.docName) - 1;
      var values = [result];
      queryEmitter.emitDiff([new arraydiff.InsertDiff(index, values)]);

    } else if (i !== -1 && !result) {
      queryEmitter.docNames.splice(i, 1);
      queryEmitter.emitDiff([new arraydiff.RemoveDiff(i, 1)]);
    }
  });
}

function QueryEmitter(index, query, stream, docNames, extra, projection) {
  this.index = index;
  this.query = query;
  this.stream = stream;
  this.docNames = docNames;
  this.extra = extra;
  this.projection = projection;
}

QueryEmitter.prototype.destroy = function() {
  this.stream.destroy();
};

QueryEmitter.prototype.emitResults = function(results, extra) {
  var docNames = mapResults(results);
  var docNamesDiff = arraydiff(this.docNames, docNames);
  if (docNamesDiff.length) {
    this.docNames = docNames;
    var diff = mapDiff(docNamesDiff, results);
    this.emitDiff(diff);
  }
  // Be nice to not have to do this in such a brute force way
  if (!deepEquals(this.extra, extra)) {
    this.extra = extra;
    this.emitExtra(extra);
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
QueryEmitter.prototype.emitOp = function(data) {
  if (this.docNames.indexOf(data.docName) === -1) return;
  if (this.projection) {
    var projected = projections.projectOpData(this.projection.type, this.projection.fields, data);
    projected.docName = data.docName;
    projected.collection = this.index;
    this.onOp(projected);
  } else {
    this.onOp(data);
  }
};

// Clients should define these functions
QueryEmitter.prototype.onError = doNothing;
QueryEmitter.prototype.onDiff = doNothing;
QueryEmitter.prototype.onExtra = doNothing;
QueryEmitter.prototype.onOp = doNothing;

function doNothing() {}

function mapResults(results) {
  var docNames = [];
  for (var i = 0; i < results.length; i++) {
    docNames.push(results[i].docName);
  }
  return docNames;
}

function mapDiff(docNamesDiff, results) {
  var diff = [];
  var resultsMap;
  for (var i = 0; i < docNamesDiff.length; i++) {
    var item = docNamesDiff[i];
    if (item instanceof arraydiff.InsertDiff) {
      if (!resultsMap) resultsMap = getResultsMap(results);
      var values = [];
      for (var j = 0; j < item.values.length; j++) {
        var docName = item.values[j];
        values.push(resultsMap[docName]);
      }
      diff.push(new arraydiff.InsertDiff(item.index, values));
    } else {
      diff.push(item);
    }
  }
  return diff;
}

function getResultsMap(results) {
  var resultsMap = {};
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    resultsMap[result.docName] = result;
  }
  return resultsMap;
}
