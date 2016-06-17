var http = require("http");
var ShareDB = require("sharedb");
var connect = require("connect");
var WebSocket = require('ws');
var serveStatic = require('serve-static');
var WebSocketJSONStream = require('websocket-json-stream');

var share = ShareDB();
createCounterDoc(startServer);

// Create initial counter document then fire callback
function createCounterDoc(callback) {
  var connection = share.connect();
  var doc = connection.get('dummy', 'counters');
  doc.fetch(function(err) {
    if (err) throw err;
    if (doc.type === null) { doc.create({numClicks: 0}, callback); }
  });
};

function startServer() {
  // Create a web server to serve files and listen to WebSocket connections
  var app = connect();
  app.use(serveStatic('.'));
  var server = http.createServer(app);
  var wss = new WebSocket.Server({server: server});
  server.listen(8080);

  // Connect any incoming WebSocket connection to ShareDB
  wss.on('connection', function(ws, req) {
    var stream = new WebSocketJSONStream(ws);
    share.listen(stream);
  });
}

