var ot = require('./ot');
var util = require('./util');

module.exports = function(Livedb) {

  Livedb.prototype._updateCursors = function(cName, docName, type, opData) {
    var cd = util.encodeCD(cName, docName);
    var p = this.presenceCache[cd];
    ot.updatePresence(type, p, opData);
  };


  Livedb.prototype.submitPresence = function(cName, docName, pOp, callback) {
    var cd = util.encodeCD(cName, docName);
    var self = this;

    this._fetchPresence(cName, docName, function(err, p) {
      if (pOp.v == null || pOp.v === p.v) {
        // Support null / undefined version in opData
        apply();
      } else {
        this._getOps(cName, docName, pOp.v, null, apply);
      }

      function apply(err, ops) {
        if (err) return callback(err);

        if (ops) for (var i = 0; i < ops.length; i++) {
          err = ot.transformPresence('text', p, pOp, ops[i]);
          if (err) return callback(err);
        }

        // console.log("applyPresence", p, pOp);
        
        if ((err = ot.applyPresence(p, pOp))) return callback(err);
        var channel = Livedb.getDocOpChannel(cName, docName);
        // self.subscribers.emit(channel, channel, {v:pOp.v, pOp:pOp});
        // console.log("applyPresence", p, pOp);
        callback();
      }
    });
  };

  Livedb.prototype._fetchPresence = function(cName, docName, callback) {
    var cd = util.encodeCD(cName, docName);
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

};