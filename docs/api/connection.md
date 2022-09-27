---
title: Connection
layout: default
parent: API
---

# Connection
{: .no_toc }

1. TOC
{:toc}

## Properties

### `agent` -- [`Agent`]({{ site.baseurl }}{% link api/agent.md %})

> The [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) associated with this `Connection`.

{: .warn }
> This property is **only** populated if the `Connection` is running on the server, and was created through [`backend.connect()`]({{ site.baseurl }}{% link api/backend.md %}#connect()).

## Methods

### get()

Get a [`Doc`]({{ site.baseurl }}{% link api/doc.md %}) instance for the given `collection` and `id`.

```js
collection.get(collection, id)
```

{: .warn }
Calling `get()` multiple times on the same `Connection` instance will return the **same** `Doc` instance for a given `collection` and `id`.

`collection` -- string

> The name of the collection

`id` -- string

> The ID of the document

Return value

> A [`Doc`]({{ site.baseurl }}{% link api/doc.md %}) instance

### createFetchQuery()

Fetch query results from the server.

```js
connection.createFetchQuery(collection, query [, options [, callback]])
```

`collection` -- string

> The name of the collection

`query` -- Object

> A query object, whose format will depend on the [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) being used

{: .d-inline-block }
`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.results` -- [`Doc`]({{ site.baseurl }}{% link api/doc.md %})[]

> > Prior query results, if available, such as from server rendering. This should be an array of Doc instances, as obtained from  `connection.get(collection, id)`. If the docs' data is already available, invoke [`ingestSnapshot`]({{ site.baseurl }}{% link api/doc.md %}#ingestsnapshot) for each Doc instance beforehand to avoid re-transferring the data from the server.

> `options.*` -- any

> > All other options are passed through to the [database adapter]({{ site.baseurl }}{% link adapters/database.md %})

Return value

> A [`Query`]({{ site.baseurl }}{% link api/query.md %}) instance

### createSubscribeQuery()

Fetch query results from the server, and subscribe to changes.

```js
connection.createSubscribeQuery(collection, query [, options [, callback]])
```

`collection` -- string

> The name of the collection

`query` -- Object

> A query object, whose format will depend on the [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) being used

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.results` -- [`Doc`]({{ site.baseurl }}{% link api/doc.md %})[]

> > Prior query results, if available, such as from server rendering. This should be an array of Doc instances, as obtained from `connection.get(collection, id)`. If the docs' data is already available, invoke [`ingestSnapshot`]({{ site.baseurl }}{% link api/doc.md %}#ingestsnapshot) for each Doc instance beforehand to avoid re-transferring the data from the server.

> `options.*` -- any

> > All other options are passed through to the [database adapter]({{ site.baseurl }}{% link adapters/database.md %})

Return value

> A [`Query`]({{ site.baseurl }}{% link api/query.md %}) instance

### fetchSnapshot()

Fetch a read-only snapshot of a document at the requested version.

```js
connection.fetchSnapshot(collection, id [, version [, callback]])
```

`collection` -- string

> The name of the collection

`id` -- string

> The ID of the document

{: .d-inline-block }

`version` -- number

Optional
{: .label .label-grey }

> Default: most recent version

> The snapshot version to fetch

`callback` -- Function

> ```js
> function(error, snapshot) { ... }
> ```

> A callback called with the requested [`Snapshot`]({{ site.baseurl }}{% link api/snapshot.md %})

### fetchSnapshotByTimestamp()

Fetch a read-only snapshot of a document at the requested version.

```js
connection.fetchSnapshot(collection, id [, timestamp [, callback]])
```

`collection` -- string

> The name of the collection

`id` -- string

> The ID of the document

{: .d-inline-block }

`timestamp` -- number

Optional
{: .label .label-grey }

> Default: most recent version

> The timestamp of the desired snapshot. The returned snapshot will be the latest snapshot before the provided timestamp.

`callback` -- Function

> ```js
> function(error, snapshot) { ... }
> ```

> A callback called with the requested [`Snapshot`]({{ site.baseurl }}{% link api/snapshot.md %})

### getPresence()

Get a [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance that can be used to subscribe to presence information from other clients, and create instances of [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}).

```js
connection.getPresence(channel)
```

`channel` -- string

> The channel associated with this presence. All [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instances subscribed to the same channel will receive the same notifications

Return value

> A [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance for the given `channel`

### getDocPresence()

Get a special [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance tied to a given document.

This can be used to subscribe to presence information from other clients, and create instances of [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}).

Presence updates are synchronized with ops to keep presence current, and avoid "flickering" -- where presence updates and ops arrive out-of-order.

```js
connection.getDocPresence(collection, id)
```

{: .warn }
The document **must** be of a [type]({{ site.baseurl }}{% link types/index.md %}) that supports [presence]({{ site.baseurl }}{% link presence.md %}).

`collection` -- string

> The collection of the document

`id` --- string

> The document ID

Return value

> A [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance tied to the given document

### ping()

Send a short message to the server, which will respond with another short message, emitted on the connection as a
`'pong'` event.

```js
connection.ping()
connection.on('pong', () => {
  // The server is still there
})
```

{: .warn }
Calling `ping()` when not connected will throw an error with code `ERR_CANNOT_PING_OFFLINE`.
