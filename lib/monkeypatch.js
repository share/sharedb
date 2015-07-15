var async = require('async');
var projections = require('./projections');

// Monkeypatch db implementations missing optional features. This is more
// efficient and simpler to code around internal to livedb than constantly
// checking what is implemented in each function call

exports.snapshotDb = function(snapshotDb) {
  // Note that order here is significant
  patchProjections(snapshotDb);
  patchGetSnapshots(snapshotDb);
  patchQueryPoll(snapshotDb);
};

function patchProjections(snapshotDb) {
  if (snapshotDb.implementsProjection) return;
  // Set implementsProjection to make sure we don't patch multiple times
  snapshotDb.implementsProjection = true;

  var query = snapshotDb.query;
  snapshotDb.query = function(cName, inputQuery, fields, options, callback) {
    if (!fields) {
      return query.call(this, cName, inputQuery, null, options, callback);
    }
    query.call(this, cName, inputQuery, null, options, function(err, results, extra) {
      if (err) return callback(err);
      try {
        for (var i = 0; i < results.length; i++) {
          projections.projectSnapshot(fields, results[i]);
        }
      } catch (err) {
        return callback(err);
      }
      callback(null, results, extra);
    });
  };

  var getSnapshot = snapshotDb.getSnapshot;
  snapshotDb.getSnapshot = function(cName, docName, fields, callback) {
    if (!fields) {
      return getSnapshot.call(this, cName, docName, null, callback);
    }
    getSnapshot.call(this, cName, docName, null, function(err, snapshot) {
      if (err) return callback(err);
      try {
        projections.projectSnapshot(fields, snapshot);
      } catch (err) {
        return callback(err);
      }
      callback(null, snapshot);
    });
  };

  var getSnapshots = snapshotDb.getSnapshots;
  // No need to patch getSnapshots if it isn't defined. We will patch it later
  // by calling our patch of getSnapshot multiple times, so the results will
  // end up getting projected
  if (!getSnapshots) return;
  snapshotDb.getSnapshots = function(cName, docNames, fields, callback) {
    if (!fields) {
      return getSnapshots.call(this, cName, docNames, null, callback);
    }
    getSnapshots.call(this, cName, docNames, null, function(err, snapshots) {
      if (err) return callback(err);
      try {
        for (var i = 0; i < snapshots.length; i++) {
          projections.projectSnapshot(fields, snapshots[i]);
        }
      } catch (err) {
        return callback(err);
      }
      callback(null, snapshots);
    });
  };
}

function patchGetSnapshots(snapshotDb) {
  if (snapshotDb.getSnapshots) return;

  snapshotDb.getSnapshots = function(cName, docNames, fields, callback) {
    var self = this;
    async.each(docNames, function(docName, eachCb) {
      self.getSnapshot(cName, docName, fields, eachCb);
    }, callback);
  };
}

function patchQueryPoll(snapshotDb) {
  if (!snapshotDb.query) return;

  if (!snapshotDb.queryPoll) {
    snapshotDb.queryPoll = function(cName, query, options, callback) {
      this.query(cName, query, {}, function(err, results, extra) {
        if (err) return callback(err);
        var docNames = [];
        for (var i = 0; i < results.length; i++) {
          docNames.push(results[i].docName);
        }
        callback(null, docNames, extra);
      });
    }
  }

  if (!snapshotDb.queryPollDoc) {
    snapshotDb.queryPollDoc = function(cName, docName, query, options, callback) {
      this.queryPoll(cName, queryPoll, options, function(err, docNames) {
        if (err) return callback(err);
        var matches = docNames.indexOf(docName) > -1;
        callback(null, matches);
      });
    }
  }
}
