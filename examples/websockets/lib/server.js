var http = require('http');

var connect = require('connect');
var WebSocketServer = require('ws').Server;
var sharedb = require('sharedb');

var Stream = require('./stream');

var shareServer = http.createServer(connect());
var wss = new WebSocketServer({ server: shareServer });
var share = sharedb();

wss.on('connection', function(socket, req) {
  var stream = new Stream(socket);

  socket.on('message', function(op) {
    stream.push(op);

    console.log('op', JSON.stringify(JSON.parse(op), null, 2));
  });

  socket.on('close', function() {
    stream.push(null);
    stream.emit('close');
    stream.emit('end');
    stream.end();
  });

  share.listen(stream);
});

shareServer.listen(8888);
