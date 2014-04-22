var async = require('async');
var ot = require('./ot');

function doNothing() {};

module.exports = function(Livedb) {

  Livedb.prototype._updateCursors = function(cName, docName, type, opData) {
    var cd = Livedb.encodeCD(cName, docName);
    var p = this.presenceCache[cd];
    ot.updatePresence(type, p, opData);
  };


  Livedb.prototype.submitPresence = function(cName, docName, pOp, callback) {
    if (!callback) callback = doNothing;
    var cd = Livedb.encodeCD(cName, docName);
    var self = this;

    this._fetchPresence(cName, docName, function(err, p) {
      if (pOp.v == null || pOp.v === p.v) {
	// Support null / undefined version in opData
	apply();
      } else {
	self._getOps(cName, docName, pOp.v, null, apply);
      }

      function apply(err, ops) {
	if (err) return callback(err);

	if (ops) for (var i = 0; i < ops.length; i++) {
	  err = ot.transformPresence('text', p, pOp, ops[i]);
	  if (err) return callback(err);
	}

	// console.log("applyPresence", p, pOp);

	if ((err = ot.applyPresence(p, pOp))) return callback(err);
	var channel = self._prefixChannel(Livedb.getDocOpChannel(cName, docName));

	// Ugly hax. Rewrite.
	self.subscribers.emit(channel, channel, {pOp:pOp});
	// console.log("applyPresence", p, pOp);
	callback();
      }
    });
  };

  Livedb.prototype._fetchPresence = function(cName, docName, callback) {
    var cd = Livedb.encodeCD(cName, docName);
    if (this.presenceCache[cd]) {
      return callback(null, this.presenceCache[cd]);
    }

    var self = this;
    this.oplog.getVersion(cName, docName, function(err, version) {
      self.presenceCache[cd] = {v:version, data:{}};
      callback(null, self.presenceCache[cd]);
    });
  };

  Livedb.prototype.fetchPresence = function(cName, docName, callback) {
    this._fetchPresence(cName, docName, function(err, p) {
      callback(err, p ? p.data : null);
    });
  };

  // Fetch the presence information for multiple documents.
  //
  // requests - A map of the form `{cName:{doc1:version, doc2:version, ...}, ...}`.
  // callback - A node style callback function.
  Livedb.prototype.bulkFetchPresence = function(requests, callback) {
    var self = this;
    // async.map doesn't support objects :(
    var result = {};
    async.each(Object.keys(requests), function(cName, outerCb) {
      result[cName] = {};
      async.each(Object.keys(requests[cName]), function(docName, innerCb) {
        self.fetchPresence(cName, docName, function(err, presence) {
          if (err) return innerCb(err);
          result[cName][docName] = presence;
          innerCb();
        });
      }, outerCb);
    }, function(err) {
      if (err) return callback(err);

      callback(null, result);
    });
  };

};
