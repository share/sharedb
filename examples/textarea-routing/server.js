// This is our ShareDB server, built on Express and WebSockets.
// Derived from https://github.com/share/sharedb/blob/master/examples/textarea/server.js

var http = require('http');
var express = require('express');
var ShareDB = require('sharedb');
var WebSocket = require('ws');
var WebSocketJSONStream = require('websocket-json-stream');
var path = require('path');

var buildDir = 'build';
var port = '8080';

var backend = new ShareDB();
var app = express()

  // Serve static assets bundled by `npm run build`.
  .use(express.static(buildDir))

  // Serve index.html for any route that doesn't match static assets,
  // for compatibility with react-router browserHistory.
  .get('*', function (req, res) {
    res.sendFile(path.join(__dirname, buildDir, 'index.html'))
  });

var server = http.createServer(app);

new WebSocket.Server({server: server})
  .on('connection', function(ws, req) {
    var stream = new WebSocketJSONStream(ws);
    backend.listen(stream);
  });

server.listen(port);
console.log('Listening on http://localhost:' + port);
