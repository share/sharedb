---
title: Query
layout: default
parent: API
---

# Query
{: .no_toc }

1. TOC
{:toc}

Representation of a query made through [`connection.createFetchQuery()`]({{ site.baseurl }}{% link api/connection.md %}#createfetchquery) or [`connection.createSubscribeQuery()`]({{ site.baseurl }}{% link api/connection.md %}#createsubscribequery).

## Properties

### `ready` -- boolean

> Represents if results are ready and available in [`results`](#results)

### `results` -- Array

> Query results, as an array of [`Doc`]({{ site.baseurl }}{% link api/doc.md %}) instances

### `extra` -- Object

> Extra query results that are not an array of `Doc`s. Available for certain [database adapters]({{ site.baseurl }}{% link adapters/database.md %}) and queries

## Methods

### destroy()

Unsubscribe and stop firing events.

```js
query.destroy([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the query has been destroyed

## Events

{{ site.copy.events }}

### `'ready'`

The initial query results were loaded from the server. Triggered on [`connection.createFetchQuery()`]({{ site.baseurl }}{% link api/connection.md %}#createfetchquery) or [`connection.createSubscribeQuery()`]({{ site.baseurl }}{% link api/connection.md %}#createsubscribequery).

```js
query.on('ready', function() { ... })
```

### `'changed'`

The subscribed query results have changed. Fires only after a sequence of diffs are handled.

```js
query.on('changed', function(results) { ... })
```

`results` -- Array

> Query results, as an array of [`Doc`]({{ site.baseurl }}{% link api/doc.md %}) instances

### `'insert'`

A contiguous sequence of documents were added to the query results array.

```js
query.on('insert', function(docs, index) { ... })
```

`docs` -- Array

> Array of inserted [`Doc`]({{ site.baseurl }}{% link api/doc.md %})s

`index` -- number

> The index at which the documents were inserted

### `'move'`

A contiguous sequence of documents moved position in the query results array.

```js
query.on('move', function(docs, from, to) { ... })
```

`docs` -- Array

> Array of moved [`Doc`]({{ site.baseurl }}{% link api/doc.md %})s

`from` -- number

> The index the documents were moved from

`to` -- number

> The index the documents were moved to

### `'remove'`

A contiguous sequence of documents were removed from the query results array.

```js
query.on('remove', function(docs, index) { ... })
```

`docs` -- Array

> Array of removed [`Doc`]({{ site.baseurl }}{% link api/doc.md %})s

`index` -- number

> The index at which the documents were removed

### `'extra'`

The [`extra`](#extra--object) property was changed.

```js
query.on('extra', function(extra) { ... })
```

`extra` -- Object

> The updated [`extra`](#extra--object) value

### `'error'`

There was an error receiving updates to a subscription.

```js
query.on('error', function(error) { ... })
```

`error` -- [ShareDBError]({{ site.baseurl }}{% link api/sharedb-error.md %})

> The error that occurred