var sharedb = require('sharedb/lib/client');
var StringBinding = require('sharedb-string-binding');

// Open WebSocket connection to ShareDB server
var socket = new WebSocket('ws://' + window.location.host);
var connection = new sharedb.Connection(socket);

// Create local Doc instance mapped to 'examples' collection document with id 'textarea'
var doc = connection.get('examples', 'textarea');
doc.subscribe(function(err) {
  if (err) throw err;
  var element = document.querySelector('textarea');
  var binding = new StringBinding(element, doc);
  binding.setup();
});
