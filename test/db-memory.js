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
    db.commit('testcollection', 'test', {}, {}, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getSnapshot() is unimplemented', function(done) {
    var db = new DB();
    db.getSnapshot('testcollection', 'foo', null, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getOps() is unimplemented', function(done) {
    var db = new DB();
    db.getOps('testcollection', 'foo', 0, null, null, function(err) {
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


// Extension of MemoryDB that supports query filters and sorts on simple
// top-level properties, which is enough for the core ShareDB tests on
// query subscription updating.
function BasicQueryableMemoryDB() {
  MemoryDB.apply(this, arguments);
}
BasicQueryableMemoryDB.prototype = Object.create(MemoryDB.prototype);
BasicQueryableMemoryDB.prototype.constructor = BasicQueryableMemoryDB;

BasicQueryableMemoryDB.prototype._querySync = function(snapshots, query, options) {
  if (query.filter) {
    snapshots = snapshots.filter(function(snapshot) {
      for (var queryKey in query.filter) {
        // This fake only supports simple property equality filters, so
        // throw an error on Mongo-like filter properties with dots.
        if (queryKey.includes('.')) {
          throw new Error('Only simple property filters are supported, got:', queryKey);
        }
        if (snapshot.data[queryKey] !== query.filter[queryKey]) {
          return false;
        }
      }
      return true;
    });
  }

  if (query.sort) {
    if (!Array.isArray(query.sort)) {
      throw new Error('query.sort must be an array');
    }
    if (query.sort.length) {
      snapshots.sort(snapshotComparator(query.sort));
    }
  }

  return {snapshots: snapshots};
};

// sortProperties is an array whose items are each [propertyName, direction].
function snapshotComparator(sortProperties) {
  return function(snapshotA, snapshotB) {
    for (var i = 0; i < sortProperties.length; i++) {
      var sortProperty = sortProperties[i];
      var sortKey = sortProperty[0];
      var sortDirection = sortProperty[1];

      var aPropVal = snapshotA.data[sortKey];
      var bPropVal = snapshotB.data[sortKey];
      if (aPropVal < bPropVal) {
        return -1 * sortDirection;
      } else if (aPropVal > bPropVal) {
        return sortDirection;
      } else if (aPropVal === bPropVal) {
        continue;
      } else {
        throw new Error('Could not compare ' + aPropVal + ' and ' + bPropVal);
      }
    }
    return 0;
  };
}

// Run all the DB-based tests against the BasicQueryableMemoryDB.
require('./db')({
  create: function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    var db = new BasicQueryableMemoryDB(options);
    callback(null, db);
  },
  getQuery: function(options) {
    return {filter: options.query, sort: options.sort};
  }
});
