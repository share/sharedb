var http = require('http');
var ShareDB = require('sharedb');
var express = require('express');
var ShareDBMingoMemory = require('sharedb-mingo-memory');
var WebSocketJSONStream = require('@teamwork/websocket-json-stream');
var WebSocket = require('ws');

// Start ShareDB
var share = new ShareDB({db: new ShareDBMingoMemory()});

// Create a WebSocket server
var app = express();
app.use(express.static('static'));
var server = http.createServer(app);
var wss = new WebSocket.Server({server: server});
server.listen(8080);
console.log('Listening on http://localhost:8080');

// Connect any incoming WebSocket connection with ShareDB
wss.on('connection', function(ws) {
  var stream = new WebSocketJSONStream(ws);
  share.listen(stream);
});

// Create initial documents
var connection = share.connect();
connection.createFetchQuery('players', {}, {}, function(err, results) {
  if (err) {
    throw err;
  }

  if (results.length === 0) {
    var names = ['Ada Lovelace', 'Grace Hopper', 'Marie Curie',
      'Carl Friedrich Gauss', 'Nikola Tesla', 'Claude Shannon'];

    names.forEach(function(name, index) {
      var doc = connection.get('players', ''+index);
      var data = {name: name, score: Math.floor(Math.random() * 10) * 5};
      doc.create(data);
    });
  }
});
