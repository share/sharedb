// npm install sharedb connect ws

var http = require('http');
var sharedb = require('sharedb');
var connect = require("connect");

var WebSocket = require('ws');
var Duplex = require('stream').Duplex;

var server = http.createServer(connect());
var wss = new WebSocket.Server({
  server: server
});
var share = sharedb();

wss.on("connection", function(client, req) {
  var stream = new Duplex({
    objectMode: true
  });

  var kill = function() {
    stream.push(null);
    stream.emit("close");
    stream.emit("end");
    stream.end();

    client.close();
  }

  stream.headers = client.headers;
  stream.remoteAddress = stream.address;
  stream._write = function(chunk, encoding, next) {
    client.send(JSON.stringify(chunk));
    next();
  };
  stream._read = function() {};
  stream.on("error", function(msg) {
    client.close();
  });
  stream.on("end", function() {
    client.close();
  });
  share.listen(stream);

  client.on("message", function(data) {
    console.log('c -> s', JSON.stringify(JSON.parse(data), null, 2));
    stream.push(data);
  });
  client.on("close", kill);
});

server.listen(8888);