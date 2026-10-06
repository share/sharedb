---
title: Presence
nav_order: 10
layout: default
---

# Presence

ShareDB supports sharing "presence": transient information about a client's whereabouts in a given document. For example, this might be their position in a text document; their mouse pointer coordinates on the screen; or a selected field in a form.

{: .info }
Presence needs to be enabled in the [`Backend`]({{ site.baseurl }}{% link api/backend.md %}).

## Usage

### Untyped presence

Presence can be used independently of a document (for example, sharing a mouse pointer position).

In this case, clients just need to subscribe to a common channel using [`connection.getPresence()`]({{ site.baseurl }}{% link api/connection.md %}#getpresence) to get a [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance:

```js
const presence = connection.getPresence('my-channel')
presence.subscribe()

presence.on('receive', (presenceId, update) => {
  if (update === null) {
    // The remote client is no longer present in the document
  } else {
    // Handle the new value by updating UI, etc.
  }
})
```

In order to send presence information to other clients, a [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}) should be created. The presence object can take any arbitrary value

```js
const localPresence = presence.create()
// The presence value can take any shape
localPresence.submit({foo: 'bar'})
```

{: .info }
Multiple local presences can be created from a single `presence` instance, which can be used to represent columnar text cursors, multi-touch input, etc.

### Typed presence

Presence can be coupled to a particular document by getting a [`DocPresence`]({{ site.baseurl }}{% link api/presence.md %}) instance with [`connection.getDocPresence()`]({{ site.baseurl }}{% link api/doc.md %}#getdocpresence).

The special thing about a `DocPresence` (as opposed to a `Presence`) instance is that `DocPresence` will automatically handle synchronisation issues. Since presence and ops are submitted independently of one another, they can arrive out-of-sync, which might make a text cursor jitter, for example. `DocPresence` will handle these cases, and make sure the correct presence is always applied to the correct version of a document.

Support depends on the [type]({{ site.baseurl }}{% link types/index.md %}) being used.

{: .info }
Currently, only `rich-text` supports presence information

Clients subscribe to a particular [`Doc`]({{ site.baseurl }}{% link api/doc.md %}) instead of a channel:

```js
const presence = connection.getDocPresence(collection, id)
presence.subscribe()

presence.on('receive', (presenceId, update) => {
  if (update === null) {
    // The remote client is no longer present in the document
  } else {
    // Handle the new value by updating UI, etc.
  }
})
```

The shape of the presence value will be defined by the [type]({{ site.baseurl }}{% link types/index.md %}):

```js
const localPresence = presence.create()
// The presence value depends on the type
localPresence.submit(value)
```

## Access control

{: .warn }
Presence is **not** covered by document permissions: being able to read or write a document does not control who can see or send presence on it. Use [middleware]({{ site.baseurl }}{% link middleware/index.md %}) to restrict presence.

### Receiving presence

Subscribing to presence doesn't trigger any presence middleware, so any client can subscribe to any presence channel -- including the presence of a document it can't read.

To stop a client receiving presence, reject the update in the [`'sendPresence'`]({{ site.baseurl }}{% link middleware/actions.md %}#sendpresence) middleware. For typed presence, ShareDB makes sure that `presence.c` and `presence.d` match the presence channel. This middleware runs for every update about to be sent to every client, so keep the check cheap -- for example, by caching permissions on [`agent.custom`]({{ site.baseurl }}{% link api/agent.md %}#custom--object).

{: .warn }
Rejecting updates in `'sendPresence'` only stops them reaching the client if you set the [`doNotForwardSendPresenceErrorsToClient`]({{ site.baseurl }}{% link api/backend.md %}#options) option. Otherwise, the client is sent an error for each rejected update, including its presence ID. With the option set, each rejected update is passed to the `errorHandler` instead.

### Sending presence

ShareDB rejects typed presence whose collection and document ID don't match its channel. It also only broadcasts typed presence if the client can read the document, as determined by the [`'readSnapshots'`]({{ site.baseurl }}{% link middleware/actions.md %}#readsnapshots) middleware. This is checked when the client starts sending presence on the document, not on every update.

ShareDB doesn't check:

 - whether the client can write to the document
 - `null` presence, which is sent when a client leaves
 - untyped presence

Check these in the [`'receivePresence'`]({{ site.baseurl }}{% link middleware/actions.md %}#receivepresence) middleware if you need to.

If you only use typed presence, reject untyped presence in `'receivePresence'`: older clients still apply untyped presence sent on a document's channel.

### Presence IDs

Presence IDs are chosen by the client, and sent to every subscriber, so a client could use another client's presence ID to overwrite or clear its presence.

To prevent this, tie presence IDs to the user in `'receivePresence'` -- for example by requiring them to start with the user ID:

```js
const localPresence = presence.create(`${userId}:${randomId}`)
```

{: .info }
Keep a random suffix, so that the same user can have more than one presence -- for example, in multiple browser tabs.

### Example

```js
backend.use('receivePresence', (context, next) => {
  // agent.custom is usually set in the 'connect' hook
  const userId = context.agent.custom.userId
  const presence = context.presence
  if (!presence.id.startsWith(`${userId}:`)) {
    return next(new Error('Unauthorized'))
  }
  // This app only uses typed presence
  if (!presence.c) {
    return next(new Error('Unauthorized'))
  }
  // Let users clear their own presence, even if they've lost access
  if (presence.p === null) return next()
  if (!userCanChangeDoc(userId, presence.c, presence.d)) {
    return next(new Error('Unauthorized'))
  }
  next()
})

backend.use('sendPresence', (context, next) => {
  const userId = context.agent.custom.userId
  const presence = context.presence
  if (!userCanReadDoc(userId, presence.c, presence.d)) {
    return next(new Error('Unauthorized'))
  }
  next()
})
```
