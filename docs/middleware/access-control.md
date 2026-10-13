---
title: Access control
nav_order: 4
layout: default
parent: Middleware
---

# Access control
{: .no_toc }

1. TOC
{:toc}

ShareDB has no built-in access control. Instead, you enforce it in [middleware]({{ site.baseurl }}{% link middleware/registration.md %}).

A client can read a document in two forms: as a snapshot, or as the ops that build it. These go through different middleware, so **read access control must be enforced in both [`'readSnapshots'`]({{ site.baseurl }}{% link middleware/actions.md %}#readsnapshots) and [`'op'`]({{ site.baseurl }}{% link middleware/actions.md %}#op) middleware**.

{: .warn }
The client chooses which form it asks for. Checking only `'readSnapshots'` still lets a client read a document's `create` data and its entire history by asking for its ops from version `0`.

## Which middleware sees what

| Data sent to the client | Middleware |
|---|---|
| Snapshots: fetching or subscribing to a doc the client doesn't have yet, bulk fetches and subscribes by id, query results (including docs added to a subscribed query's results later), resubscribing to a query after reconnecting, [`fetchSnapshot()`]({{ site.baseurl }}{% link api/connection.md %}#fetchsnapshot) and [`fetchSnapshotByTimestamp()`]({{ site.baseurl }}{% link api/connection.md %}#fetchsnapshotbytimestamp) | [`'readSnapshots'`]({{ site.baseurl }}{% link middleware/actions.md %}#readsnapshots) |
| Ops: fetching or subscribing to a doc from a version, bulk fetches and subscribes from versions, resubscribing to a query after reconnecting, ops on subscribed docs and query results as they happen, and ops the client missed, sent back after it submits | [`'op'`]({{ site.baseurl }}{% link middleware/actions.md %}#op) |
| Queries -- this runs before the query, and doesn't see its results | [`'query'`]({{ site.baseurl }}{% link middleware/actions.md %}#query) |
| Presence | [`'sendPresence'`]({{ site.baseurl }}{% link middleware/actions.md %}#sendpresence) |
| Writes | See [op submission]({{ site.baseurl }}{% link middleware/op-submission.md %}) |

## Example

```js
function canRead(agent, collection, id) {
  // Your own rule, e.g. checking against agent.custom.userId
}

function canQuery(agent, collection, query) {
  // Your own rule, e.g. only allowing queries scoped to agent.custom.userId
}

backend.use('readSnapshots', (context, next) => {
  for (const snapshot of context.snapshots) {
    if (!canRead(context.agent, context.collection, snapshot.id)) {
      context.rejectSnapshotRead(snapshot, new Error('Forbidden'))
    }
  }
  next()
})

backend.use('op', (context, next) => {
  if (!canRead(context.agent, context.collection, context.id)) {
    return next(new Error('Forbidden'))
  }
  next()
})

backend.use('query', (context, next) => {
  if (!canQuery(context.agent, context.collection, context.query)) {
    return next(new Error('Forbidden'))
  }
  next()
})
```

In a bulk fetch or subscribe, `context.rejectSnapshotRead()` rejects just that snapshot, and the rest of the request still succeeds. Queries can't partially succeed: if any of a query's snapshots is rejected, the whole query fails, and a subscribed query drops that update. Use `'query'` middleware to keep queries to documents the client can read -- for example, by narrowing `context.query`, whose shape depends on your [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) -- and treat `'readSnapshots'` as the backstop.

Narrowing a query only limits its results. A client resubscribing to a query after reconnecting names the documents it already has, and reading those is checked only by `'readSnapshots'` and `'op'`.

There is no per-op equivalent of `rejectSnapshotRead()`: rejecting an op fails the whole fetch or subscribe that read it, including a query resubscribe. So if a client loses access to one of a subscribed query's documents while it's offline, the query errors when it reconnects. A live op that `'op'` rejects as it arrives over pub/sub is logged and dropped instead: the client's doc doesn't error, but stops updating until its next fetch or resubscribe, which is then rejected.

{: .warn }
`'op'` runs once for every op read, so a client catching up from version `0` triggers it for every op in the document's history. Keep the check cheap: for example, by caching permissions on `agent.custom`.

## Projections

For a [projection]({{ site.baseurl }}{% link projections.md %}), `context.collection` in `'readSnapshots'` and `'op'` is the projection's target collection, and the snapshot or op has already been projected.
