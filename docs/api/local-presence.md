---
title: LocalPresence
layout: default
parent: API
---

# LocalPresence
{: .no_toc }

1. TOC
{:toc}

`LocalPresence` represents the [presence]({{ site.baseurl }}{% link presence.md %}) of the local client. For example, this might be the position of a caret in a text document; which field has been highlighted in a complex JSON object; etc.

Local presence is created from a parent [`Presence`]({{ site.baseurl }}{% link api/presence.md %}) instance using [`presence.create()`]({{ site.baseurl }}{% link api/presence.md %}#create).

## Methods

### submit()

Update the local representation of presence, and broadcast that presence to any other presence subscribers.

```javascript
localPresence.submit(presence [, callback])
```

`presence` -- Object

> The presence object to broadcast. The structure of `presence` will depend on the [type]({{ site.baseurl }}{% link types/index.md %})

{: .info }
> A value of `null` will be interpreted as the client no longer being present

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been sent

### send()

Send the current value of presence to other subscribers, without updating it. This is like [`submit()`](#submit) but without changing the value.

This can be useful if local presence is set to periodically expire (e.g. after a period of inactivity).

```javascript
localPresence.send([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been sent

### destroy()

Inform all remote clients that this presence is now `null`, and deletes itself for garbage collection.

```javascript
localPresence.destroy([callback])
```

{: .d-inline-block }

`callback` -- Function

Optional
{: .label .label-grey }

> ```js
> function(error) { ... }
> ```

> A callback that will be called once the presence has been destroyed
