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
