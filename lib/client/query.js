var emitter = require('../emitter');

// Queries are live requests to the database for particular sets of fields.
//
// The server actively tells the client when there's new data that matches
// a set of conditions.
module.exports = Query;
function Query(action, connection, id, collection, query, options, callback) {
  emitter.EventEmitter.call(this);

  // 'qf' or 'qs'
  this.action = action;

  this.connection = connection;
  this.id = id;
  this.collection = collection;

  // The query itself. For mongo, this should look something like {"data.x":5}
  this.query = query;

  // The db we actually hit. If this isn't defined, it hits the snapshot
  // database. Otherwise this can be used to hit another configured query
  // index.
  this.db = options.db;

  // A list of resulting documents. These are actual documents, complete with
  // data and all the rest. It is possible to pass in an initial results set,
  // so that a query can be serialized and then re-established
  this.results = options.results;
  this.extra = undefined;

  this.callback = callback;

  this.sent = false;
}
emitter.mixin(Query);

// Helper for subscribe & fetch, since they share the same message format.
//
// This function actually issues the query.
Query.prototype.send = function() {
  if (!this.connection.canSend) return;

  var msg = {
    a: this.action,
    id: this.id,
    c: this.collection,
    q: this.query
  };
  if (this.db != null) msg.db = this.db;
  if (this.results) {
    // Collect the version of all the documents in the current result set so we
    // don't need to be sent their snapshots again.
    var results = [];
    for (var i = 0; i < this.results.length; i++) {
      var doc = this.results[i];
      results.push([doc.id, doc.version]);
    }
    msg.r = results;
  }

  this.connection.send(msg);
  this.sent = true;
};

// Destroy the query object. Any subsequent messages for the query will be
// ignored by the connection.
Query.prototype.destroy = function(callback) {
  if (this.connection.canSend && this.action === 'qs') {
    this.connection.send({a: 'qu', id: this.id});
  }
  this.connection._destroyQuery(this);
};

Query.prototype._onConnectionStateChanged = function() {
  if (this.connection.canSend && !this.sent) {
    this.send();
  } else {
    this.sent = false;
  }
};

Query.prototype._handleFetch = function(err, data, extra) {
  var callback = this.callback;
  this.callback = null;
  // Once a fetch query gets its data, it is destroyed.
  this.connection._destroyQuery(this);
  if (err) {
    this.emit('ready');
    if (callback) return callback(err);
    return this.emit('error', err);
  }
  var results = this._dataToDocs(data);
  if (callback) callback(null, results, extra);
  this.emit('ready');
};

Query.prototype._handleSubscribe = function(err, data, extra) {
  var callback = this.callback;
  this.callback = null;
  if (err) {
    // Cleanup the query if the initial subscribe returns an error
    this.connection._destroyQuery(this);
    this.emit('ready');
    if (callback) return callback(err);
    return this.emit('error', err);
  }
  // Subscribe will only return results if issuing a new query without
  // previous results. On a resubscribe, changes to the results or ops will
  // have already been sent as individual diff events
  if (data) {
    this.results = this._dataToDocs(data);
    this.extra = extra
  }
  if (callback) callback(null, this.results, this.extra);
  this.emit('ready');
};

Query.prototype._handleDiff = function(err, diff, extra) {
  if (err) {
    return this.emit('error', err);
  }

  // Query diff data (inserts and removes)
  if (diff) {
    // We need to go through the list twice. First, we'll ingest all the
    // new documents and set them as subscribed.  After that we'll emit
    // events and actually update our list. This avoids race conditions
    // around setting documents to be subscribed & unsubscribing documents
    // in event callbacks.
    for (var i = 0; i < diff.length; i++) {
      var d = diff[i];
      if (d.type === 'insert') d.values = this._dataToDocs(d.values);
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
  }

  if (extra !== undefined) {
    this.emit('extra', extra);
  }
};

// Make a list of documents from the list of server-returned data objects
Query.prototype._dataToDocs = function(data) {
  var results = [];
  var lastType;
  for (var i = 0; i < data.length; i++) {
    var docData = data[i];

    // Types are only put in for the first result in the set and every time the type changes in the list.
    if (docData.type) {
      lastType = docData.type;
    } else {
      docData.type = lastType;
    }

    // This will ultimately call doc.ingestData(), which is what populates
    // the doc snapshot and version with the data returned by the query
    var doc = this.connection.get(docData.c || this.collection, docData.d, docData);
    results.push(doc);
  }
  return results;
};
