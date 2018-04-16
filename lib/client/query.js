"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var events_1 = require("events");
// Queries are live requests to the database for particular sets of fields.
//
// The server actively tells the client when there's new data that matches
// a set of conditions.
var Query = /** @class */ (function (_super) {
    __extends(Query, _super);
    function Query(action, connection, id, collection, query, options, callback) {
        var _this = _super.call(this) || this;
        // 'qf' or 'qs'
        _this.action = action;
        _this.connection = connection;
        _this.id = id;
        _this.collection = collection;
        // The query itself. For mongo, this should look something like {"data.x":5}
        _this.query = query;
        // A list of resulting documents. These are actual documents, complete with
        // data and all the rest. It is possible to pass in an initial results set,
        // so that a query can be serialized and then re-established
        _this.results = null;
        if (options && options.results) {
            _this.results = options.results;
            delete options.results;
        }
        _this.extra = undefined;
        // Options to pass through with the query
        _this.options = options;
        _this.callback = callback;
        _this.ready = false;
        _this.sent = false;
        return _this;
    }
    Query.prototype.hasPending = function () {
        return !this.ready;
    };
    ;
    // Helper for subscribe & fetch, since they share the same message format.
    //
    // This function actually issues the query.
    Query.prototype.send = function () {
        if (!this.connection.canSend)
            return;
        var message = {
            a: this.action,
            id: this.id,
            c: this.collection,
            q: this.query
        };
        if (this.options) {
            message.o = this.options;
        }
        if (this.results) {
            // Collect the version of all the documents in the current result set so we
            // don't need to be sent their snapshots again.
            var results = [];
            for (var i = 0; i < this.results.length; i++) {
                var doc = this.results[i];
                results.push([doc.id, doc.version]);
            }
            message.r = results;
        }
        this.connection.send(message);
        this.sent = true;
    };
    ;
    // Destroy the query object. Any subsequent messages for the query will be
    // ignored by the connection.
    Query.prototype.destroy = function (callback) {
        if (this.connection.canSend && this.action === 'qs') {
            this.connection.send({ a: 'qu', id: this.id });
        }
        this.connection._destroyQuery(this);
        // There is a callback for consistency, but we don't actually wait for the
        // server's unsubscribe message currently
        if (callback)
            process.nextTick(callback);
    };
    ;
    Query.prototype._onConnectionStateChanged = function () {
        if (this.connection.canSend && !this.sent) {
            this.send();
        }
        else {
            this.sent = false;
        }
    };
    ;
    Query.prototype._handleFetch = function (err, data, extra) {
        // Once a fetch query gets its data, it is destroyed.
        this.connection._destroyQuery(this);
        this._handleResponse(err, data, extra);
    };
    ;
    Query.prototype._handleSubscribe = function (err, data, extra) {
        this._handleResponse(err, data, extra);
    };
    ;
    Query.prototype._handleResponse = function (err, data, extra) {
        var callback = this.callback;
        this.callback = null;
        if (err)
            return this._finishResponse(err, callback);
        if (!data)
            return this._finishResponse(null, callback);
        var query = this;
        var wait = 1;
        var finish = function (err) {
            if (err)
                return query._finishResponse(err, callback);
            if (--wait)
                return;
            query._finishResponse(null, callback);
        };
        if (Array.isArray(data)) {
            wait += data.length;
            this.results = this._ingestSnapshots(data, finish);
            this.extra = extra;
        }
        else {
            for (var id in data) {
                wait++;
                var snapshot = data[id];
                var doc = this.connection.get(snapshot.c || this.collection, id);
                doc.ingestSnapshot(snapshot, finish);
            }
        }
        finish();
    };
    ;
    Query.prototype._ingestSnapshots = function (snapshots, finish) {
        var results = [];
        for (var i = 0; i < snapshots.length; i++) {
            var snapshot = snapshots[i];
            var doc = this.connection.get(snapshot.c || this.collection, snapshot.d);
            doc.ingestSnapshot(snapshot, finish);
            results.push(doc);
        }
        return results;
    };
    ;
    Query.prototype._finishResponse = function (err, callback) {
        this.emit('ready');
        this.ready = true;
        if (err) {
            this.connection._destroyQuery(this);
            if (callback)
                return callback(err);
            return this.emit('error', err);
        }
        if (callback)
            callback(null, this.results, this.extra);
    };
    ;
    Query.prototype._handleError = function (err) {
        this.emit('error', err);
    };
    ;
    Query.prototype._handleDiff = function (diff) {
        // We need to go through the list twice. First, we'll ingest all the new
        // documents. After that we'll emit events and actually update our list.
        // This avoids race conditions around setting documents to be subscribed &
        // unsubscribing documents in event callbacks.
        for (var i = 0; i < diff.length; i++) {
            var d = diff[i];
            if (d.type === 'insert')
                d.values = this._ingestSnapshots(d.values);
        }
        for (var i = 0; i < diff.length; i++) {
            var d = diff[i];
            switch (d.type) {
                case 'insert':
                    var newDocs = d.values;
                    Array.prototype.splice.apply(this.results, [d.index, 0].concat(newDocs));
                    this.emit('insert', newDocs, d.index);
                    break;
                case 'remove':
                    var howMany = d.howMany || 1;
                    var removed = this.results.splice(d.index, howMany);
                    this.emit('remove', removed, d.index);
                    break;
                case 'move':
                    var howMany = d.howMany || 1;
                    var docs = this.results.splice(d.from, howMany);
                    Array.prototype.splice.apply(this.results, [d.to, 0].concat(docs));
                    this.emit('move', docs, d.from, d.to);
                    break;
            }
        }
        this.emit('changed', this.results);
    };
    ;
    Query.prototype._handleExtra = function (extra) {
        this.extra = extra;
        this.emit('extra', extra);
    };
    ;
    return Query;
}(events_1.EventEmitter));
module.exports = Query;
