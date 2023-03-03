---
title: Queries
nav_order: 8
layout: default
---

# Queries
{: .no_toc }

Some [database adapters]({{ site.baseurl }}{% link adapters/database.md %}) support queries. You can use queries to fetch or subscribe to many documents matching the provided query.

1. TOC
{:toc}

## Fetch query

A fetch query will simply query the database for all the documents that match the given query, and return them. The query results will be passed into the provided callback, or can be retrieved by listening for the [`'ready'`]({{ site.baseurl }}{% link api/query.md %}#ready) event.

For example, when using `sharedb-mongo`, you can use Mongo queries. This will fetch all the documents whose `userId` is `1`:

```js
const options = {}
connection.createFetchQuery('my-collection', {userId: 1}, options, (error, results) => {
  // results is an array of Doc instances with their data populated
})
```

{: .info }
See the [API documentation]({{ site.baseurl }}{% link api/connection.md %}#createfetchquery) for valid options.

[`createFetchQuery`]({{ site.baseurl }}{% link api/connection.md %}#createfetchquery) also returns a
[`Query`]({{ site.baseurl }}{% link api/query.md %}) instance, which can be used instead:

```js
const query = connection.createFetchQuery('my-collection', {userId: 1})
query.on('ready', () => {
  // results are now available in query.results
})
```

## Subscribe query

A subscribe query acts similarly to a [fetch query](#fetch-query), except a subscribe query will update its own [`results`]({{ site.baseurl }}{% link api/query.md %}#results--array) in response to documents being [added]({{ site.baseurl }}{% link api/query.md %}#insert), [removed]({{ site.baseurl }}{% link api/query.md %}#remove) or [moved]({{ site.baseurl }}{% link api/query.md %}#move) (e.g. if the query is sorted).

{: .warn }
A subscribed query will automatically cause any matched `Doc` instances to receive ops as if they were subscribed. The docs **cannot be unsubscribed individually**.

Subscribe queries can be created similarly to fetch queries, but you may also be interested in [other events]({{ site.baseurl }}{% link api/query.md %}#events):

```js
const query = connection.createSubscribeQuery('my-collection', {userId: 1})
query.on('ready', () => {
  // The initial results are available in query.results
})
query.on('changed', () => {
  // This is a catch-all event that is fired when further changes are made.
  // It is called just after the 'insert', 'move', and 'remove' events.
})
```

## Performance

Arbitrary queries are not necessarily performant out-of-the-box. As with all database queries, some steps should be taken to keep queries fast.

### Indexing

As with all database queries, appropriate indexes should be set up to expedite common queries. The exact details of this will vary depending on the underlying database.

### Paging

If a query can potentially return a large number of results, you may want to consider limiting the number of results that can be returned, again similarly to how a "traditional" query might be altered.

For example, a `sharedb-mongo` limit might look like this:

```js
const query = connection.createSubscribeQuery('my-collection', {userId: 1, $skip: 10, $limit: 10})
```

{: .info }
`sharedb-mongo` [queries](https://github.com/share/sharedb-mongo#queries) are not quite the same as MongoDB queries, and allow definition of some cursor functions directly in the query object.

One way subscription queries act differently to a direct database query is that pages will automatically be updated. For example, consider this collection:

```json
{"userId": 1, "value": 5}
{"userId": 1, "value": 7}
{"userId": 1, "value": 3}
{"userId": 1, "value": 1}
{"userId": 2, "value": 2}
```

Let's run a limited query:

```js
const q = {userId: 1, $sort: {value: 1}, $limit: 3}
const query = connection.createSubscribeQuery('values', q)
query.on('ready', () => {
  // query.results looks like this:
  // [
  //   {userId: 1, value: 1},
  //   {userId: 1, value: 3},
  //   {userId: 1, value: 5},
  // ]
})
```

Now let's insert a new document and listen for the change:

```js
const newDoc = connection.get('values', id)
newDoc.create({userId: 1, value: 0})

query.on('changed', () => {
  // query.results has been updated:
  // [
  //   {userId: 1: value: 0},
  //   {userId: 1: value: 1},
  //   {userId: 1: value: 3},
  // ]
})
```

So, as per our query, the `query.results` will always contain the first 3 values, sorted in ascending order, regardless of what the original values were when first subscribing.

{: .warn }
After they've been created, queries cannot be updated. If you want a new page of results, you'll have to create a new query.

### Subscription channels

Since ShareDB can't understand queries itself (that responsibility belongs to the [database adapter]({{ site.baseurl }}{% link adapters/database.md %})), it also doesn't understand which queries will care about which ops.

{: .warn }
Queries will check if they need to be updated after an op is submitted to **any** document in their collection.

Chances are that your queries will only care about a small sub-set of your documents. For example, let's say we have a database of some blog posts:

```json
{"userId": 1, "title": "Hello, World!"}
{"userId": 1, "title": "11 Weird Tricks for Collaborative Editing"}
{"userId": 2, "title": "Nana's Lasagne"}
{"userId": 2, "title": "Tastiest Pesto in the World!"}
```

If we want to show all the blog articles for a particular user, we may create a query:

```js
const query = connection.createSubscribeQuery('posts', {userId: 1})
```

However, we may have hundreds or thousands of other users creating posts, which our query won't care about. We don't want our query polling the database every time another user updates their blog.

We can solve this in ShareDB's [middleware]({{ site.baseurl }}{% link middleware/index.md %}):

```js
backend.use('commit', (context, next) => {
  // Set ops to publish to our special user-specific pub/sub channel
  context.channels.push(userChannel(context))
  next()
})

backend.use('query', (context, next) => {
  // Set our query to only listen for changes on our user-specific channel
  context.channels = [userChannel(context)]
  next()
})

function userChannel(context) {
  // Assume the userId has been stored in agent.custom on connection
  const userId = context.agent.custom.userId
  return context.collection + userId
}
```
