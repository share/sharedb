# Upgrading from ShareJS to ShareDB 1.0

If you're using ShareJS 0.6, upgrade to ShareDB 1.0 for:
* stability and future improvement
* ability to run with multiple processes (coordinated via Redis)
* queries

If you're using ShareJS 0.7, upgrade to ShareDB 1.0 for
stability and future improvements.

This document describes the database and API changes from ShareJS 0.7
to ShareDB 1.0

## Database changes

### Migrating snapshots

The way snapshots are stored in the database hasn't changed, other than one
small detail: The `'_o'` property is now reserved as a pointer to the last
operation committed on the snapshot. Snapshots that lack the `'_o'` property
will continue to work fine, but make sure to remove any application-level
`'_o'` properties.

### Migrating ops

The way ops are stored in the database has changed between ShareJS 0.7 and ShareDB 1.0. The tl;dr is: Don’t try to migrate your ops.

Here’s the longer story: ShareJS used Redis for the commit process, and only one op was stored in the database for each version. ShareDB can potentially store more than one op for each version but only one of them is pointed to from the snapshot itself. Snapshots without ops work totally fine, unless you're doing something particular with the ops history.

## API changes

The ShareDB API is documented in the main [README](https://github.com/share/sharedb#server-api). When unsure, look there.

### Initialization

The code to start a server instance and client has changed. See the main [README](https://github.com/share/sharedb#server-api) for more information.

### Top-level API

The following methods have been replaced by methods on the [client API](https://github.com/share/sharedb#client-api):
* `livedb.submit()`, replaced by `doc.submitOp()` and `doc.delete()`
* `livedb.subscribe()` and `livedb.fetchAndSubscribe`, replaced by `doc.subscribe()`
* `livedb.bulkSubscribe()`, replaced by `connection.startBulk(); ...; connection.endBulk()`. Currently undocumented
* `livedb.queryFetch()` and `livedb.querySubscribe()`, replaced by `connection.createFetchQuery()` and `connection.createSubscribeQuery()`

The following methods have been replaced by methods directly on the [database adapter](https://github.com/share/sharedb#database-adapters)
* `livedb.fetch`, replaced by `db.getSnapshot()`
* `livedb.bulkFetch`, replaced by `db.getSnapshotBulk()`
* `livedb.getOps`, replaced by `db.getOps()`

And a few more changes:
* `addProjection()` no longer takes an OT type in the third argument
* `buildSnapshot()` is no longer available.

### Doc API

* `doc.snapshot` replaced by `doc.data`
* `doc.state` is no longer available
* `doc.name` replaced by `doc.id`
* `doc.getSnapshot()` replaced by `doc.data`
* `doc.whenReady(...)` replaced by `doc.on('load', ...)`
* `doc.create()` changed arguments: (data, type, ...) instead of (type, data, ...)
* `doc.on()`:
  * `after op` replaced by `op`
  * `created` replaced by `create`
  * `subscribed` replaced by `load`

### Connection API

* `connection.disconnect()` replaced by `connection.close()`
* `connection.getOrCreate()` no longer takes in optional inital data. Instead, call  `doc.ingestSnapshot`.

### Query API

* `new Query`: first argument is now `'fetch'` or `'sub'` instead of `'qf'` or `'qs'`
* `query.setQuery` is no longer available

### Middleware API

* No more middleware actions for `'fetch'`, `'submit'`, `'subscribe'`, `'get ops'`, `'query'`.
* There's a new action called `'receive'` that fires on all client actions.
* `'filter()'` is replaced by the middleware action `'doc'`
* `'filterOps()'` is replaced by the middleware action `'op'`
* Changes to request properties:
  * No more `req.backend` — instead, look at `req.agent.backend`
  * `req.docName` replaced by `req.id`

### Agent API

* `agent.trigger()` is now `share.trigger()`
* Generally, don’t use the Agent API directly — instead create a client
