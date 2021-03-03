---
title: Agent
layout: default
parent: API
---

# Agent
{: .no_toc }

1. TOC
{:toc}

An `Agent` is the representation of a client's [`Connection`]({% link api/connection.md %}) state on the server.

The `Agent` instance will be made available in all [middleware]({% link middleware/index.md %}) contexts, where [`agent.custom`](#custom--object) can be particularly useful for storing custom context.

{: .info }
If the `Connection` was created through [`backend.connect()`]({% link api/backend.md %}#connect()) (ie the client is running on the server), then the `Agent` associated with a `Connection` can be accessed through [`connection.agent`]({% link api/connection.md %}#agent--agent).

## Properties

### `custom` -- Object

> An object that consumers can use to pass information around through the middleware.

### `backend` -- [Backend]({% link api/backend.md %})

> The [`Backend`]({% link api/backend.md %}) instance that created this `Agent`
