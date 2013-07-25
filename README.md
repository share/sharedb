# LIVE DB!

This is a database wrapper which exposes the API that realtime databases should
have.

You can submit operations (edit documents) and subscribe to documents.
Subscribing gives you a stream of all operations applied to theh given
document. You can also make queries, which give you a feed of changes in the
result set while the query is open.

Currently this is very new and only used by ShareJS. To use it, you need a
snapshot database wrapper. The obvious choice is mongodb. A database wrapper
for mongo is available in
[share/livedb-mongo](https://github.com/share/livedb-mongo).


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


### Snapshot backend, operation logs and query backends

Oh my.

LiveDB lets you store your documents and operations wherever you want. It can
use custom query sources to back its live queries. Some of these APIs are in
flux at the moment - **Document ME!**

### Creating documents

To create a document, you first need to submit a create operation to the
document to set its type. A document doesn't properly exist until it has a type
--- it certainly can't store any data.

A create operation looks like this: `{create:{type:TYPE, [data:INITIAL DATA]}, [v:VERSION]}`. The type should be something accessible in the map returned by require('ottypes'), for example `json0` or `http://sharejs.org/types/textv1`. Specifying initial data is optional. If provided, it is passed to the type's `create()` method. This does what you expect - for JSON documents, pass your initial object here. For text documents, pass a string containing the document's contents. As with all operations, the version is optional. You probably don't want to specify the version for a create message.

For example:

```javascript
livedb.submit('users', 'fred', {create:{type:'json0', data:[1,2,3]}}, function(err, version, transformedByOps, snapshot) {
  // I made a document, ma!
});
```

Since documents implicitly exist with no type at version 0, usually the create message will increment the version from 0 to 1. Not all documents you want to delete have a version of 0 - if a document is deleted, it will retain its version.

### Deleting documents

Deleting documents is similar to creating them. A deleted document has no type and no data, but will retain its version (actually, the delete operation will bump the document's version). A delete operation looks like this: `{del:true, [v:VERSION]}`.

```javascript
livedb.submit('users', 'fred', {del:true}, function(err) {
  //goneskies! Kapow!
});
```

### Editing documents

You edit a document by submitting an operation. Operations are OT type-specific JSON blobs. Refer to the documentation on the particular OT type for details. For example, text documents are documented [here](https://github.com/share/ottypes/blob/master/lib/text.js#L10-L16). If we had a text document stored in LiveDB and wanted to edit it, it might look like this:

```javascript
livedb.submit('love letters', 'dear fred', {op:[6, "You never return my calls!"], v:1002}, function(err) {
  // ...
});
```

You should always specify the version when submitting operations. If you don't, operations will do funny things in the face of concurrency.


