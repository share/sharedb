// This module exposes a singleton WebSocket connection to ShareDB server.
var sharedb = require('sharedb/lib/client'),
    connection = new sharedb.Connection(new WebSocket('ws://' + window.location.host));
module.exports = connection;
