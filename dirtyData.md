# Dirty Lists

Livedb lets you append to your own consumable journal when operations are
applied. This is designed so you can keep external indexes (like SOLR) up to
date when your data changes.

The idea is that whenever an operation is applied, information about the
operation is added to a 'dirty list' - which is a list of documents which need
to be reindexed / updated in some external store. The dirty list is basically a
journal. Consuming data in the journal has at-least-once semantics, so if your
process crashes / errors in some way, you'll never lose data. (This is
important so your secondary index never goes out of sync).

## Adding data to the dirty list

You can append to the list by defining `getDirtyDataPre` or `getDirtyData` in
the livedb options object:

```javascript
options.getDirtyData = function(cName, docName, opData, snapshot) {
  return {
    listName: {list data},
    ...
  }
};
```

**getDirtyData** is called synchronously whenever an operation is applied. It
returns an object which maps from dirty list name -> stored JSON. For example:

```javascript
options.getDirtyData = function(cName, docName, opData, snapshot) {
  if (cName === 'users') {
    return {"names": {id:docName, firstname:snapshot.data.firstname}};
  }
}
```

In this case, when a user is edited, we'll append the user's new first name to
the 'names' dirty list.

**getDirtyDataPre** is identical to getDirtyData, except (like preValidate),
it is called before the operation has been applied to the snapshot instead of
after.


## Consuming the dirty list

You can consume the contents of the dirty list by calling **consumeDirtyData**:

```javascript
livedbclient.consumeDirtyData(listName, options, consumeFn, callback);
```

The consume function is passed (dataList, callback).

for example:

```javascript
var consume = function(data, callback) {
  // Data is [{id:.., firstname:...}, {id:..., firstname:...}]

  // ... processing

  callback();
}

livedb.client.consumeDirtyData('names', {}, consume, function(err) {...});
```

If your consume function fails, next time you call consumeDirtyData you'll get the same data again.

The options argument takes two optional arguments:

- **limit: N**: limits the number of items to be consumed to N. By default, the
redis driver limits to reading 1024 items at a time.
- **wait: true**: If there's no data, ordinarily consumeDirtyData calls your
callback immediately without calling consume. If you set wait:true, the process
will wait until there's dirty data, then call your consume function, then call
your callback.


## CAVEATS:

DO NOT USE dirty lists with the inprocess driver in production. Although this
API is implemented by the inprocess livedb driver, the dirty list is stored in
memory. As a result, all dirty operations are lost when your process restarts.

In comparison, the redis driver stores the dirty list in redis, which is
resiliant to server restarts. For now, use redis if you want to use this in any
sort of production environment.

Each dirty list should have at most one consumer. You can run each consumer in
its own process, but each list can't have more than one concurrent call to
consume() across all processes.

Don't modify the operation or the snapshot in getDirtyData or getDirtyDataPre

You can define both getDirtyData and getDirtyDataPre, but you cannot append to
the same dirty list from both places.
