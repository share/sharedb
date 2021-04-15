---
title: Document history
nav_order: 9
layout: default
---

# Document history

Since -- by default -- ShareDB stores all of the submitted operations, these operations can be used to reconstruct a document at any point in its history.

ShareDB exposes two methods for this:

 - [`connection.fetchSnapshot()`]({{ site.baseurl }}{% link api/connection.md %}fetchsnapshot) -- fetches a snapshot by version number
 - [`connection.fetchSnapshotByTimestamp()`]({{ site.baseurl }}{% link api/connection.md %}#fetchsnapshotbytimestamp) -- fetches a snapshot by UNIX timestamp

{: .info }
ShareDB doesn't support "branching" a document. Any historical snapshots fetched will be read-only.

## Milestone snapshots

Since OT types are only optionally reversible, ShareDB rebuilds its historic snapshots by replaying ops all the way from creation to the requested version.

Once documents reach a high version, rebuilding a document like this can get slow. In order to facilitate this, ShareDB supports Milestone Snapshots -- snapshots that are periodically saved, so that ShareDB can jump to the nearest snapshot, and rebuild from there.

In order to benefit from this performance improvement, a [milestone adapter]({{ site.baseurl }}{% link adapters/milestone.md %}) should be configured.
