var deepEquals = require('deep-is');
var arraydiff = require('arraydiff');
var projections = require('./projections');

module.exports = function(Livedb) {

  Livedb.prototype._queryStatsPrefix = function(options) {
    return 'query.' + (options.backend || 'default') + '.';
  };

  Livedb.prototype._getQueryDb = function(options) {
    return (options.backend) ? this.extraDbs[options.backend] : this.snapshotDb;
  };

  Livedb.prototype._checkQueryDb = function(db) {
    if (!db) return 'Backend not found';
    if (!db.query) return 'Backend does not support queries';
  };

  Livedb.prototype.queryFetch = function(index, query, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    var db = this._getQueryDb(options);
    var err = this._checkQueryDb(db);
    if (err) return callback(err);

    var projection = this.projections[index];
    var cName = (projection) ? projection.target : index;
    var fields = projection && projection.fields;
    var start = Date.now();
    var livedb = this;
    db.query(cName, query, fields, null, function(err, results, extra) {
      var prefix = livedb._queryStatsPrefix(options);
      livedb.emit('timing', prefix + 'fetch', Date.now() - start, index, query);
      callback(err, results, extra);
    });
  };

  // For mongo, the index is just the collection itself. For something like
  // Elasticsearch, the index could refer to a custom search index
  //
  // Options can contain:
  // backend: the backend to use, or the name of the backend (if the backend
  //  is specified in the otherDbs when the livedb instance is created)
  // poll: true, false or undefined. Set true/false to force enable/disable
  //  polling mode. Undefined will let the database decide.
  // shouldPoll: function(collection, docName, opData, index, query) {return true or false; }
  //  this is a syncronous function which can be used as an early filter for
  //  operations going through the system to reduce the load on the backend.
  // pollDelay: Minimum delay between subsequent database polls. This is
  //  used to batch updates to reduce load on the database at the expense of
  //  liveness. Defaults to 2000 (2 seconds)
  Livedb.prototype.querySubscribe = function(index, query, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    var db = this._getQueryDb(options);
    var err = this._checkQueryDb(db);
    if (err) return callback(err);
    if (db.disableSubscribe) return callback('Backend does not support subscribe');
    if (!this.driver.subscribeChannel) return callback('Driver does not support polling queries');

    var projection = this.projections[index];
    var cName = (projection) ? projection.target : index;
    var fields = projection && projection.fields;
    // subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
    // so if we get notified about an op here, the document's been saved.
    var channel = options.channel || cName;
    var start = Date.now();
    var livedb = this;
    this.driver.subscribeChannel(channel, function(err, stream) {
      if (err) return callback(err);
      // Issue query on db to get our initial results
      db.query(cName, query, fields, null, function(err, results, extra) {
        var prefix = livedb._queryStatsPrefix(options);
        livedb.emit('timing', prefix + 'subscribe', Date.now() - start, index, query);
        if (err) {
          stream.destroy();
          return callback(err);
        }
        var docNames = mapResults(results);
        var queryEmitter = new QueryEmitter(
          livedb, db, index, query, fields, cName, stream, docNames, extra, options
        );
        callback(null, queryEmitter, results, extra);
      });
    });
  };
};


function QueryEmitter(livedb, db, index, query, fields, cName, stream, docNames, extra, options) {
  this.livedb = livedb;
  this.db = db;
  this.index = index;
  this.query = query;
  this.fields = fields;
  this.cName = cName;
  this.stream = stream;
  this.docNames = docNames;
  this.extra = extra;
  this._statsPrefix = livedb._queryStatsPrefix(options);

  // Function called with a specific op to see if we need to poll the db
  this.shouldPoll = options.shouldPoll;

  // True if we have to use pollQuery, false if we can use pollQueryDoc
  this.poll = (options.poll != null) ? options.poll :
    (db.queryNeedsPollMode) ? db.queryNeedsPollMode(cName, index, query) :
    true;
  // Default to full polling queries no faster than every two seconds. This does
  // not affect document polling
  this.pollDelay = (options.pollDelay != null) ? options.pollDelay : 2000;

  this._polling = false;
  this._pollAgain = false;
  this._pollTimeout = null;

  this.startStream();
}

QueryEmitter.prototype.destroy = function() {
  this.stream.destroy();
};

QueryEmitter.prototype.startStream = function() {
  var queryEmitter = this;
  function readStream() {
    var data;
    while (data = queryEmitter.stream.read()) {
      queryEmitter.emitOp(data);
      queryEmitter.update(data);
    }
  }
  readStream();
  queryEmitter.stream.on('readable', readStream);
};

QueryEmitter.prototype._emitTiming = function(action, start) {
  this.livedb.emit('timing', this._statsPrefix + action, Date.now() - start, this.index, this.query);
};

QueryEmitter.prototype.update = function(data) {
  // Ignore if the user or database say we don't need to poll.
  //
  // Try/catch this, since we want to make sure polling from a malformed op
  // doesn't crash the server. Note that we are just quietly logging the error
  // instead of emitting it, because any errors thrown here are likely due to
  // malformed ops coming from a different client. We don't want to send errors
  // to clients that aren't responsible for causing them.
  try {
    if (this.shouldPoll && !this.shouldPoll(this.cName, data.docName, data, this.index, this.query)) return;
    if (this.db.queryShouldPoll && !this.db.queryShouldPoll(this.cName, data.docName, data, this.index, this.query)) return;
  } catch (err) {
    console.error('Error evaluating shouldPoll:', this.cName, data.docName, data, this.index, this.query);
    console.error(err.stack || err);
  }
  if (this.poll) {
    // We need to do a full poll of the query, because the query uses limits,
    // sorts, or something special
    this.pollQuery();
  } else {
    // We can query against only the document that was modified to see if the
    // op has changed whether or not it matches the results
    this.pollQueryDoc(data.docName);
  }
};

