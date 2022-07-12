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
