---
title: Snapshot
layout: default
parent: API
---

# Snapshot
{: .no_toc }

1. TOC
{:toc}

Represents a **read-only** ShareDB document at a particular version number.

{: .info }
Snapshots can **not** be used to manipulate the current version of the document stored in the database. That should be achieved by using a [`Doc`]({{ site.baseurl }}{% link api/doc.md %}).

## Properties

### `type` -- [Type]({{ site.baseurl }}{% link types/index.md %})

> The document [type]({{ site.baseurl }}{% link types/index.md %})

{: .info }
> Document types can change between versions if the document is deleted, and created again.

### `data` -- Object

> The snapshot data

### `v` -- number

> The snapshot version
