var deepEquals = require('deep-is');
var arraydiff = require('arraydiff');
var util = require('./util');

function QueryEmitter(request, stream, snapshots, extra) {
  this.backend = request.backend;
  this.agent = request.agent;
  this.db = request.db;
  this.index = request.index;
  this.query = request.query;
  this.collection = request.collection;
  this.fields = request.fields;
  this.options = request.options;
  this.snapshotProjection = request.snapshotProjection
  this.stream = stream;
  this.ids = pluckIds(snapshots);
  this.extra = extra;

  this.skipPoll = this.options.skipPoll || util.doNothing;
  this.canPollDoc = this.db.canPollDoc(this.collection, this.query);
  this.pollDebounce =
    (this.options.pollDebounce != null) ? this.options.pollDebounce :
    (this.db.pollDebounce != null) ? this.db.pollDebounce : 0;

  this._polling = false;
  this._pollAgain = false;
  this._pollTimeout = null;

  this.startStream();
}
module.exports = QueryEmitter;

QueryEmitter.prototype.destroy = function() {
  this.stream.destroy();
};

QueryEmitter.prototype.startStream = function() {
  var emitter = this;
  function readStream() {
    var data;
    while (data = emitter.stream.read()) {
      if (data.error) {
        console.error('Error in query op stream:', emitter.index, emitter.query);
        this.emitError(data.error);
        continue;
      }
      emitter.emitOp(data);
      emitter.update(data);
    }
  }
  readStream();
  emitter.stream.on('readable', readStream);
};

QueryEmitter.prototype._emitTiming = function(action, start) {
  this.backend.emit('timing', action, Date.now() - start, this.index, this.query);
};

QueryEmitter.prototype.update = function(op) {
  var id = op.d;
  // Ignore if the user or database say we don't need to poll
  try {
    if (this.skipPoll(this.collection, id, op, this.query)) return;
    if (this.db.skipPoll(this.collection, id, op, this.query)) return;
  } catch (err) {
    console.error('Error evaluating skipPoll:', this.collection, id, op, this.query);
    return this.emitError(err);
  }
  if (this.canPollDoc) {
    // We can query against only the document that was modified to see if the
    // op has changed whether or not it matches the results
    this.queryPollDoc(id);
  } else {
    // We need to do a full poll of the query, because the query uses limits,
    // sorts, or something special
    this.queryPoll();
  }
};

QueryEmitter.prototype._flushPoll = function() {
  if (this._polling || this._pollTimeout) return;
  if (this._pollAgain) this.queryPoll();
};

QueryEmitter.prototype._finishPoll = function(err) {
  this._polling = false;
  if (err) this.emitError(err);
  this._flushPoll();
};

QueryEmitter.prototype.queryPoll = function() {
  var emitter = this;

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
  if (this.pollDebounce) {
    this._pollTimeout = setTimeout(function() {
      emitter._pollTimeout = null;
      emitter._flushPoll();
    }, this.pollDebounce);
  }

  var start = Date.now();
  this.db.queryPoll(this.collection, this.query, this.options, function(err, ids, extra) {
    if (err) return emitter._finishPoll(err);
    emitter._emitTiming('query.poll', start);

    var idsDiff = arraydiff(emitter.ids, ids);
    if (idsDiff.length) {
      emitter.ids = ids;
      var inserted = getInserted(idsDiff);
      if (inserted.length) {
        emitter.db.getSnapshotBulk(emitter.collection, inserted, emitter.fields, function(err, snapshotMap) {
          if (err) return emitter._finishPoll(err);
          emitter.backend._sanitizeSnapshotBulk(emitter.agent, emitter.index, emitter.snapshotProjection, emitter.collection, snapshotMap, function(err) {
            if (err) return emitter._finishPoll(err);
            emitter._emitTiming('query.pollGetSnapshotBulk', start);
            var diff = mapDiff(idsDiff, snapshotMap);
            emitter.emitDiff(diff);
            emitter._finishPoll();
          });
        });
      } else {
        emitter.emitDiff(idsDiff);
        emitter._finishPoll();
      }
    }
    // Be nice to not have to do this in such a brute force way
    if (!deepEquals(emitter.extra, extra)) {
      emitter.extra = extra;
      emitter.emitExtra(extra);
    }
  });
};

QueryEmitter.prototype.queryPollDoc = function(id) {
  var emitter = this;
  var start = Date.now();
  this.db.queryPollDoc(this.collection, id, this.query, this.options, function(err, matches) {
    if (err) return emitter.emitError(err);
    emitter._emitTiming('query.pollDoc', start);

    // Check if the document was in the previous results set
    var i = emitter.ids.indexOf(id);

    if (i === -1 && matches) {
      // Add doc to the collection. Order isn't important, so we'll just whack
      // it at the end
      var index = emitter.ids.push(id) - 1;
      // We can get the result to send to the client async, since there is a
      // delay in sending to the client anyway
      emitter.db.getSnapshot(emitter.collection, id, emitter.fields, function(err, snapshot) {
        if (err) return emitter.emitError(err);
        emitter._emitTiming('query.pollDocGetSnapshot', start);
        var values = [snapshot];
        emitter.emitDiff([new arraydiff.InsertDiff(index, values)]);
      });

    } else if (i !== -1 && !matches) {
      emitter.ids.splice(i, 1);
      emitter.emitDiff([new arraydiff.RemoveDiff(i, 1)]);
    }
  });
};

// Emit functions are called in response to operation events
QueryEmitter.prototype.emitError = function(err) {
  this.onError(err);
};
QueryEmitter.prototype.emitDiff = function(diff) {
  this.onDiff(diff);
};
QueryEmitter.prototype.emitExtra = function(extra) {
  this.onExtra(extra);
};
QueryEmitter.prototype.emitOp = function(op) {
  if (this.ids.indexOf(op.d) === -1) return;
  this.onOp(op);
};

// Clients should define these functions
QueryEmitter.prototype.onError = util.doNothing;
QueryEmitter.prototype.onDiff = util.doNothing;
QueryEmitter.prototype.onExtra = util.doNothing;
QueryEmitter.prototype.onOp = util.doNothing;

function pluckIds(snapshots) {
  var ids = [];
  for (var i = 0; i < snapshots.length; i++) {
    ids.push(snapshots[i].id);
  }
  return ids;
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

function mapDiff(idsDiff, snapshotMap) {
  var diff = [];
  for (var i = 0; i < idsDiff.length; i++) {
    var item = idsDiff[i];
    if (item instanceof arraydiff.InsertDiff) {
      var values = [];
      for (var j = 0; j < item.values.length; j++) {
        var id = item.values[j];
        values.push(snapshotMap[id]);
      }
      diff.push(new arraydiff.InsertDiff(item.index, values));
    } else {
      diff.push(item);
    }
  }
  return diff;
}
