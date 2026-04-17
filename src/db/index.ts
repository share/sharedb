import async = require('async');
import ShareDBError = require('../error');

var ERROR_CODE = ShareDBError.CODES;

class DB {
  /** pollDebounce is the minimum time in ms between query polls */
  pollDebounce;

  constructor(options) {
    this.pollDebounce = options && options.pollDebounce;
  }

  /** When false, Backend will handle projections instead of DB */
  declare projectsSnapshots;

  static {
    DB.prototype.projectsSnapshots = false;
  }

  declare disableSubscribe;

  static {
    DB.prototype.disableSubscribe = false;
  }

  close(callback) {
    if (callback) callback();
  }

  commit(collection, id, op, snapshot, options, callback) {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, 'commit DB method unimplemented'));
  }

  getSnapshot(collection, id, fields, options, callback) {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, 'getSnapshot DB method unimplemented'));
  }

  getSnapshotBulk(collection, ids, fields, options, callback) {
    var results = Object.create(null);
    var db = this;
    async.each(ids, function(id, eachCb) {
      db.getSnapshot(collection, id, fields, options, function(err, snapshot) {
        if (err) return eachCb(err);
        results[id] = snapshot;
        eachCb();
      });
    }, function(err) {
      if (err) return callback(err);
      callback(null, results);
    });
  }

  getOps(collection, id, from, to, options, callback) {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, 'getOps DB method unimplemented'));
  }

  getOpsToSnapshot(collection, id, from, snapshot, options, callback) {
    var to = snapshot.v;
    this.getOps(collection, id, from, to, options, callback);
  }

  getOpsBulk(collection, fromMap, toMap, options, callback) {
    var results = Object.create(null);
    var db = this;
    async.forEachOf(fromMap, function(from, id, eachCb) {
      var to = toMap && toMap[id];
      db.getOps(collection, id, from, to, options, function(err, ops) {
        if (err) return eachCb(err);
        results[id] = ops;
        eachCb();
      });
    }, function(err) {
      if (err) return callback(err);
      callback(null, results);
    });
  }

  getCommittedOpVersion(collection, id, snapshot, op, options, callback) {
    this.getOpsToSnapshot(collection, id, 0, snapshot, options, function(err, ops) {
      if (err) return callback(err);
      for (var i = ops.length; i--;) {
        var item = ops[i];
        if (op.src === item.src && op.seq === item.seq) {
          return callback(null, item.v);
        }
      }
      callback();
    });
  }

  query(collection, query, fields, options, callback) {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, 'query DB method unimplemented'));
  }

  queryPoll(collection, query, options, callback) {
    var fields = Object.create(null);
    this.query(collection, query, fields, options, function(err, snapshots, extra) {
      if (err) return callback(err);
      var ids = [];
      for (var i = 0; i < snapshots.length; i++) {
        ids.push(snapshots[i].id);
      }
      callback(null, ids, extra);
    });
  }

  queryPollDoc(collection, id, query, options, callback) {
    callback(new ShareDBError(ERROR_CODE.ERR_DATABASE_METHOD_NOT_IMPLEMENTED, 'queryPollDoc DB method unimplemented'));
  }

  canPollDoc() {
    return false;
  }

  skipPoll() {
    return false;
  }
}

export = DB;