QueryEmitter.prototype._flushPoll = function() {
  if (this._polling || this._pollTimeout) return;
  if (this._pollAgain) this.pollQuery();
};

QueryEmitter.prototype._finishPoll = function(err) {
  this._polling = false;
  if (err) this.emitError(err);
  this._flushPoll();
};

QueryEmitter.prototype.pollQuery = function() {
  var queryEmitter = this;

  // Only run a single polling check against mongo at a time per emitter. This
  // matters for two reasons: First, one callback could return before the
  // other. Thus, our result diffs could get out of order, and the clients
  // could end up with results in a funky order and the wrong results being
  // removed from the query. Second, only having one query executed
  // simultaneously per emitter will act as a natural adaptive rate limiting
  // in case the db is under load.
  //
  // This isn't neccessary for the document polling case, since they operate
  // on a given id and won't accidentally modify the wrong doc. Also, those
  // queries should be faster and we have to run all of them eventually, so
  // there is less benefit to load reduction.
  if (this._polling || this._pollTimeout) {
    this._pollAgain = true;
    return;
  }
  this._polling = true;
  this._pollAgain = false;
  if (this.pollDelay) {
    this._pollTimeout = setTimeout(function() {
      queryEmitter._pollTimeout = null;
      queryEmitter._flushPoll();
    }, this.pollDelay);
  }

  var start = Date.now();
  this.db.queryPoll(this.cName, this.query, null, function(err, docNames, extra) {
    queryEmitter._emitTiming('poll', start);
    if (err) return queryEmitter._finishPoll(err);

    var docNamesDiff = arraydiff(queryEmitter.docNames, docNames);
    if (docNamesDiff.length) {
      queryEmitter.docNames = docNames;
      var inserted = getInserted(docNamesDiff);
      if (inserted.length) {
        queryEmitter.db.getSnapshots(queryEmitter.cName, inserted, queryEmitter.fields, function(err, snapshots) {
          queryEmitter._emitTiming('pollGetSnapshots', start);
          if (err) return queryEmitter._finishPoll(err);
          var diff = mapDiff(docNamesDiff, snapshots)
          queryEmitter.emitDiff(diff);
          queryEmitter._finishPoll();
        });
      } else {
        queryEmitter.emitDiff(docNamesDiff);
        queryEmitter._finishPoll();
      }
    }
    // Be nice to not have to do this in such a brute force way
    if (!deepEquals(queryEmitter.extra, extra)) {
      queryEmitter.extra = extra;
      queryEmitter.emitExtra(extra);
    }
  });
};

QueryEmitter.prototype.pollQueryDoc = function(docName) {
  var queryEmitter = this;
  var start = Date.now();
  this.db.queryPollDoc(this.cName, docName, this.query, null, function(err, matches) {
    queryEmitter._emitTiming('pollDoc', start);
    if (err) return queryEmitter.emitError(err);

    // Check if the document was in the previous results set
    var i = queryEmitter.docNames.indexOf(docName);

    if (i === -1 && matches) {
      // Add doc to the collection. Order isn't important, so we'll just whack
      // it at the end
      var index = queryEmitter.docNames.push(docName) - 1;
      // We can get the result to send to the client async, since there is a
      // delay in sending to the client anyway
      queryEmitter.db.getSnapshot(queryEmitter.cName, docName, queryEmitter.fields, function(err, snapshot) {
        queryEmitter._emitTiming('pollDocGetSnapshot', start);
        if (err) return queryEmitter.emitError(err);
        var values = [snapshot];
        queryEmitter.emitDiff([new arraydiff.InsertDiff(index, values)]);
      });

    } else if (i !== -1 && !matches) {
      queryEmitter.docNames.splice(i, 1);
      queryEmitter.emitDiff([new arraydiff.RemoveDiff(i, 1)]);
    }
  });
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
  if (this.fields) {
    try {
      var projected = projections.projectOpData(this.fields, data);
      projected.docName = data.docName;
      projected.collection = this.index;
      this.onOp(projected);
    } catch (err) {
      // Don't bubble up error to client, since it is likely not
      // the same client that created the op
      console.error('Error projecting op for query:', this.index, data.docName, data, this.query);
      console.error(err.stack || err);
    }
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

function getInserted(diff) {
  var inserted = [];
  for (var i = 0; i < diff.length; i++) {
    var item = diff[i];
    if (item instanceof arraydiff.InsertDiff) {
      for (var j = 0; j < item.values.length; j++) {
        inserted.push(item.values[j]);
      }
    }
  }
  return inserted;
}

function mapDiff(docNamesDiff, results) {
  var diff = [];
  var resultsMap = {};
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    resultsMap[result.docName] = result;
  }
  for (var i = 0; i < docNamesDiff.length; i++) {
    var item = docNamesDiff[i];
    if (item instanceof arraydiff.InsertDiff) {
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
