---
title: Op submission
nav_order: 3
layout: default
parent: Middleware
---

# Op submission
{: .no_toc }

1. TOC
{:toc}

When an op is submitted, it will pass through a number of middleware hooks as it is processed, giving you opportunities to interact with both the op and the snapshot as they are manipulated by ShareDB's backend.

## Lifecycle summary

 - [**Submit**](#submit) -- an op has been received by the server
 - [**Apply**](#apply) -- an op is about to be applied to the snapshot
 - [**Commit**](#commit) -- an op and its updated snapshot are about to be committed to the database
 - [**After write**](#after-write) -- an op and its updated snapshot have successfully been committed to the database
 - [**Submit request end**](#submit-request-end) -- an op submission has finished (this is an _event_, **not** a middleware hook)

## Lifecycle

### Submit

The [`'submit'`]({{ site.baseurl }}{% link middleware/actions.md %}#submit) hook is triggered when the op has been received by the server.

This is the earliest point in the op's server-side lifecycle, and probably the point at which you may want to perform actions such as authenticating, validation, sanitization, etc.

```js
backend.use('submit', (context, next) => {
  // agent.custom is usually set in the 'connection' hook
  const userId = context.agent.custom.userId
  const id = context.id
  if (!userCanChangeDoc(userId, id)) {
    return next(new Error('Unauthorized'))
  }
  next()
})
```

{: .info :}
The snapshot has not yet been fetched. If you want to make any changes or assertions involving the snapshot, that should be done in the [apply](#apply) or [commit](#commit) hooks.

### Apply

The [`apply`]({{ site.baseurl }}{% link middleware/actions.md %}#apply) hook is triggered when the snapshot has been fetched, and the op is about to be applied.

{: .info :}
During the `'apply'` hook, the snapshot is in its "old" state -- the op has not yet been applied to it.

This point in the lifecycle is the earliest you can make checks against the snapshot itself (e.g. checking against snapshot metadata).

```js
backend.use('apply', (context, next) => {
  // agent.custom is usually set in the 'connection' hook
  const userId = context.agent.custom.userId
  const ownerId = context.snapshot.m.ownerId
  if (userId !== ownerId) {
    return next(new Error('Unauthorized'))
  }
  next()
})
```

### Commit

The [`commit`]({{ site.baseurl }}{% link middleware/actions.md %}#commit) hook is triggered after the op has been applied to the snapshot in memory, and both the op and snapshot are about to be written to the database.

{: .info :}
During the `'commit'` hook, the snapshot is in its "new" state -- the op has been applied to it.

This point in the lifecycle is the point at which you can make checks against the updated snapshot (e.g. validating your updated snapshot). This is your last opportunity to prevent the op from being committed.

This is a good place to update snapshot metadata, as this is the final snapshot that will be written to the database.

```js
backend.use('commit', (context, next) => {
  const userId = context.agent.custom.userId
  context.op.m.userId = userId
  context.snapshot.m.lastEditBy = userId
  next()
})
```

### After write

The [`afterWrite`]({{ site.baseurl }}{% link middleware/actions.md %}#afterwrite) hook is triggered after the op and updated snapshot have been successfully written to the database. This is the earliest that you know the op and snapshot are canonical.

This may be a sensible place to trigger analytics, or react to finalized changes to the snapshot. For example, if you're keeping a cache of documents, this would be the time to update the cache.

```js
backend.use('afterWrite', (context, next) => {
  cache.set(context.collection, context.id, context.snapshot)
  next()
})
```

### Submit request end

<!-- TODO: Link to Backend event docs -->
{: .warn :}
The submit request end is an _event_, **not** a middleware hook, but is mentioned here for completeness.

This event is triggered at the end of an op's life, regardless of success or failure. This is particularly useful for cleaning up any state that was set up earlier in the middleware and needs tearing down when an op is at the end of its life.

For example, consider a simple counter, that tracks how many requests are in progress:

```js
backend.use('submit', (context, next) => {
  requestsInProgress++
  next()
})
```

A naive approach would simply decrement this in the `'afterWrite'` hook:

```js
// This is a BAD approach
backend.use('afterWrite', (context, next) => {
  requestsInProgress--
  next()
})
```

However, this approach will miss any op submissions that result in errors, and hence will never correctly reset to zero. The correct approach is to use the `'submitRequestEnd'` event:

```js
// This is a GOOD approach
// Note use of .on() instead of .use()
backend.on('submitRequestEnd', () => {
  requestsInProgress--
})
```

{: .info :}
Since `'submitRequestEnd'` is an event -- not a middleware hook -- it provides no callback, and no way to return an error to the client. It is purely informational.

## Mutating ops

{: .warn :}
Mutating ops in middleware is generally a **bad idea**, and should be avoided.

The main reason for avoiding op mutation is that the client who submitted the op will not be informed of the mutation, so the client's doc will never receive the mutation.

The general workaround is to trigger a second op submission, rather than mutate the provided op. This obviously has the downside of op submissions being unatomic, but is the safest way to get the original client to receive the update.

{: .warn :}
When submitting ops from the middleware, set careful conditions under which you submit ops in order to avoid infinite op submission loops, where submitting an op recursively triggers infinite op submissions.
