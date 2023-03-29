---
title: Actions
nav_order: 2
layout: default
parent: Middleware

copy:
  submit_request_props: |-
    `collection` -- string
    > The collection of the op

    `id` -- string
    > The document ID

    `op` -- Object
    > The submitted op

    `snapshot` -- [`Snapshot`]({{ site.baseurl }}{% link api/snapshot.md %})
    > The snapshot

    `extra` -- Object
    > `extra.source` -- Object
    >> The submitted source when [`doc.submitSource`]({{ site.baseurl }}{% link api/doc.md %}http://localhost:4000/api/doc#submitsource--boolean) is set to `true`

    `saveMilestoneSnapshot` -- boolean
    > Flag to control [saving a milestone snapshot]({{ site.baseurl }}{% link adapters/milestone.md#requesting-snapshots %})

    `suppressPublish` -- boolean
    > Flag to prevent broadcasting over [pub/sub]({{ site.baseurl }}{% link pub-sub.md %})

    `retries` -- number
    > The number of times the op has attempted to submit

    `maxRetries` -- number
    > The maximum number of times to retry submitting the op

    `channels` -- string[]
    > The [pub/sub]({{ site.baseurl }}{% link pub-sub.md %}) channels the op will publish to

---

# Middleware actions
{: .no_toc }

1. TOC
{:toc}

The actions represent different stages of information flow through the server. These hooks are also available on [`backend.MIDDLEWARE_ACTIONS`]({{ site.baseurl }}{% link api/backend.md %}#middleware_actions--object).

All of the actions will have these `context` properties:

`action` -- string

> The triggered middleware action

`agent` -- [Agent]({{ site.baseurl }}{% link api/agent.md %})

> The [`Agent`]({{ site.baseurl }}{% link api/agent.md %}) communicating with the client

`backend` -- [Backend]({{ site.baseurl }}{% link api/backend.md %})

> The [`Backend`]({{ site.baseurl }}{% link api/backend.md %}) handling the request

## `'connect'`

A new client connected to the server.

This action has these additional `context` properties:

`stream` -- [Stream](https://nodejs.org/api/stream.html)

> The [`Stream`](https://nodejs.org/api/stream.html) that connected

`req` -- Object

> The `request` argument provided to [`backend.listen()`]({{ site.baseurl }}{% link api/backend.md %}#listen)

## `'receive'`

The server received a message from a client.

This action has these additional `context` properties:

`data` -- Object

> The received data

## `'reply'`

The server is about to send a non-error reply to a client message.

This action has these additional `context` properties:

`request` -- Object

> The client's received request

`reply` -- Object

> The reply about to be sent

## `'receivePresence'`

Presence information has just been received from a client. The presence has not yet been transformed against any ops it has missed.

This action has these additional `context` properties:

`collection` -- string

> The collection the presence is associated with

`presence` -- Object

> The presence object that was received. Its shape depends on its [type]({{ site.baseurl }}{% link types/index.md %})

## `'sendPresence'`

Presence information is about to be sent to a client.

This action has these additional `context` properties:

`collection` -- string

> The collection the presence is associated with

`presence` -- Object

> The presence object being sent. Its shape depends on its [type]({{ site.baseurl }}{% link types/index.md %})

## `'query'`

A new query request is about to be submitted to the database

This action has these additional `context` properties:

`index` -- string

> The name of the query's collection or [projection]({{ site.baseurl }}{% link projections.md %})

`collection` -- string

> The name of the query's target collection

`projection` -- string

> The name of the query's [projection]({{ site.baseurl }}{% link projections.md %})

`fields` -- Object

> The query's projection [fields]({{ site.baseurl }}{% link api/backend.md %}#addprojection)

`channel` -- string (deprecated)

> This property is deprecated use `channels` instead. The [Pub/Sub]({{ site.baseurl }}{% link adapters/pub-sub.md %}) channels the query will subscribe to. Defaults to its collection channel.

`channels` -- string[]

> The [Pub/Sub]({{ site.baseurl }}{% link adapters/pub-sub.md %}) channels the query will subscribe to. Defaults to its collection channel.

`query` -- Object

> The query being submitted to the database adapter

`options` -- Object

> The query [options]({{ site.baseurl }}{% link api/connection.md %}#createfetchquery)

`db` -- [DB]({{ site.baseurl }}{% link adapters/database.md %})

> The database the query will be run against

## `'readSnapshots'`

One or more snapshots were loaded from the database for a fetch or subscribe.

This action has these additional `context` properties:

`collection` -- string

> The collection the snapshots belong to

`snapshots` -- [Snapshot[]]({{ site.baseurl }}{% link api/snapshot.md %})

> The [`Snapshot`]({{ site.baseurl }}{% link api/snapshot.md %})s being read

`snapshotType` -- string

> One of:
> - `current` -- the snapshots are the latest version
> - `byVersion` -- the snapshots are being fetched by version
> - `byTimestamp` -- the snapshots are being fetched by timestamp

## `'op'`

An operation was loaded from the database.

This action has these additional `context` properties:

`collection` -- string

> The collection of the op

`id` -- string

> The document ID

`op` -- Object

> The op being read

## `'submit'`

An operation has been submitted to the server.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

## `'apply'`

An operation is about to be applied to a snapshot, before committing.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

## `'commit'`

An operation was applied to a snapshot, and is about to be committed to the database.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}

## `'afterWrite'`

An operation and its updated snapshot were successfully written to the database.

This action has these additional `context` properties:

{{ page.copy.submit_request_props }}
