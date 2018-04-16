var async = require('async');
var ShareDBError = require('../error');

export class Db {

    public pollDebounce: any;

    constructor(options) {
        // pollDebounce is the minimum time in ms between query polls
        this.pollDebounce = options && options.pollDebounce;
    }

    public static projectsSnapshots = false;
    public static disableSubscribe = false;

    public close(callback) {
        if (callback) callback();
    };

    public commit(collection, id, op, snapshot, options, callback) {
        callback(new ShareDBError(5011, 'commit DB method unimplemented'));
    };

    public getSnapshot(collection, id, fields, options, callback) {
        callback(new ShareDBError(5012, 'getSnapshot DB method unimplemented'));
    };

    public getSnapshotBulk(collection, ids, fields, options, callback) {
        var results = {};
        var db = this;
        async.each(ids, function (id, eachCb) {
            db.getSnapshot(collection, id, fields, options, function (err, snapshot) {
                if (err) return eachCb(err);
                results[id] = snapshot;
                eachCb();
            });
        }, function (err) {
            if (err) return callback(err);
            callback(null, results);
        });
    };

    public getOps(collection, id, from, to, options, callback) {
        callback(new ShareDBError(5013, 'getOps DB method unimplemented'));
    };

    public getOpsToSnapshot(collection, id, from, snapshot, options, callback) {
        var to = snapshot.v;
        this.getOps(collection, id, from, to, options, callback);
    };

    public getOpsBulk(collection, fromMap, toMap, options, callback) {
        var results = {};
        var db = this;
        async.forEachOf(fromMap, function (from, id, eachCb) {
            var to = toMap && toMap[id];
            db.getOps(collection, id, from, to, options, function (err, ops) {
                if (err) return eachCb(err);
                results[id] = ops;
                eachCb();
            });
        }, function (err) {
            if (err) return callback(err);
            callback(null, results);
        });
    };

    public getCommittedOpVersion(collection, id, snapshot, op, options, callback) {
        this.getOpsToSnapshot(collection, id, 0, snapshot, options, function (err, ops) {
            if (err) return callback(err);
            for (var i = ops.length; i--;) {
                var item = ops[i];
                if (op.src === item.src && op.seq === item.seq) {
                    return callback(null, item.v);
                }
            }
            callback();
        });
    };

    public query(collection, query, fields, options, callback) {
        callback(new ShareDBError(4022, 'query DB method unimplemented'));
    };

    public queryPoll(collection, query, options, callback) {
        var fields = {};
        this.query(collection, query, fields, options, function (err, snapshots, extra) {
            if (err) return callback(err);
            var ids:any = [];
            for (var i = 0; i < snapshots.length; i++) {
                ids.push(snapshots[i].id);
            }
            callback(null, ids, extra);
        });
    };

    public queryPollDoc(collection, id, query, options, callback) {
        callback(new ShareDBError(5014, 'queryPollDoc DB method unimplemented'));
    };

    public canPollDoc() {
        return false;
    };

    public skipPoll() {
        return false;
    };
}
