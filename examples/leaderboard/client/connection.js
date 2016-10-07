var sharedb = require('sharedb/lib/client');

// Expose a singleton WebSocket connection to ShareDB server
var socket = new WebSocket('ws://' + window.location.host);
var connection = new sharedb.Connection(socket);
module.exports = connection;
