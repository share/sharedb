---
title: Presence
layout: default
parent: API
---

# Presence
{: .no_toc }

1. TOC
{:toc}

Representation of the [presence]({{ site.baseurl }}{% link presence.md %}) data associated with a given channel.

A `Presence` instance can be obtained with [`connection.getPresence()`]({{ site.baseurl }}{% link api/connection.md %}#getpresence) or [`connection.getDocPresence()`]({{ site.baseurl }}{% link api/connection.md %}#getdocpresence).

If created with [`connection.getDocPresence()`]({{ site.baseurl }}{% link api/connection.md %}#getdocpresence), this will represent the presence data associated with a given [`Doc`]({{ site.baseurl }}{% link api/doc.md %}).

## Properties

### `remotePresences` -- Object

> Map of remote presence IDs to their values

### `localPresences` -- Object

> Map of local presence IDs to their [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}) instances

## Methods

### subscribe()

Subscribe to presence updates from other clients.

```javascript
presence.subscribe([callback])
```

{: .warn }
Presence can be submitted without subscribing, but remote clients will not be able to re-request presence from an unsubscribed client.

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been subscribed

### unsubscribe()

Unsubscribe from presence updates from remote clients.

```javascript
presence.unsubscribe([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been unsubscribed

### create()

Create an instance of [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}), which can be used to represent the client's presence. Many -- or none -- such local presences may exist on a `Presence` instance.

```javascript
presence.create([presenceId])
```

{: .d-inline-block }

`presenceId` -- string

Optional
{: .label .label-grey }

> A unique ID representing the local presence. If omitted, a random ID will be assigned

{: .warn }
> Depending on use-case, the same client may have **multiple** presences, so a user or client ID may not be appropriate to use as a presence ID.

Return value

> A new [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}) instance

### destroy()

Clear all [`LocalPresence`]({{ site.baseurl }}{% link api/local-presence.md %}) instances associated with this `Presence`, setting them all to have a value of `null`, and sending the update to remote subscribers.

Also deletes this `Presence` instance for garbage-collection.

```javascript
presence.destroy([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been destroyed

## Events

{{ site.copy.events }}

### `'receive'`

An update from a remote presence client has been received.

```javascript
presence.on('receive', function(id, value) { ... });
```

`id` -- string

> The ID of the remote presence

{: .warn }
> The same client may have multiple presence IDs

`value` -- Object

> The presence value. The structure of this object will depend on the [type]({{ site.baseurl }}{% link types/index.md %})

{: .info }
> A `null` value means the remote client is no longer present in the document (e.g. they disconnected)

### `'error'`

An error has occurred.

```javascript
presence.on('error', function(error) { ... })
```

`error` -- [ShareDBError]({{ site.baseurl }}{% link api/sharedb-error.md %})

> The error that occurred
