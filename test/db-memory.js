var expect = require('expect.js');
var DB = require('../lib/db');
var MemoryDB = require('../lib/db/memory');

describe('DB base class', function() {
  it('can call db.close() without callback', function() {
    var db = new DB();
    db.close();
  });

  it('can call db.close() with callback', function(done) {
    var db = new DB();
    db.close(done);
  });

  it('returns an error if db.commit() is unimplemented', function(done) {
    var db = new DB();
    db.commit('testcollection', 'test', {}, {}, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getSnapshot() is unimplemented', function(done) {
    var db = new DB();
    db.getSnapshot('testcollection', 'foo', null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getOps() is unimplemented', function(done) {
    var db = new DB();
    db.getOps('testcollection', 'foo', 0, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.query() is unimplemented', function(done) {
    var db = new DB();
    db.query('testcollection', {x: 5}, null, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.queryPollDoc() is unimplemented', function(done) {
    var db = new DB();
    db.queryPollDoc('testcollection', 'foo', {x: 5}, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });
});

require('./db')(function(callback) {
  var db = new MemoryDB();

  // Implement extremely simple subset of Mongo queries for unit tests
  db._querySync = function(snapshots, query) {
    var filtered = filter(snapshots, query.$query || query);
    sort(filtered, query.$orderby);
    return filtered;
  };

  db.queryPollDoc = function(collection, id, query, options, callback) {
    this.getSnapshot(collection, id, null, function(err, snapshot) {
      if (err) return callback(err);
      var result = filterSnapshot(snapshot, query);
      callback(null, result);
    });
  };

  db.canPollDoc = function(collection, query) {
    return !query.$orderby;
  };

  callback(null, db);
});

// Support exact key match filters only
function filter(snapshots, query) {
  return snapshots.filter(function(snapshot) {
    return filterSnapshot(snapshot, query);
  });
}

function filterSnapshot(snapshot, query) {
  if (!snapshot.data) return false;
  for (var key in query) {
    if (key.charAt(0) === '$') continue;
    if (snapshot.data[key] !== query[key]) return false;
  }
  return true;
}

// Support sorting with the Mongo $orderby syntax
function sort(snapshots, orderby) {
  if (!orderby) return;
  snapshots.sort(function(snapshotA, snapshotB) {
    for (var key in orderby) {
      var value = orderby[key];
      if (value !== 1 && value !== -1) {
        throw new Error('Invalid $orderby value');
      }
      var a = snapshotA.data && snapshotA.data[key];
      var b = snapshotB.data && snapshotB.data[key];
      if (a > b) return value;
      if (b > a) return -value;
    }
    return 0;
  });
}
