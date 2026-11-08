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

## Sub-fields

A field can also be a dot-separated path to a sub-field. For example, to expose a user's name and city, but not the rest of their address:

```js
backend.addProjection('contacts', 'users', {name: true, 'address.city': true})
```

```js
// users/123:    {name: 'Jim', email: 'jim@example.com', address: {city: 'Durham', street: '1 Main St'}}
// contacts/123: {name: 'Jim', address: {city: 'Durham'}}
```

Ops are projected the same way, so subscribers to `contacts` see changes to `address.city`, and nothing else in `address`. Ops that replace a parent object, like `address` itself, are sent with only the projected sub-fields of the old and new values.

Sub-field paths only go through objects. If a value on the way to a sub-field isn't an object (for example, an array or a string), it's left out of the projection.

When submitting ops to a projection with sub-fields, an op may only change a value at or below a projected path. Ops that would replace a parent of a projected sub-field are rejected, since they could overwrite fields the client can't see.
