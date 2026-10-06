---
title: Projections
nav_order: 7
layout: default
---

# Projections

Some [types]({{ site.baseurl }}{% link types/index.md %}) support exposing a projection of a real collection, with a specified set of allowed fields.

{: .info }
Currently, only [`json0`]({{ site.baseurl }}{% link types/json0.md %}) supports projections.

Once configured, the projected collection looks just like a real collection -- except documents only have the fields that have been specified.

Operations on the projected collection work, but only a small portion of the data can be seen and altered.

{: .warn }
Projections restrict fields, but they aren't access control on their own. Reads through a projection still run [`'readSnapshots'`]({{ site.baseurl }}{% link middleware/actions.md %}#readsnapshots) and [`'op'`]({{ site.baseurl }}{% link middleware/actions.md %}#op) middleware, with `collection` set to the target collection. See [Access control]({{ site.baseurl }}{% link middleware/access-control.md %}).

## Usage

Projections are configured using [`backend.addProjection()`]({{ site.baseurl }}{% link api/backend.md %}#addprojection). For example, imagine we have a collection `users` with lots of information that should not be leaked. To add a projection `names`, which only has access to the `firstName` and `lastName` properties on a user:

```js
backend.addProjection('names', 'users', {firstName: true, lastName: true})
```

Once the projection has been defined, it can be interacted with like a "normal" collection:

```js
const doc = connection.get('names', '123')
doc.fetch(() => {
  // Only doc.data.firstName and doc.data.lastName will be present
});
```
