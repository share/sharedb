---
title: Pub/Sub adapters
nav_order: 2
layout: default
parent: Adapters
---

# Pub/Sub adapters
{: .no_toc }

1. TOC
{:toc}

The pub/sub adapter is responsible for notifying other ShareDB instances of changes to data.

## Available adapters

### MemoryPubSub

ShareDB ships with an in-memory Pub/Sub, which can be used for a single, standalone ShareDB instance.

{: .info }
Unlike the [database adapter]({{ site.baseurl }}{% link adapters/database.md %}), the in-memory Pub/Sub adapter **is** suitable for use in a Production environment, where only a single, standalone ShareDB instance is being used.

### ShareDBRedisPubSub

[`sharedb-redis-pubsub`](https://github.com/share/sharedb-redis-pubsub) runs on Redis.

### ShareDBWSBusPubSub

[`sharedb-wsbus-pubsub`](https://github.com/dmapper/sharedb-wsbus-pubsub) runs on ws-bus.

## Usage

An instance of a pub/sub adapter should be provided to the [`Backend()` constructor]({{ site.baseurl }}{% link api/backend.md %}#backend-constructor)'s `pubsub` option:

```js
const backend = new Backend({
  pubsub: new MemoryPubSub(),
})
```
