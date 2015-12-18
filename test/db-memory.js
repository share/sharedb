var MemoryDB = require('../lib/db/memory');

require('./db')(function(callback) {
  var db = new MemoryDB();

  // Implement extremely simple subset of Mongo queries for unit tests
  db._querySync = function(snapshots, query) {
    if (!query) return snapshots;
    var filtered = filter(snapshots, query.$query || query);
    sort(filtered, query.$orderby);
    return filtered;
  };

  callback(null, db);
});

// Support exact key match filters only
function filter(snapshots, query) {
  return snapshots.filter(function(snapshot) {
    for (var key in query) {
      if (key.charAt(0) === '$') continue;
      if (!snapshot.data) return false;
      if (snapshot.data[key] !== query[key]) return false;
    }
    return true;
  });
}

// Support sorting with the Mongo $orderby syntax
function sort(snapshots, orderby) {
  if (!orderby) return;
  snapshots.sort(function(a, b) {
    for (var key in orderby) {
      var value = orderby[key];
      if (value !== 1 && value !== -1) {
        throw new Error('Invalid $orderby value');
      }
      if (a[key] > b[key]) return value;
      if (b[key] > a[key]) return -value;
    }
    return 0;
  });
}
