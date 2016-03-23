# ShareDB

  [![NPM Version](https://img.shields.io/npm/v/sharedb.svg)](https://npmjs.org/package/sharedb)
  [![Build Status](https://travis-ci.org/share/sharedb.svg?branch=master)](https://travis-ci.org/share/sharedb)
  [![Coverage Status](https://coveralls.io/repos/github/share/sharedb/badge.svg?branch=master)](https://coveralls.io/github/share/sharedb?branch=master)

ShareDB is a realtime database backend based on [Operational Transformation
(OT)](https://en.wikipedia.org/wiki/Operational_transformation) of JSON
documents. It is the realtime backend for the [DerbyJS web application
framework](http://derbyjs.com/).

For questions, discussion and announcements, join the [ShareJS mailing
list](https://groups.google.com/forum/?fromgroups#!forum/sharejs).

Please report any bugs you find to the [issue
tracker](https://github.com/share/sharedb/issues).


## Features

- Realtime synchronization of any JSON document
- Concurrent multi-user collaboration
- Synchronous editing API with asynchronous eventual consistency
- Realtime query subscriptions
- Simple integration with any database - [MongoDB](https://github.com/share/sharedb-mongo)
- Horizontally scalable with pub/sub integration - [Redis](https://github.com/share/sharedb-redis-pubsub)
- Projections to select desired fields from documents and operations
- Middleware for implementing access control and custom extensions
- Ideal for use in browsers or on the server
- Reconnection of document and query subscriptions
- Offline change syncing upon reconnection
- In-memory implementations of database and pub/sub for unit testing


## Quick tour

```js
var ShareDB = require('sharedb');
var db = require('sharedb-mongo')('localhost:27017/test');

var backend = ShareDB({db: db});
var connection = backend.connect();

// Subscribe to any database query
var query = connection.createSubscribeQuery('users', {accountId: 'acme'});

query.once('ready', function() {
  // Initially matching documents
  console.log(query.results);
});
query.on('insert', function(docs, index) {
  // Documents that now match the query
  console.log(docs);
});
query.on('remove', function(docs, index) {
  // Documents that no longer match the query
  console.log(docs);
});
query.on('move', function(docs, from, to) {
  // Documents that were moved in the results order for sorted queries
  console.log(docs);
});

// Create and modify documents with synchronously applied operations
var doc = connection.get('users', 'jane');
doc.create({accountId: 'acme', name: 'Jane'});
doc.submitOp({p: ['email'], oi: 'jane@example.com'});

// Create multiple concurrent connections to the same document for
// collaborative editing by multiple clients
var connection2 = backend.connect();
var doc2 = connection2.get('users', 'jane');

// Subscribe to documents directly as well as through queries
doc2.subscribe(function(err) {
  // Current document data
  console.log(doc2.data);
});
doc2.on('op', function(op, source) {
  // Op that changed the document
  console.log(op);
  // truthy if submitted locally and `false` if from another client
  console.log(source);
});
```

## Data model

In ShareDB's view of the world, every document has 3 properties:

- **version** - An incrementing number starting at 0
- **type** - An OT type. OT types are defined in
[share/ottypes](https://github.com/share/ottypes). Documents
which don't exist implicitly have a type of `null`.
- **data** - The actual data that the document contains. This must be pure
acyclic JSON. Its also type-specific. (JSON type uses raw JSON, text documents
use a string, etc).

ShareDB implicitly has a record for every document you can access. New documents
have version 0, a null type and no data. To use a document, you must first
submit a *create operation*, which will set the document's type and give it
initial data. Then you can submit editing operations on the document (using
OT). Finally you can delete the document with a delete operation. By
default, ShareDB stores all operations forever - nothing is truly deleted.


## Operations

See https://github.com/ottypes/json0 for documentation of the supported operations.


<!-- Old docs from LiveDB:

## Using ShareDB

### Creating documents

To create a document, you need to submit a create operation to the
document to set its type. In sharedb's world, a document doesn't exist until it
has a type set.

A create operation looks like this: `{create:{type:TYPE, [data:INITIAL DATA]}, [v:VERSION]}`. The type should be something accessible in the map returned by require('ottypes'), for example `json0` or `http://sharejs.org/types/textv1`. Specifying initial data is optional. If provided, it is passed to the type's `create()` method. This does what you expect - for JSON documents, pass your initial object here. For text documents, pass a string containing the document's contents. As with all operations, the version is optional. You probably don't want to specify the version for a create message.

To submit any changes to documents, you use `sharedb.submit(cName, docName, opData, callback)`.

For example:

```javascript
sharedb.submit('users', 'fred', {create:{type:'json0', data:[1,2,3]}}, function(err, version, transformedByOps, snapshot) {
  // I made a document, ma!
});
```

Since documents implicitly exist with no type at version 0, usually the create
message will increment the version from 0 to 1. Not all documents you want to
delete have a version of 0 - if a document is deleted, it will retain its
version.

### Deleting documents

Deleting documents is similar to creating them. A deleted document has no type
and no data, but will retain its version (actually, the delete operation will
bump the document's version). A delete operation looks like this:
`{del:true, [v:VERSION]}`.

You use the same submit function as above to delete documents:

```javascript
sharedb.submit('users', 'fred', {del:true}, function(err) {
  //goneskies! Kapow!
});
```

### Editing documents

You edit a document by submitting an operation. Operations are OT type-specific
JSON blobs. Refer to the documentation on the particular OT type for details.
For example, text documents are documented
[here](https://github.com/share/ottypes/blob/master/lib/text.js#L10-L16). If we
had a text document stored in LiveDB and wanted to edit it, it might look like
this:

```javascript
sharedb.submit('love letters', 'dear fred', {op:[6, "You never return my calls!"], v:1002}, function(err) {
  // ...
});
```

You should always specify the version when submitting edit operations. The
version is technically optional - if its missing, your operation will be
submitted against the most recent version of the document in the server. This
is useful for creating a document which may already exist, but for normal edits
you should always specify the expected current version of the document.


### Getting a document

You can fetch the most recent version of a document using `sharedb.fetch(cName, docName, callback)` or
`sharedb.bulkFetch(request, callback)`. This will fetch the document(s) from the snapshot database
and fetch all operations which may or may not have been committed.

Fetch returns a snapshot data object via its callback. The snapshot data object
has the following fields:

- **v:** version. This is an integer (starting at 0) containing the version of the document
- **type:** Document type, if set. This field is missing if the document does not exist.
- **data:** The document's actual data. For JSON documents this is a JSON tree.
  For text documents this is a string. This field is missing if the document does not exist.

```javascript
sharedb.fetch('users', 'fred', function(err, snapshot) {
  // snapshot has {v:123, type:'...', data:{name:'Fred Flintstone'}}
  // If the document doesn't exist, only the v:version field will exist in the data.
});
```

If you need to get many documents, its more efficient to issue bulk fetches. To
pass the set of requested documents to bulkFetch, you need to make a request
object which maps collection names to lists of documents you want in that
collection. For example, to get 'red', 'green' and 'blue' from the colors
collection, you would make a bulkFetch request of `{colors:['red', 'green',
'blue']}`.

The response maps each collection name to a set of snapshots. Each set of
snapshots maps document names to snapshot data objects. Continuing our colors
example above, the response could be `{colors:{red:{v:0}, green:{v:10, type:..., data:"emerald"}, blue:{v:1, type:..., data:{favorite:true}}}}`.

For example:

```javascript
sharedb.bulkFetch({users:['fred', 'wilma', 'homer'], admins:['zerocool']}, function(err, results) {
  // results will be {users:{fred:..., wilma:..., homer:...}, admins:{zerocool:...}}.
  // Each document has v and optional type and data fields like fetch (above).
});
```


### Getting historic changes to a document

You can get old versions of a document (for playback or catching up a client)
using `sharedb.getOps(cName, docName, from, to, callback)`. This will return
all operations which have been applied to the named document in the requested range.
The range is *open*, so `getOps('users', 'fred', 0, 3, ..)` will return all
operations up to (but not including) 3. (Ie, operations 0, 1 and 2).

If you set the *to* field to null, getOps will get all operations up to the
current version.

ShareDB documents always start at version 0, so you can get a document's entire history using `getOps('users', fred', 0, null, callback);`.

If you set *to* to a version in the future, behaviour is not defined.

Example usage:

```javascript
sharedb.submit('users', 'fred', {create:{type:'json0', data:{name:'Fred'}}}, function(err) {
  sharedb.submit('users', 'fred', {v:1, op:[{p:['name', 4], si:' Flintstone'}]}, function(err) {
    // ...
  });
});

// Sometime later...

sharedb.getOps('users', 'fred', 0, null, function(err, ops) {
  // ops contains the two operations which were submitted above:
  // [{v:0, create:{...}, {v:1, op:[...]}]
});
```

### Streaming changes to a document in realtime

You can subscribe to changes from a document using
`sharedb.subscribe(cName, docName, v, callback)` or
`sharedb.bulkSubscribe(request, callback)`. When you subscribe, you get an
operation stream which gets packed with operations as they happen.

When you subscribe to a document, you need to specify which version you're
subscribing to the document *from*. The version cannot be in the future.

The stream will be populated with each operation from the requested version
onwards (to infinity and beyond). Each operation will appear in the stream
exactly once. If you subscribe and request an old document version, all
operations from that version to the current version will be buffered in the
stream before the stream is returned to the callback.

You usually want to call *subscribe* after fetching a document. Pass the
document version that you got from calling *fetch* into your call to
*subscribe*.

For example:

```javascript
sharedb.fetch('users', 'fred', function(err, data) {
  if (err) { ... }
  var version = data.v;

  // ... Any amount of time later (literally).
  sharedb.subscribe('users', 'fred', version, function(err, stream) {
    if (err) { ... }

    // stream is a nodejs ReadableStream with all operations that happen to
    // users.fred.

    stream.on('data', function(opData) {
      // The opData is a JSON object, the same object you can pass to submit().
      // It always has a v: field.

      // ShareDB exports a helper function to apply the operation to some
      // snapshot data:
      var err = ldb.ot.apply(data, opData);
      if (err) { ... }
    });
  });
});
```

**Important!** To avoid leaking memory, when you're done with a stream call `stream.destroy()` to clean it up.

There is a helper method which will both fetch and subscribe for you (cleverly
called `fetchAndSubscribe(cName, docName, callback)`). It is defined like this:

```javascript
ShareDB.prototype.fetchAndSubscribe = function(cName, docName, callback) {
  var self = this;
  this.fetch(cName, docName, function(err, data) {
    if (err) return callback(err);
    self.subscribe(cName, docName, data.v, function(err, stream) {
      callback(err, data, stream);
    });
  });
};
```

It calls your callback with `(err, snapshot, stream)`, giving you both the current document snapshot and the stream of operations from the current version.

#### Bulk Subscribe

If you want to subscribe to multiple documents at once, you should call
`bulkSubscribe(request, callback)`. The bulk subscribe request is a map from
cName -> map from docName -> version. For example, `{colors: {red:5, blue:6,
green:0}}`. The response is a map from cName -> map from docName -> stream.
For example, `{colors: {red:<stream>, blue:<stream>, green:<stream>}}`.
bulkSubscribe will either return a stream for all requested objects or (if
there was an error), none of them.

Again, remember to call `stream.destroy()` on all streams returned by bulk
subscribe when you're done with them.


### Queries

ShareDB supports running live queries against the database. It can re-run queries when it suspects that a query's results might have changed - and notify the caller with any changes to the result set.

This is incredibly inefficient and I want to completely rewrite / rework them. For now, I recommend against using live bound queries in a production app with a decent load. I'll document them when I'm happier with them.


### Projections

ShareDB supports exposing a *projection* of a real collection, with a specified
(limited) set of allowed fields. Once configured, the projected collection
looks just like a real collection - except documents only have the fields
you've requested.

Operations (gets, queries, sets, etc) on the fake collection work, but you only
see a small portion of the data. You can use this to drop server & db load
dramatically and speed up page times. Its similar to SQL VIEWs. For now, this
only works on JSON documents. (I don't know what it would look like for text
documents).

For example, you could make a `users_limited` projection which lets users view
each other's names and profile pictures, but not password hashes. You would
configure this by calling:

```javascript
sharedb.addProjection('users_limited', 'users', 'json0', {name:true, profileUrl:true});
```

However, be aware that on its own **this is not sufficient for access control**. If
users are still allowed to make arbitrary mongo queries against the projected
collection, they can find out any data in the hidden fields.

Configure a projection by calling `addProjection(projCName, realCName, type, fields)`.

- **projCName:** The projected collection name. (Eg, `users_limited`)
- **realCName:** The underlying collection name
- **type:** The OT type. Only JSON0 is supported for now.
- **fields:** A map of the allowed fields in documents. The keys in this map
  represent the field names, and the values should be `true`.

Limitations:

- You can only whitelist fields (not blacklist them).
- Projections can only limit / allow fields at the top level of the document

## Error codes

ShareDB returns errors as plain JavaScript objects with the format:
```
{
  code: 5000,
  message: 'ShareDB internal error'
}
```

Additional fields may be added to the error object for debugging context depending on the error. Common additional fields include `collection`, `id`, and `op`.

### 4000 - Bad request

* 4001 -

### 5000 - Internal error

The `41xx` and `51xx` codes are reserved for use by ShareDB DB adapters, and the `42xx` and `52xx` codes are reserved for use by ShareDB PubSub adapters.

* 5001 - No new ops returned when retrying unsuccessful submit

-->
