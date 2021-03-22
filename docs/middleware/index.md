---
title: Middleware
nav_order: 5
layout: default

copy:
  submit_request_props: |-
    `collection` -- string
    > The collection of the op

    `id` -- string
    > The document ID

    `op` -- Object
    > The submitted op

    `snapshot` -- [`Snapshot`]({% link api/snapshot.md %})
    > The snapshot

    `extra` -- Object
    > `extra.source` -- Object
    >> The submitted source when [`doc.submitSource`]({% link api/doc.md %}http://localhost:4000/api/doc#submitsource--boolean) is set to `true`

    `saveMilestoneSnapshot` -- boolean
    > Flag to control [saving a milestone snapshot]({% link adapters/milestone.md#requesting-snapshots %})

    `suppressPublish` -- boolean
    > Flag to prevent broadcasting over [pub/sub]({% link pub-sub.md %})

    `retries` -- number
    > The number of times the op has attempted to submit

    `maxRetries` -- number
    > The maximum number of times to retry submitting the op

---

# Middleware
{: .no_toc }

1. TOC
{:toc}

Middleware enables consumers to hook into the ShareDB server pipeline. Objects can be asynchronously manipulated as they flow through ShareDB.

<!-- TODO: Link to an auth example -->
This can be particularly useful for authentication.

## Registering middleware

Middleware is registered on the server with [`backend.use()`]({% link api/backend.md %}#use):

```js
backend.use(action, function(context, next) {
  // Do something with the context

  // Call next when ready. Can optionally pass an error to stop
  // the current action, and return the error to the client
  next(error)
})
```

The `action` should be one of the values listed [below](#actions).

## Actions

The actions represent different stages of information flow through the server. These hooks are also available on [`backend.MIDDLEWARE_ACTIONS`]({% link api/backend.md %}#middleware_actions--object).

All of the actions will have these `context` properties:

`action` -- string

> The triggered middleware action

`agent` -- [Agent]({% link api/agent.md %})

> The [`Agent`]({% link api/agent.md %}) communicating with the client

`backend` -- [Backend]({% link api/backend.md %})

> The [`Backend`]({% link api/backend.md %}) handling the request

### `'connect'`

A new client connected to the server.

This action has these additional `context` properties:

`stream` -- [Stream](https://nodejs.org/api/stream.html)

> The [`Stream`](https://nodejs.org/api/stream.html) that connected

`req` -- Object

> The `request` argument provided to [`backend.listen()`]({% link api/backend.md %}#listen)

### `'receive'`

The server received a message from a client.

This action has these additional `context` properties:

`data` -- Object

> The received data

### `'reply'`

The server is about to send a non-error reply to a client message.

This action has these additional `context` properties:

`request` -- Object

> The client's received request

`reply` -- Object

> The reply about to be sent

### `'sendPresence'`

Presence information is about to be sent to a client.

This action has these additional `context` properties:

`collection` -- string

> The collection the presence is associated with

`presence` -- Object

> The presence object being sent. Its shape depends on its [type]({% link types/index.md %})

### `'readSnapshots'`

One or more snapshots were loaded from the database for a fetch or subscribe.

This action has these additional `context` properties:

`collection` -- string

> The collection the snapshots belong to

`snapshots` -- [Snapshot[]]({% link api/snapshot.md %})

> The [`Snapshot`]({% link api/snapshot.md %})s being read

`snapshotType` -- string

> One of:
> - `current` -- the snapshots are the latest version
> - `byVersion` -- the snapshots are being fetched by version
> - `byTimestamp` -- the snapshots are being fetched by timestamp

### `'op'`

An operation was loaded from the database.

This action has these additional `context` properties:

`collection` -- string

> The collection of the op

`id` -- string

> The document ID

`op` -- Object

> The op being read

### `'submit'`

An operation has been submitted to the server.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

### `'apply'`

An operation is about to be applied to a snapshot, before committing.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

### `'commit'`

An operation was applied to a snapshot, and is about to be committed to the database.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

### `'afterWrite'`

An operation and its updated snapshot were successfully written to the database.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}
