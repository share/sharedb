# LIVE DB!

Livedb is a database wrapper which exposes the API that realtime databases should
have. All database access from ShareJS (and hence racer and derby apps) goes
through a livedb client.

Livedb lets submit operations (edit documents) and subscribe to documents.
Subscribing gives you a stream of all operations applied to the given
document, as they happen. You can also make live bound queries, which give you
the results of your query and a feed of changes to the result set over time.

To use it, you need a database to actually store your data in.
A database wrapper for mongo is available in
[share/livedb-mongo](https://github.com/share/livedb-mongo). I hope to add more
over time.

If you want to mess about, livedb also has an in-memory database backend you
can use. The in-memory database stores all documents and operations in memory
forever (or at least, until you restart your server - at which point all
documents and operations are lost.)

For questions, discussion and announcements, join the [ShareJS mailing list](https://groups.google.com/forum/?fromgroups#!forum/sharejs).

Please report any bugs you find to the [issue tracker](https://github.com/share/livedb/issues).


## Quick tour

```javascript
var livedb = require('livedb');
var db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});

backend = livedb.client(db);

backend.fetchAndSubscribe('users', 'fred', function(err, data, stream) {
  // Data is simply {v:0} because the fred document doesn't exist yet.

  stream.on('data', function(op) {
    // We'll see all changes to the fred document as they happen
    console.log('Fred was edited by the operation', op);
  });
});


// This could happen from a different process / server but only if you use the
// redis driver. (Otherwise they won't see each other's changes and everything
// breaks)
backend.submit('users', 'fred', {v:0, create:{type:'json0', data:{name:'Fred'}}}, function(err) {
  // Created with data {name:'Fred'}

  // Other concurrent edits can happen too, and they'll all be merged using OT.
  // This operations says at doc['name'][4], insert characters ' Flintstone'.
  backend.submit('users', 'fred', {v:1, op:[{p:['name', 4], si:' Flintstone'}]}, function(err) {
    // users.fred now has data {name:'Fred Flintstone'}
  });
});
```


## Data Model

In LiveDB's view of the world, every document has 3 properties:

- **version**: an incrementing number starting at 0
- **type**: an OT type. OT types are defined in
[share/ottypes](https://github.com/share/ottypes). Types are referenced using
their URIs (even though those URIs don't actually mean anything). Documents
which don't exist implicitly have a type of `null`.
- **data**: The actual data that the document contains. This must be pure
acyclic JSON. Its also type-specific. (JSON type uses raw JSON, text documents
use a string, etc).

LiveDB implicitly has a record for every document you can access. New documents
have version 0, a null type and no data. To use a document, you must first
submit a *create operation*, which will set the document's type and give it
initial data. Then you can submit editing operations on the document (using
OT). Finally you can delete the document with a delete operation. By
default, livedb stores all operations forever - nothing is truly deleted.

---

## Using Livedb

Livedb requires 3 puzzle pieces to operate:

- A snapshot database, to store actual documents.
- An oplog to store historical operations. We currently require that operations
  are stored forever, but I want to change this before 1.0. (It might work
  today, but we're missing tests).
- A livedb driver. If you have multiple servers, the driver manages
  communication between them all. The driver also makes commits atomic (so
  servers won't clobber each other's changes) and publishes operations.  If you
  only have one frontend server, you can use the inprocess driver. (This is the
  default if you do not specify a driver.)

You can put operations and snapshot data in different places if you want, but
its easier to put all of your data in the same database.

The backend database(s) needs to implement a [simple API which has
documentation and a sample implementation
here](https://github.com/share/livedb/blob/master/lib/memory.js). Currently the
only database binding is [livedb-mongo](https://github.com/share/livedb-mongo).

A livedb client is created using either an options object or a database
backend. If you specify a database backend, its used as both oplog and
snapshot.

```javascript
db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
backend = livedb.client(db);
```

This is the equivalent to this:

```javascript
db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
backend = livedb.client({db:db});
// Also equivalent to livedb.client({snapshotDb:db, oplog:db});
```

You can use a different database for both snapshots and operations if you want:

```javascript
snapshotdb = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
oplog = {writeOp:..., getVersion:..., getOps:...};
backend = livedb.client({snapshotDb:snapshotdb, oplog:oplog});
```

All of the above examples will use the in-process driver by default. If you
want to scale across multiple frontend servers, you should use the redis driver:

```javascript
var redis = require('redis');
client1 = redis.createClient(6379, '192.168.1.123', auth_pass:'secret');
client2 = redis.createClient(6379, '192.168.1.123', auth_pass:'secret');

driver = livedb.redisDriver(oplog, client1, client2);
backend = livedb.client({snapshotDb:snapshotdb, driver:driver});
```

The redis driver needs 2 redis clients because redis can't use the same
connection for commands and pubsub. [See node-redis documentation for help
configuring
redis](https://github.com/mranney/node_redis#rediscreateclientport-host-options).


The options object can also be passed:

- **extraDbs:** *{name:query db}* This is used to register extra database
  backends which will be notified whenever operations are submitted. They can
  also be used in queries.
- **sdc:** A pre-configured
  [node-statsd-client](https://github.com/msiebuhr/node-statsd-client) client
  to send monitoring information. Note that the events livedb logs to statsd
  are not considered part of the public API, and may change at any time.

### Creating documents

To create a document, you need to submit a create operation to the
document to set its type. In livedb's world, a document doesn't exist until it
has a type set.

A create operation looks like this: `{create:{type:TYPE, [data:INITIAL DATA]}, [v:VERSION]}`. The type should be something accessible in the map returned by require('ottypes'), for example `json0` or `http://sharejs.org/types/textv1`. Specifying initial data is optional. If provided, it is passed to the type's `create()` method. This does what you expect - for JSON documents, pass your initial object here. For text documents, pass a string containing the document's contents. As with all operations, the version is optional. You probably don't want to specify the version for a create message.

To submit any changes to documents, you use `livedb.submit(cName, docName, opData, callback)`.

For example:

```javascript
livedb.submit('users', 'fred', {create:{type:'json0', data:[1,2,3]}}, function(err, version, transformedByOps, snapshot) {
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
livedb.submit('users', 'fred', {del:true}, function(err) {
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
livedb.submit('love letters', 'dear fred', {op:[6, "You never return my calls!"], v:1002}, function(err) {
  // ...
});
```

You should always specify the version when submitting edit operations. The
version is technically optional - if its missing, your operation will be
submitted against the most recent version of the document in the server. This
is useful for creating a document which may already exist, but for normal edits
you should always specify the expected current version of the document.


### Getting a document

You can fetch the most recent version of a document using `livedb.fetch(cName, docName, callback)` or
`livedb.bulkFetch(request, callback)`. This will fetch the document(s) from the snapshot database
and fetch all operations which may or may not have been committed.

Fetch returns a snapshot data object via its callback. The snapshot data object
has the following fields:

- **v:** version. This is an integer (starting at 0) containing the version of the document
- **type:** Document type, if set. This field is missing if the document does not exist.
- **data:** The document's actual data. For JSON documents this is a JSON tree.
  For text documents this is a string. This field is missing if the document does not exist.

```javascript
livedb.fetch('users', 'fred', function(err, snapshot) {
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
livedb.bulkFetch({users:['fred', 'wilma', 'homer'], admins:['zerocool']}, function(err, results) {
  // results will be {users:{fred:..., wilma:..., homer:...}, admins:{zerocool:...}}.
  // Each document has v and optional type and data fields like fetch (above).
});
```


### Getting historic changes to a document

You can get old versions of a document (for playback or catching up a client)
using `livedb.getOps(cName, docName, from, to, callback)`. This will return
all operations which have been applied to the named document in the requested range.
The range is *open*, so `getOps('users', 'fred', 0, 3, ..)` will return all
operations up to (but not including) 3. (Ie, operations 0, 1 and 2).

If you set the *to* field to null, getOps will get all operations up to the
current version.

Livedb documents always start at version 0, so you can get a document's entire history using `getOps('users', fred', 0, null, callback);`.

If you set *to* to a version in the future, behaviour is not defined.

Example usage:

```javascript
livedb.submit('users', 'fred', {create:{type:'json0', data:{name:'Fred'}}}, function(err) {
  livedb.submit('users', 'fred', {v:1, op:[{p:['name', 4], si:' Flintstone'}]}, function(err) {
    // ...
  });
});

// ---- Sometime later...

livedb.getOps('users', 'fred', 0, null, function(err, ops) {
  // ops contains the two operations which were submitted above:
  // [{v:0, create:{...}, {v:1, op:[...]}]
});
```

### Streaming changes to a document in realtime

You can subscribe to changes from a document using
`livedb.subscribe(cName, docName, v, callback)` or
`livedb.bulkSubscribe(request, callback)`. When you subscribe, you get an
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
livedb.fetch('users', 'fred', function(err, data) {
  if (err) { ... }
  var version = data.v;

  // ... Any amount of time later (literally).
  livedb.subscribe('users', 'fred', version, function(err, stream) {
    if (err) { ... }

    // stream is a nodejs ReadableStream with all operations that happen to
    // users.fred.

    stream.on('data', function(opData) {
      // The opData is a JSON object, the same object you can pass to submit().
      // It always has a v: field.

      // Livedb exports a helper function to apply the operation to some
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
Livedb.prototype.fetchAndSubscribe = function(cName, docName, callback) {
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

Livedb supports running live queries against the database. It can re-run queries when it suspects that a query's results might have changed - and notify the caller with any changes to the result set.

This is incredibly inefficient and I want to completely rewrite / rework them. For now, I recommend against using live bound queries in a production app with a decent load. I'll document them when I'm happier with them.


### Projections

Livedb supports exposing a *projection* of a real collection, with a specified
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
livedb.addProjection('users_limited', 'users', 'json0', {name:true, profileUrl:true});
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
- The third parameter must be 'json0'.
- Projections can only limit / allow fields at the top level of the document

