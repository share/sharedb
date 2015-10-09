var async = require('async');

var UNIMPLEMENTED = {code: 5000, message: 'DB method unimplemented'};

function DB(options) {
  // pollDebounce is the minimum time in ms between query polls
  this.pollDebounce = options && options.pollDebounce;
}
module.exports = DB;

DB.prototype.projectsSnapshots = false;
DB.prototype.disableSubscribe = false;

DB.prototype.close = function() {};

DB.prototype.commit = function(collection, id, op, snapshot, callback) {
  callback(UNIMPLEMENTED);
};

DB.prototype.getSnapshot = function(collection, id, fields, callback) {
  callback(UNIMPLEMENTED);
};

DB.prototype.getSnapshotBulk = function(collection, ids, fields, callback) {
  var results = {};
  var db = this;
  async.each(ids, function(id, eachCb) {
    db.getSnapshot(collection, id, fields, function(err, snapshot) {
      if (err) return eachCb(err);
      results[id] = snapshot;
      eachCb();
    });
  }, function(err) {
    callback(err, err ? null : results);
  });
};

DB.prototype.getOps = function(collection, id, from, to, callback) {
  callback(UNIMPLEMENTED);
};

DB.prototype.getOpsToSnapshot = function(collection, id, from, snapshot, callback) {
  var to = snapshot.v;
  this.getOps(collection, id, from, to, callback);
};

DB.prototype.getOpsBulk = function(collection, fromMap, toMap, callback) {
  var results = {};
  var db = this;
  async.forEachOf(fromMap, function(from, id, eachCb) {
    var to = toMap && toMap[id];
    db.getOps(collection, id, from, to, function(err, ops) {
      if (err) return eachCb(err);
      results[id] = ops;
      eachCb();
    });
  }, function(err) {
    callback(err, err ? null : results);
  });
};

DB.prototype.query = function(collection, query, fields, options, callback) {
  callback(UNIMPLEMENTED);
};

DB.prototype.queryPoll = function(collection, query, options, callback) {
  var fields = {};
  this.query(collection, query, fields, function(err, snapshots, extra) {
    if (err) return callback(err);
    var ids = [];
    for (var i = 0; i < snapshots.length; i++) {
      ids.push(snapshots[i].id);
    }
    callback(null, ids, extra);
  });
};

DB.prototype.queryPollDoc = function(collection, id, query, options, callback) {
  callback(UNIMPLEMENTED);
};

DB.prototype.canPollDoc = function() {
  return false;
};

DB.prototype.skipPoll = function() {
  return false;
};
