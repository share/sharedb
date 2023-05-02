var ReconnectingWebSocket = require('reconnecting-websocket');
var sharedb = require('sharedb/lib/client');

// Expose a singleton WebSocket connection to ShareDB server
var socket = new ReconnectingWebSocket('ws://' + window.location.host, [], {
  // ShareDB handles dropped messages, and buffering them while the socket
  // is closed has undefined behavior
  maxEnqueuedMessages: 0
});
var connection = new sharedb.Connection(socket);
module.exports = connection;
