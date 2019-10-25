var MemoryDB = require('../lib/db/memory');

module.exports = BasicQueryableMemoryDB;

// Extension of MemoryDB that supports query filters and sorts on simple
// top-level properties, which is enough for the core ShareDB tests on
// query subscription updating.
function BasicQueryableMemoryDB() {
  MemoryDB.apply(this, arguments);
}
BasicQueryableMemoryDB.prototype = Object.create(MemoryDB.prototype);
BasicQueryableMemoryDB.prototype.constructor = BasicQueryableMemoryDB;

BasicQueryableMemoryDB.prototype._querySync = function(snapshots, query) {
  if (query.filter) {
    snapshots = snapshots.filter(function(snapshot) {
      return querySnapshot(snapshot, query);
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

BasicQueryableMemoryDB.prototype.queryPollDoc = function(collection, id, query, options, callback) {
  var db = this;
  process.nextTick(function() {
    var snapshot = db._getSnapshotSync(collection, id);
    try {
      var matches = querySnapshot(snapshot, query);
    } catch (err) {
      return callback(err);
    }
    callback(null, matches);
  });
};

BasicQueryableMemoryDB.prototype.canPollDoc = function(collection, query) {
  return !query.sort;
};

function querySnapshot(snapshot, query) {
  // Never match uncreated or deleted snapshots
  if (snapshot.type == null) return false;
  // Match any snapshot when there is no query filter
  if (!query.filter) return true;
  // Check that each property in the filter equals the snapshot data
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
}

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
