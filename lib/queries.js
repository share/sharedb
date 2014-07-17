var EventEmitter = require('events').EventEmitter;
var rateLimit = require('./ratelimit');
var deepEquals = require('deep-is');
var arraydiff = require('arraydiff');
var projections = require('./projections');

module.exports = function(Livedb) {

  Livedb.prototype._sdcDbPrefix = function(opts) {
    return 'livedb.db.' + ((opts && opts.backend) ? opts.backend : 'default');
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

  Livedb.prototype.queryFetch = function(index, query, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = null;
    }

    var start = Date.now();
    var self = this;
    var db;

    if (opts && opts.backend) {
      if (!this.extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
      db = this.extraDbs[opts.backend];
    } else {
      db = this.snapshotDb;
    }
    if (db.query.length < 5)
      throw Error("Livedb query backend " + (opts.backend || 'default') + " is out of date " +
        "with spec (its probably missing the 'options' parameter). Update your livedb backend library");

    if (!this.snapshotDb.query) {
      return callback('Backend does not support queries');
    }

    var sdcPrefix = self._sdcDbPrefix(opts);
    if (self.sdc) self.sdc.increment(sdcPrefix + '.query.initial');

    var dbStart = Date.now();

    this._dbQuery(db, index, query, {mode:'fetch'}, function(err, resultSet) {
      if (self.sdc) {
        // These will be basically the same here, but they might be different in .query() below.
        self.sdc.timing(sdcPrefix + '.fetch', Date.now() - start);
        self.sdc.timing(sdcPrefix + '.query.all', Date.now() - dbStart);
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
  Livedb.prototype.queryPoll = function(index, query, opts, callback) {
    if (!this.driver.subscribeChannels) return callback("Driver does not support polling queries");

    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    } else if (!opts) {
      opts = {};
    }

    var start = Date.now();
    var db;
    var self = this;

    if (opts.backend) {
      if (!this.extraDbs.hasOwnProperty(opts.backend)) return callback('Backend not found');
      db = this.extraDbs[opts.backend];
    } else {
      db = this.snapshotDb;
    }

    if (db.query.length < 5)
      throw Error("Livedb query backend " + (opts.backend || 'default') + " is out of date " +
        "with spec (its probably missing the 'options' parameter). Update your livedb backend library");

    var sdcPrefix = this._sdcDbPrefix(opts) + '.query';

    if (!this.snapshotDb.query) {
      return callback('Backend does not support queries');
    }

    var poll;
    // Could rewrite this as a ternary but its pretty unreadable.
    if (!db.queryDoc) {
      opts.poll = poll = true;
    } else if (opts.poll === undefined && db.queryNeedsPollMode) {
      // Note that this asks the database on the source collection when projects are used
      opts.poll = poll = db.queryNeedsPollMode(index, query);
    } else {
      poll = opts.poll;
    }
    
    // Default to 2 seconds
    var delay = typeof opts.pollDelay === 'number' ? opts.pollDelay : 2000;

    // console.log('poll mode:', !!poll);


    var channels = db.subscribedChannels ? db.subscribedChannels(index, query, opts) : [index];

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

      // Issue query on db to get our initial result set.
      // console.log('snapshotdb query', cName, query);
      var dbStart = Date.now();
      self._dbQuery(db, index, query, {mode:'initial'}, function(err, resultSet) {
        //console.log('-> pshotdb query', query, resultSet);
        if (err) {
          stream.destroy();
          return callback(err);
        }
        if (self.sdc) {
          self.sdc.timing(sdcPrefix + '.all', Date.now() - dbStart);
          self.sdc.timing(sdcPrefix + '.initial', Date.now() - dbStart);
        }

        var emitter = new EventEmitter();
        emitter.destroy = function() {
          stream.destroy();
        };

        var results, extra;
        if (!Array.isArray(resultSet)) {
          // Resultset is an object. It should look like {results:[..], data:....}
          emitter.extra = extra = resultSet.extra;
          results = resultSet.results;
        } else {
          results = resultSet;
        }

        emitter.data = results;

        // Maintain a map from docName -> index for constant time tests
        var docIdx = {};

        for (var i = 0; i < results.length; i++) {
          var d = results[i];
          d.c = d.c || index;
          docIdx["" + d.c + "." + d.docName] = i;
        }

        if (poll) {
          var runQuery = rateLimit(delay, function() {
            // We need to do a full poll of the query, because the query uses limits or something.
            var dbStart = Date.now();
            self._dbQuery(db, index, query, {mode:'poll'}, function(err, newResultset) {
              if (err) return emitter.emit('error', new Error(err));

              if (self.sdc) {
                self.sdc.timing(sdcPrefix + '.all', Date.now() - dbStart);
                self.sdc.timing(sdcPrefix + '.poll', Date.now() - dbStart);
              }

              var newResults;
              if (!Array.isArray(newResultset)) {
                if (newResultset.extra !== undefined) {
                  // This is pretty inefficient... be nice to not have to do this.
                  if (!deepEquals(extra, newResultset.extra)) {
                    emitter.emit('extra', newResultset.extra);
                    emitter.extra = extra = newResultset.extra;
                  }
                }
                newResults = newResultset.results;
              } else {
                newResults = newResultset;
              }

              var i, r;
              for (var i = 0; i < newResults.length; i++) {
                r = newResults[i];
                r.c = r.c || index;
              }

              var diff = arraydiff(results, newResults, function(a, b) {
                if (!a || !b) return false;
                return a.docName === b.docName && a.c === b.c;
              });

              if (diff.length) {
                emitter.data = results = newResults;

                // copy the diff type from the data prototype to the data
                // object itself for JSON.stringify later.
                for (var j = 0; j < diff.length; j++) {
                  diff[j].type = diff[j].type;
                }
                emitter.emit('diff', diff);
              }
            });
          });
        }

        var f = function() {
          var d;
          while ((d = stream.read())) {
            (function(d) {
              // Collection name.
              d.c = (unprojectedChannel && unprojectedChannel[d.channel]) ?
                 unprojectedChannel[d.channel] : d.channel;

              // We have some data from the channel stream about an updated document.
              //console.log(d.docName, docIdx, results);
              var cachedData = results[docIdx[d.c + '.' + d.docName]];

              // Ignore ops that are older than our data. This is possible
              // because we subscribe before issuing the query.
              if (cachedData && cachedData.v > d.v) return;

              // Ignore if the user or database say we don't need to poll. I'm
              // not sure if opts.shouldPoll is relevant going forward.
              if (opts.shouldPoll && !opts.shouldPoll(d.c, d.docName, d, index, query)) return;
              if (db.queryShouldPoll && !db.queryShouldPoll(this, d.c, d.docName, d, index, query)) return;

              // Not sure whether the changed document should be in the result set
              if (poll) {
                runQuery();
              } else {
                self._dbQueryDoc(db, index, d.c, d.docName, query, function(err, result) {
                  if (err === 'Irrelevant') return;

                  if (err) return emitter.emit('error', new Error(err));

                  // console.log(!!result, !!cachedData);
                  if (result && !cachedData) {
                    // console.log('x')
                    // Add doc to the collection. Order isn't important, so
                    // we'll just whack it at the end.
                    result.c = d.c;
                    results.push(result);
                    emitter.emit('diff', [{
                      type:'insert',
                      index:results.length - 1,
                      values:[result]
                    }]);
                    //emitter.emit('add', result, results.length - 1);
                    docIdx[result.c + '.' + result.docName] = results.length - 1;
                  } else if (!result && cachedData) {
                    var name = "" + d.c + "." + d.docName;
                    // Remove doc from collection
                    var idx = docIdx[name];
                    delete docIdx[name];
                    //emitter.emit('remove', results[idx], idx);
                    emitter.emit('diff', [{type:'remove', index:idx, howMany:1}]);
                    results.splice(idx, 1);
                    while (idx < results.length) {
                      var r = results[idx++];
                      name = r.c + '.' + r.docName;
                      docIdx[name]--;
                    }
                  }
                });
              }
            })(d);
            //if modifies is true and !cachedData?
            // Add document. Not sure how to han
          }

          // for each op in cache + firehose when op not older than query result
          //   check if op modifies collection.
          //     if yes or no: broadcast
          //     if unknown: issue mongo query with {_id:X}

          //console.log data
        };

        f();
        stream.on('readable', f);
        if (self.sdc) self.sdc.timing(sdcPrefix + '.subscribe', Date.now() - start);
        callback(null, emitter);
      });
    });
  };

  Livedb.prototype.query = function(index, query, opts, callback) {
    this.queryPoll(index, query, opts, callback);
  };

};
