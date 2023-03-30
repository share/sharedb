import http from 'http';
import express from 'express';
import ShareDB from 'sharedb';
import {WebSocketServer} from 'ws';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import json1 from 'ot-json1';

ShareDB.types.register(json1.type);
var backend = new ShareDB();
createDoc(startServer);

// Create initial document then fire callback
function createDoc(callback) {
  var connection = backend.connect();
  var doc = connection.get('examples', 'counter');
  doc.fetch(function(err) {
    if (err) throw err;
    if (doc.type === null) {
      doc.create({numClicks: 0}, json1.type.uri, callback);
      return;
    }
    callback();
  });
}

function startServer() {
  // Create a web server to serve files and listen to WebSocket connections
  var app = express();
  app.use(express.static('dist'));
  var server = http.createServer(app);

  // Connect any incoming WebSocket connection to ShareDB
  var wss = new WebSocketServer({server: server, path: '/ws'});
  wss.on('connection', function(ws) {
    var stream = new WebSocketJSONStream(ws);
    backend.listen(stream);
  });

  server.listen(8080);
  console.log('Listening on http://localhost:8080');
}
