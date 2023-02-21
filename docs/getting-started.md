---
title: Getting started
nav_order: 2
layout: default
---

# Getting started
{: .no_toc }

1. TOC
{:toc}

## Installation

ShareDB is distributed through [npm](https://www.npmjs.com/package/sharedb):

```bash
npm install --save sharedb
```

If your server and client have separate dependencies, ShareDB should be added as a dependency to **both** packages.

<!-- TODO: Link to types -->
You may also wish to install other [OT types]({{ site.baseurl }}{% link types/index.md %}).

## Examples

There are [working examples](https://github.com/share/sharedb/tree/master/examples) in the git repository.

## Usage

### Server

The following is an example using [Express](https://expressjs.com/) and [ws](https://github.com/websockets/ws).

The ShareDB backend expects an instance of a [`Stream`](https://nodejs.org/api/stream.html), so this example also uses [`@teamwork/websocket-json-stream`](https://www.npmjs.com/package/@teamwork/websocket-json-stream) to turn a `WebSocket` into a `Stream`.

```js
var express = require('express')
var WebSocket = require('ws')
var http = require('http')
var ShareDB = require('sharedb')
var WebSocketJSONStream = require('@teamwork/websocket-json-stream')

var app = express()
var server = http.createServer(app)
var webSocketServer = WebSocket.Server({server: server})

var backend = new ShareDB()
webSocketServer.on('connection', (webSocket) => {
  var stream = new WebSocketJSONStream(webSocket)
  backend.listen(stream)
})

server.listen(8080)
```

This server will accept any WebSocket connection on port 8080, and bind it to ShareDB.

<!-- TODO: Link to DB adapters -->
<!-- TODO: Link to middleware -->
<!-- TODO: Explain req argument and agent.custom -->

### Client

This client example uses [`reconnecting-websocket`](https://www.npmjs.com/package/reconnecting-websocket) to reconnect clients after a socket is closed.

Try running the [working example](https://github.com/share/sharedb/tree/master/examples/counter) to see this in action.

```js
var ReconnectingWebSocket = require('reconnecting-websocket')
var Connection = require('sharedb/lib/client').Connection

var socket = new ReconnectingWebSocket('ws://localhost:8080')
var connection = new Connection(socket)

var doc = connection.get('doc-collection', 'doc-id')

doc.subscribe((error) => {
  if (error) return console.error(error)

  // If doc.type is undefined, the document has not been created, so let's create it
  if (!doc.type) {
    doc.create({counter: 0}, (error) => {
      if (error) console.error(error)
    })
  }
});

doc.on('op', (op) => {
  console.log('count', doc.data.counter)
})

window.increment = () => {
  // Increment the counter by 1
  doc.submitOp([{p: ['counter'], na: 1}])
}
```

<!-- TODO: Link to types/json0 -->
<!-- TODO: Add more details on subscribe / create / submitOp / on('op') -->

{: .info }
This example uses the `json0` type (ShareDB's default type).
