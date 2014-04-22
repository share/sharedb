var Readable = require('stream').Readable;

function doNothing() {};

// Bulk subscribe code is deprecated, but won't be removed until the bugs have
// been ironed out of the new listener code.


// This function is optional in snapshot dbs, so monkey-patch in a replacement
// if its missing
exports.mixinSnapshotFn = function(snapshotDb) {
  if (snapshotDb.bulkGetSnapshot == null) {
    snapshotDb.bulkGetSnapshot = function(requests, callback) {
      var results = {};

      var pending = 1;
      var done = function() {
        pending--;
        if (pending === 0) {
          callback(null, results);
        }
      };
      for (var cName in requests) {
        var docs = requests[cName];
        var cResults = results[cName] = {};

        pending += docs.length;

        // Hoisted by coffeescript... clever rabbit.
        var _fn = function(cResults, docName) {
          snapshotDb.getSnapshot(cName, docName, function(err, data) {
            if (err) return callback(err);

            if (data) {
              cResults[docName] = data;
            }
            done();
          });
        };
        for (var i = 0; i < docs.length; i++) {
          _fn(cResults, docs[i]);
        }
      }
      done();
    };
  }
};


exports.mixin = function(Livedb) {

  // requests is a map from collection name -> list of documents to fetch. The
  // callback is called with a map from collection name -> map from docName ->
  // data.
  //
  // I'm not getting ops in redis here for all documents - I certainly could.
  // But I don't think it buys us anything in terms of concurrency for the extra
  // redis calls.
  Livedb.prototype.bulkFetch = function(requests, callback) {
    var start = Date.now();
    var self = this;

    this.snapshotDb.bulkGetSnapshot(requests, function(err, results) {
      if (err) return callback(err);

      // We need to add {v:0} for missing snapshots in the results.
      for (var cName in requests) {
        var docs = requests[cName];
        for (var i = 0; i < docs.length; i++) {
          var docName = docs[i];

          if (!results[cName][docName]) results[cName][docName] = {v:0};
        }
      }

      if (self.sdc) self.sdc.timing('livedb.bulkFetch', Date.now() - start);
      callback(null, results);
    });
  };

  // Requests is a map from {cName:{doc1:version, doc2:version, doc3:version}, ...}
  Livedb.prototype.bulkSubscribe = function(requests, options, callback) {
    // Support old option-less subscribe semantics
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    if (this.sdc) this.sdc.increment('livedb.subscribe.bulk');

    var self = this;
    // So, I'm not sure if this is slow, but for now I'll use subscribeChannels
    // to subscribe to all the channels for all the documents, then make a stream
    // for each document that has been subscribed. It might turn out that the
    // right architecture is to reuse the stream, but filter in ShareJS (or
    // wherever) when things pop out of the stream, but thats more complicated to
    // implement. So fingers crossed that nodejs Stream objects are lightweight.

    var docStreams = {};
    var channels = [];
    var listener = function(channel, msg) {
      if (docStreams[channel]) {
        docStreams[channel].push(msg);
      }
    };

    for (var cName in requests) {
      var docs = requests[cName];
      for (var docName in docs) {
        if (this.sdc) this.sdc.increment('livedb.subscribe');

        var version = docs[docName];
        var channelName = Livedb.getDocOpChannel(cName, docName);
        var prefixedName = this._prefixChannel(channelName);

        channels.push(channelName);

        var docStream = docStreams[prefixedName] = new Readable({objectMode:true});
        docStream._read = doNothing;
        docStream.channelName = channelName;
        docStream.prefixedName = prefixedName;
        docStream.destroy = function() {
          self._removeStream(this);
          delete docStreams[this.prefixedName];
          self._redisRemoveChannelListeners(this.channelName, listener);
        };
        this._addStream(docStream);
      }
    }
    var onError = function(err) {
      var channel;
      for (channel in docStreams) {
        docStreams[channel].destroy();
      }
      callback(err);
    };

    // Could just use Object.keys(docStreams) here....
    this._redisAddChannelListeners(channels, listener, function(err) {
      if (err) return onError(err);

      self.bulkGetOpsSince(requests, function(err, ops) {
        if (err) return onError(err);

        // Map from cName -> docName -> stream.
        var result = {};
        var presence = {};
        for (var cName in requests) {
          var docs = requests[cName];
          result[cName] = {};
          presence[cName] = {};
          for (var docName in docs) {
            var version = docs[docName];
            var channelName = Livedb.getDocOpChannel(cName, docName);
            var prefixedName = self._prefixChannel(channelName)

            var stream = result[cName][docName] = docStreams[prefixedName];
            self._packOpStream(version, stream, ops[cName][docName]);
          }
        }
        if (options.wantPresence) {
          return self.bulkFetchPresence(requests, function(err, presence) {
            callback(err, result, presence);
          });
        }
        callback(null, result);
      });
    });
  };

  // SUPER DEPRECATED - use bulkFetch.
  //
  // Bulk fetch documents from the snapshot db. This function assumes that the
  // latest version of all the document snaphots are in the snapshot DB - it
  // doesn't get any missing operations from the oplog.
  Livedb.prototype.bulkFetchCached = function(cName, docNames, callback) {
    if (this.sdc) this.sdc.increment('livedb.bulkFetchCached');
    var self = this;

    if (this.snapshotDb.getBulkSnapshots) {
      this.snapshotDb.getBulkSnapshots(cName, docNames, function(err, results) {
        if (err) return callback(err);

        // Results is unsorted and contains any documents that exist in the
        // snapshot database.
        var map = {}; // Map from docName -> data
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          map[r.docName] = r;
        }

        var list = [];
        for (i = 0; i < docNames.length; i++) {
          list.push(map[docNames[i]] || {v:0});
        }
        callback(null, list);
      });
    } else {
      // Call fetch on all the documents.
      var results = new Array(docNames.length);
      var pending = docNames.length + 1;
      var abort = false;
      var _fn = function(i) {
        self.fetch(cName, docNames[i], function(err, data) {
          if (abort) return;
          if (err) {
            abort = true;
            return callback(err);
          }
          results[i] = data;
          pending--;
          if (pending === 0) {
            callback(null, results);
          }
        });
      };
      for (i = 0; i < docNames.length; i++) {
        _fn(i);
      }

      pending--;
      if (pending === 0) {
        callback(null, results);
      }
    }
  }


};
