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
