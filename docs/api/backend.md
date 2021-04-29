---
title: Backend
layout: default
parent: API
---

# Backend
{: .no_toc }

1. TOC
{:toc}

The `Backend` class represents the server-side instance of ShareDB. It is primarily responsible for connecting to clients, and sending requests to the [database adapters]({{ site.baseurl }}{% link adapters/database.md %}).

It is also responsible for some [configuration](#backend-constructor), setting up [middleware]({{ site.baseurl }}{% link middleware/index.md %}) and defining [projections]({{ site.baseurl }}{% link projections.md %}).

## Backend() constructor

```js
var Backend = require('sharedb')
new Backend([options])
```

### Options

{: .d-inline-block }

`db` -- [DB]({{ site.baseurl }}{% link adapters/database.md %})

Optional
{: .label .label-grey }

> Default: new `MemoryDB` instance

> An instance of a ShareDB [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) that provides the data store for ShareDB

{: .warn }
> The default option -- a new `MemoryDB` instance -- is a **non-persistent**, in-memory adapter and should **not** be used in production environments.

{: .d-inline-block }

`pubsub` -- [PubSub]({{ site.baseurl }}{% link adapters/pub-sub.md %})

Optional
{: .label .label-grey }

> Default: new `MemoryPubSub` instance

> An instance of a ShareDB [Pub/Sub adapter]({{ site.baseurl }}{% link adapters/pub-sub.md %}) that provides a channel for notifying other ShareDB instances of changes to data.

{: .info }
> The default option -- a new `MemoryPubSub` instance -- is an in-memory adapter.
>
> Unlike the [database adapter](#db--db), the in-memory Pub/Sub adapter *may* be used in a production environment, where Pub/Sub state need only persist across a single, stand-alone server.

{: .d-inline-block }

`milestoneDb` -- [MilestoneDB]({{ site.baseurl }}{% link adapters/milestone.md %})

Optional
{: .label .label-grey }

> Default: `null`

> An instance of a ShareDB [milestone adapter]({{ site.baseurl }}{% link adapters/milestone.md %}) that provides the data store for [milestone snapshots]({{ site.baseurl }}{% link document-history.md %}#milestone-snapshots), which are historical snapshots of documents stored at a specified version interval.

{: .info }
> If this option is omitted, milestone snapshots will **not** be enabled, but document history *may* still be accessed with a potential [performance penalty]({{ site.baseurl }}{% link document-history.md %}#milestone-snapshots).

{: .d-inline-block }

`extraDbs` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> An object whose values are extra `DB` instances which can be [queried]({{ site.baseurl }}{% link api/query.md %}). The keys are the names that can be passed into the query options `db` field

{: .d-inline-block }

`suppressPublish` -- boolean

Optional
{: .label .label-grey }

> Default: `false`

> If set to `true`, any changes committed will *not* be published on [Pub/Sub]({{ site.baseurl }}{% link pub-sub.md %})

{: .d-inline-block }

`maxSubmitRetries` -- number

Optional
{: .label .label-grey }

> Default: `null`

> The number of times to allow a submit to be retried. If omitted, the request will retry an unlimited number of times

{: .d-inline-block }

`presenceEnabled` -- boolean

Optional
{: .label .label-grey }

> Default: `false`

> If set to `true`, enables [Presence]({{ site.baseurl }}{% link presence.md %}) functionality

## Properties

### `MIDDLEWARE_ACTIONS` -- Object

> Map of available [middleware actions]({{ site.baseurl }}{% link middleware/actions.md %})

## Methods

### connect()

Connects to ShareDB and returns an instance of a [`Connection`]({{ site.baseurl }}{% link api/connection.md %}) client for interacting with ShareDB. This is the server-side equivalent of `new Connection(socket)` in the browser.

```js
backend.connect([connection [, request]])
```

{: .d-inline-block }

`connection` -- [Connection]({{ site.baseurl }}{% link api/connection.md %})

Optional
{: .label .label-grey }

> Default: a new [`Connection`]({{ site.baseurl }}{% link api/connection.md %}) instance

> A [`Connection`]({{ site.baseurl }}{% link api/connection.md %}) instance to bind to the `Backend`

{: .d-inline-block }

`request` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> A connection context object that can contain information such as cookies or session data that will be made available in the [middleware]({{ site.baseurl }}{% link middleware/index.md %}) on [`agent.custom`]({{ site.baseurl }}{% link api/agent.md %}#custom)

Return value

Returns a [`Connection`]({{ site.baseurl }}{% link api/connection.md %})

### listen()

Registers a [`Stream`](https://nodejs.org/api/stream.html) with the backend. This should be called when the server receives a new connection from a client.

```js
backend.listen(stream [, request])
```

`stream` -- [Stream](https://nodejs.org/api/stream.html)

> A [`Stream`](https://nodejs.org/api/stream.html) (or `Stream`-like object) that will be used to communicate between the new [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) and the `Backend`

{: .d-inline-block }

`request` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> A connection context object that can contain information such as cookies or session data that will be made available in the [middleware]({{ site.baseurl }}{% link middleware/index.md %}) on [`agent.custom`]({{ site.baseurl }}{% link api/agent.md %}#custom)

Return value

Returns an [`Agent`]({{ site.baseurl }}{% link api/agent.md %}), which will also be available in the [middleware]({{ site.baseurl }}{% link middleware/index.md %})

### close()

Disconnects ShareDB and all of its underlying services (database, Pub/Sub, etc.).

```js
backend.close([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the services have stopped, or with an error if at least one of them could not be stopped

### use()

Registers [middleware]({{ site.baseurl }}{% link middleware/index.md %}).

```js
backend.use(action, middleware)
```

`action` -- string \| string[]

> An action, or array of action names defining when to apply the middleware

`middleware` -- Function

> ```js
> function(context, next) {
>   next(error)
> }
> ```

> A [middleware]({{ site.baseurl }}{% link middleware/index.md %}) function

addProjection()

Adds a [projection]({{ site.baseurl }}{% link projections.md %})

```js
backend.addProjection(name, collection, fields)
```

`name` -- string

> The name of the projection

`collection` -- string

> The name of the collection on which to apply the projection

`fields` -- Object

> A declaration of which fields to include in the projection, such as `{field1: true}`

{: .warn }
> Defining sub-field projections is **not** supported.

### addProjection()

Defines a [projection]({{ site.baseurl }}{% link projections.md %}).

```js
backend.addProjection(name, collection, fields)
```

`name` -- string

> The name of the projection

`collection` -- string

> The collection to project

`fields` -- Object

> An object whose keys are the fields that should be projected. Their values should be `true`:
> ```js
> share.addProjection('names', 'users', {name: true})
> ```

### submit()

Submits an operation to the `Backend`

```js
backend.submit(agent, index, id, op [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`id` -- string

> The document ID

`op` -- Object

> The operation to submit

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> Options passed through to the [database adapter]({{ site.baseurl }}{% link adapters/database.md %})'s `commit` method. Any options that are valid there can be used here

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function (error, ops) { ... }
> ```

> A callback that will be called with `ops`, which are the ops committed by other clients between the submitted `op` being submitted and committed

### getOps()

Fetches the ops for a document between the requested version numbers, where the `from` value is inclusive, but the `to` value is non-inclusive.

```js
backend.getOps(agent, index, id, from, to [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`id` -- string

> The document ID

`from` -- number

> The first op version to fetch. If set to `null`, then ops will be fetched from the earliest version

`to` -- number

> The last op version. This version will *not* be fetched (i.e. `to` is non-inclusive). If set to `null`, then ops will be fetched up to the latest version


{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.opsOptions` -- Object (optional)

> > Default: `{}`

> > Pass options directly to the database driver's `getOps`:

> > ```js
> >  {
> >   opsOptions: {
> >     metadata: true,
> >   },
> > }
> > ```

`callback` -- Function

> ```js
> function (error, ops) { ... }
> ```

> A callback that will be called with the requested ops on success

### getOpsBulk()

Fetches the ops for multiple documents in a collection between the requested version numbers, where the `from` value is inclusive, but the `to` value is non-inclusive.

```js
backend.getOpsBulk(agent, index, fromMap, toMap [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`id` -- string

> The document ID

`fromMap` -- Object

> An object whose keys are the IDs of the target documents. The values are the first versions requested of each document (inclusive)
>
> For example, the following will fetch ops for document with ID `abc` from version `3` (inclusive):

> ```js
> {abc: 3}
> ```

`toMap` -- Object

> An object whose keys are the IDs of the target documents. The values are the last versions requested of each document (non-inclusive)
>
> For example, the following will fetch ops for document with ID `abc` up to version `3` (non-inclusive):

> ```js
> {abc: 3}
> ```

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.opsOptions` -- Object (optional)

> > Default: `{}`

> > Pass options directly to the database driver's `getOpsBulk`:

> > ```js
> >  {
> >   opsOptions: {
> >     metadata: true,
> >   },
> > }
> > ```

`callback` -- Function

> ```js
> function (error, opsMap) { ... }
> ```

> A callback that will be called with a map of document IDs and their ops:

> ```js
> {abc: []}
> ```

### fetch()

Fetch the current snapshot of a document

```js
backend.fetch(agent, index, id, [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`id` -- string

> The document ID

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.opsOptions` -- Object (optional)

> > Default: `{}`

> > Pass options directly to the database driver's `fetch`:

> > ```js
> >  {
> >   opsOptions: {
> >     metadata: true,
> >   },
> > }
> > ```

`callback` -- Function

> ```js
> function (error, snapshot) { ... }
> ```

> A callback that will be called with the requested snapshot on success

### fetchBulk()

Fetch multiple document snapshots from a collection

```js
backend.fetchBulk(agent, index, ids, [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`ids` -- string[]

> Array of document IDs

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.opsOptions` -- Object (optional)

> > Default: `{}`

> > Pass options directly to the database driver's `fetchBulk`:

> > ```js
> >  {
> >   opsOptions: {
> >     metadata: true,
> >   },
> > }
> > ```

`callback` -- Function

> ```js
> function (error, snapshots) { ... }
> ```

> A callback that will be called with a map of the requested snapshots on success

### queryFetch()

Fetch snapshots that match the provided query. In most cases, querying the backing database directly should be preferred, but `queryFetch` can be used in order to apply middleware, whilst avoiding the overheads associated with using a `Doc` instance

```js
backend.queryFetch(agent, index, query, [, options [, callback]])
```

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> An [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) instance to pass to the middleware

`index` -- string

> The name of the collection or [projection]({{ site.baseurl }}{% link projections.md %})

`query` -- Object

> A query object, whose format will depend on the [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) being used

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `db` -- string (optional)

> > Which database to run the query against. These extra databases can be attached via the [`extraDbs`](#extradbs----object) option

`callback` -- Function

> ```js
> function (error, snapshot) { ... }
> ```

> A callback that will be called with the requested snapshot on success
