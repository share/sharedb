---
title: Agent
layout: default
parent: API
---

# Agent

{: .no_toc }

1. TOC
   {:toc}

An `Agent` is the representation of a client's [`Connection`]({{ site.baseurl }}{% link api/connection.md %}) state on the server.

The `Agent` instance will be made available in all [middleware]({{ site.baseurl }}{% link middleware/index.md %}) contexts, where [`agent.custom`](#custom--object) can be particularly useful for storing custom context.

{: .info }
If the `Connection` was created through [`backend.connect()`]({{ site.baseurl }}{% link api/backend.md %}#connect()) (i.e. the client is running on the server), then the `Agent` associated with a `Connection` can be accessed through [`connection.agent`]({{ site.baseurl }}{% link api/connection.md %}#agent--agent).

## Properties

### `custom` -- Object

> An object that consumers can use to pass information around through the middleware.

{: .info }
The `agent.custom` is passed onto the `options` field in [database adapter]({{ site.baseurl }}{% link adapters/database.md %}) calls as `options.agentCustom`. This allows further customisation at the database level e.g. [in `sharedb-mongo` middleware](https://github.com/share/sharedb-mongo#middlewares).

### `backend` -- [Backend]({{ site.baseurl }}{% link api/backend.md %})

> The [`Backend`]({{ site.baseurl }}{% link api/backend.md %}) instance that created this `Agent`
