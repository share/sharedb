---
title: Doc
layout: default
parent: API

copy:
  event_source: This will be `false` for remote ops received from other clients, or will be truthy for ops submitted from this doc instance. For local ops, it will be the value of `source` supplied to [`submitOp`](#submitop), or `true` if no value was supplied
  submit_source: An argument that will be passed to local event handlers for distinguishing how different ops were produced. This will only be sent to the server if [`submitSource`](#submitsource--boolean) is set to `true`
---

# Doc
{: .no_toc }

1. TOC
{:toc}

The `Doc` class is the client-side representation of a ShareDB document.

A `Doc` instance can be obtained with [`connection.getDoc()`]({{ site.baseurl }}{% link api/connection.md %}#getdoc).

## Properties

### `type` -- [Type]({{ site.baseurl }}{% link types/index.md %})

> The [type]({{ site.baseurl }}{% link types/index.md %}) of the document

{: .info }
> If a document has been fetched, and its `type` remains unset, then the document has not yet been created.

### `collection` -- string

> The document's collection

### `id` -- string

> The unique document ID

### `version` -- number

> The latest version of the document fetched from the server. As ops are received from the server, `version` will be incremented.

{: .info }
> The `version` will only be incremented for local ops sent through [`submitOp()`](#submitop) after the server has acknowledged the op, when the `submitOp` callback has been called.

### `data` -- Object

> The document contents

{: .warn }
> The data will only be available after a document has been fetched or subscribed to.

### `preventCompose` -- boolean

> Default: `false`

<!-- TODO: Add documentation on what it means to compose ops -->
> Set to `true` to prevent ops from being composed together. This is read at the time of calling [`submitOp()`](#submitop), so it may be toggled on before submitting a specific op, and toggled off again afterwards

### `submitSource` -- boolean

> Default: `false`

> Set to `true` to send an op's `source` to the server

{: .warn }
> If this feature is enabled, only ops with the same `source` will be composed together locally.

## Methods

### fetch()

Populate [`data`](#data--object) with a snapshot of the document from the server

```js
doc.fetch([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the snapshot has been fetched

### subscribe()

Populate [`data`](#data--object) with a snapshot of the document from the server.

Will also listen for changes to the doc on the server, and fire [`op`](#op) events on subsequent changes.

```js
doc.subscribe([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the snapshot has been fetched

### unsubscribe()

Stop listening for document updates. The document data at the time of unsubscribing will remain in memory, but no longer stays up-to-date with the server. Resubscribe with [`subscribe()`](#subscribe)

```js
doc.unsubscribe([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when unsubscribed

### ingestSnapshot()

Ingest [snapshot]({{ site.baseurl }}{% link api/snapshot.md %}) data.

```js
doc.ingestSnapshot(snapshot [, callback])
```

{: .warn }
This method is generally called internally as a result of [`fetch()`](#fetch) or [`subscribe()`](#subscribe), and not directly from consumer code. Consumers *may* want to use this method to ingest data that was transferred to the client externally to the client's ShareDB connection.


`snapshot` -- [Snapshot]({{ site.baseurl }}{% link api/snapshot.md %})

> The snapshot to ingest

{: .warn }
> The snapshot **must** include its [`data`]({{ site.baseurl }}{% link api/snapshot.md %}#data--object), [`v`]({{ site.baseurl }}{% link api/snapshot.md %}#v--number) and [`type`]({{ site.baseurl }}{% link api/snapshot.md %}#type--type) properties

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the snapshot has been fetched

### destroy()

Unsubscribe and stop firing events. Also removes the document reference from its [`Connection`]({{ site.baseurl }}{% link api/connection.md %}), allowing the `Doc` to be garbage-collected.

```js
doc.destroy([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the document has been destroyed

### create()

Create the document locally and send the create operation to the server.

```js
doc.create(data [, type [, options [, callback]]])
```

`data` -- Object

> The document contents. The structure will depend on the document's [type]({{ site.baseurl }}{% link types/index.md %})

`type` -- [Type]({{ site.baseurl }}{% link types/index.md %})

> The document's [type]({{ site.baseurl }}{% link types/index.md %})

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.source` -- any (optional)

> > Default: `true`

> > {{ page.copy.submit_source }}

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the document has been committed by the server

### submitOp()

Apply an operation to the document locally and send the operation to the server. The document must have been fetched or subscribed to

```js
doc.submitOp(op [, options [, callback]])
```

`op` -- Object

> The op to submit. The structure of `op` depends on the document's [type]({{ site.baseurl }}{% link types/index.md %})

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.source` -- any (optional)

> > Default: `true`

> > {{ page.copy.submit_source }}

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the op has been committed by the server

### del()

Delete the document locally and send a delete operation to the server.

```js
doc.del([options [, callback]])
```

{: .info }
<!-- TODO: Add more detail on tombstones, how to "truly" delete docs, etc. -->
ShareDB documents and their ops are never truly deleted from the database. Instead, they will be tombstoned.

{: .d-inline-block }

`options` -- Object

Optional
{: .label .label-grey }

> Default: `{}`

> `options.source` -- any (optional)

> > Default: `true`

> > {{ page.copy.submit_source }}

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the document has been deleted by the server

### whenNothingPending()

Invoke a callback after:

- all ops submitted by [`submitOp()`](#submitop) have been sent to the server; **and**
- all pending [`fetch()`](#fetch), [`subscribe()`](#subscribe), and [`unsubscribe()](#unsubscribe) requests have been resolved

```js
doc.whenNothingPending(callback)
```

{: .warn }
`whenNothingPending()` does **not** wait for pending `model.query()` calls.

`callback` -- Function

> ```js
> function(error) { ... }
> ```

> A callback that will be called when the document has no pending requests (see above)

### pause()

Prevents local ops being submitted to the server. If subscribed, remote ops will still be received.

```js
doc.pause()
```

### resume()

Resume sending local ops to the server if paused. Will flush the queued ops when called.

```js
doc.resume()
```

## Events

{{ site.copy.events }}

### `'load'`

A snapshot of the document was loaded by [`ingestSnapshot`](#ingestsnapshot). This event will be triggered on [`fetch`](#fetch) or [`subscribe`](#subscribe).

```js
doc.on('load', function(source) { ... })
```

<!-- TODO: Link to error recovery section -->

{: .warn }
ShareDB's error-recovery may sometimes trigger a "hard rollback" on error. In this case, `Doc` will automatically call [`fetch()`](#fetch), so it's important to handle this event separately to the initial `subscribe()` callback.

### `'create'`

The document was created. The doc will now have a [`type`](#type--type)

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'before op'`

An operation is about to be applied to the [`data`](#data--object)

```js
doc.on('before op', function(op, source) { ... })
```

`op` -- Object

> The op that will be applied to the document

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'op'`

An operation was applied to the data.

```js
doc.on('op', function(op, source) { ... })
```

{: .info }
The difference between this event and [`'op batch'`](#op-batch) is that for [`json0`]({{ site.baseurl }}{% link types/json0.md %}), the op will be shattered into its constituent parts.
<br/>
For example, `[{p: ['list', 0], li: 'a'}, {p: ['list', 1], li: 'b'}]` would be split into two components: `[{p: ['list', 0], li: 'a'}]` and `[{p: ['list', 1], li: 'b'}]`.
<br/>
The `'op'` event will be called once for each of these op components, but `'op batch'` will only be called once.

`op` -- Object

> The op that was applied to the document

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'before op batch'`

A potentially multi-part operation is about to be applied to the [`data`](#data--object).

```js
doc.on('before op batch', function(op, source) { ... })
```

`op` -- Object

> The op that will be applied to the document

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'op batch'`

A potentially multi-part operation was applied to the [`data`](#data--object)

```js
doc.on('op batch', function(op, source) { ... })
```

`op` -- Object

> The op that was applied to the document

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'del'`

The document was deleted.

```js
doc.on('del', function(data, source) { ... })
```

`data` -- Object

> The [`data`](#data--object) just before the document was deleted

`source` -- boolean \| any

> {{ page.copy.event_source }}

### `'error'`

An error occurred. This event will usually be emitted because of an asynchronous function that was invoked without a callback.

```js
doc.on('error', function(error) { ... })
```

`error` -- [ShareDBError]({{ site.baseurl }}{% link api/sharedb-error.md %})

> The error that occurred