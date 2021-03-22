---
title: Milestone adapters
nav_order: 3
layout: default
parent: Adapters
---

# Milestone adapters
{: .no_toc }

1. TOC
{:toc}

The milestone adapter is responsible for storing periodic snapshots of documents, primarily in order to speed up [document history]({{ site.baseurl }}{% link document-history.md %}).

## Available adapters

### ShareDBMilestoneMongo

[`sharedb-milestone-mongo`](https://github.com/share/sharedb-milestone-mongo) runs on MongoDB.

## Usage

An instance of a milestone adapter should be provided to the [`Backend()` constructor]({{ site.baseurl }}{% link api/backend.md %}#backend-constructor)'s `milestoneDb` option:

```js
const backend = new Backend({
  milestoneDb: new ShareDBMilestoneMongo(),
})
```

## Requesting snapshots

Adapters will define default snapshot behaviour. However, this logic can be overridden using the `saveMilestoneSnapshot` option in [middleware]({{ site.baseurl }}{% link middleware/index.md %}).

Setting `context.saveMilestoneSnapshot` to `true` will request a snapshot be saved, and setting it to `false` means a snapshot will not be saved.

{: .info }
If `context.saveMilestoneSnapshot` is left to its default value of `null`, it will assume the default behaviour defined by the adapter.

```js
shareDb.use('commit', (context, next) => {
  switch (context.collection) {
    case 'foo':
      // Save every 100 versions for collection 'foo'
      context.saveMilestoneSnapshot = context.snapshot.v % 100 === 0;
      break;
    case 'bar':
    case 'baz':
      // Save every 500 versions for collections 'bar' and 'baz'
      context.saveMilestoneSnapshot = context.snapshot.v % 500 === 0;
      break;
    default:
      // Don't save any milestones for collections not named here.
      context.saveMilestoneSnapshot = false;
  }

  next();
});
```
