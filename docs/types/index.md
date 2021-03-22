---
title: OT Types
nav_order: 3
layout: default
has_children: true
---

# OT Types
{: .no_toc }

1. TOC
{:toc}

ShareDB provides a realtime collaborative platform based on [Operational Transformation (OT)](https://en.wikipedia.org/wiki/Operational_transformation). However, ShareDB itself is only part of the solution. ShareDB provides a lot of the machinery for handling ops, but does not provide the actual implementation for transforming ops.

Transforming and handling ops is delegated to an underlying OT type.

ShareDB ships with a single, default type -- [`json0`]({{ site.baseurl }}{% link types/json0.md %}).

## Registering types

In order to use other OT types with ShareDB, they must first be registered.

{: .warn }
Types must be registered on **both** the server **and** the client.

### Server

```js
const Backend = require('sharedb')
const richText = require('rich-text')

Backend.types.register(richText.type)
```

### Client

```js
const Client = require('sharedb/lib/client')
const richText = require('rich-text')

Client.types.register(richText.type)
```

## Using types

A [registered](#registering-types) type can be used by specifying its name or URI when creating a [`Doc`]({{ site.baseurl }}{% link api/doc.md %}):

```js
doc.create([{insert: 'Lorem'}], 'http://sharejs.org/types/rich-text/v1')
// The Doc will now use the type that it was created with when submitting more ops
doc.submitOp([{retain: 5}, {insert: ' ipsum'}])
```

{: .warn }
The short-hand name can also be used (e.g. `'rich-text'`), but these don't have to be unique, so types may clash if multiple types with the same name have been registered. Best practice is to use the URI.
