var sharedb = require('sharedb/lib/client');
var StringBinding = require('sharedb-string-binding');

// Open WebSocket connection to ShareDB server
var ReconnectingWebSocket = require('reconnecting-websocket');
var socket = new ReconnectingWebSocket('ws://' + window.location.host);
var connection = new sharedb.Connection(socket);

var element = document.querySelector('textarea');
var statusSpan = document.getElementById('status-span');
statusSpan.innerHTML = 'Not Connected';

element.style.backgroundColor = 'gray';
socket.addEventListener('open', function() {
  statusSpan.innerHTML = 'Connected';
  element.style.backgroundColor = 'white';
});

socket.addEventListener('close', function() {
  statusSpan.innerHTML = 'Closed';
  element.style.backgroundColor = 'gray';
});

socket.addEventListener('error', function() {
  statusSpan.innerHTML = 'Error';
  element.style.backgroundColor = 'red';
});

// Create local Doc instance mapped to 'examples' collection document with id 'textarea'
var doc = connection.get('examples', 'textarea');
doc.subscribe(function(err) {
  if (err) throw err;

  var binding = new StringBinding(element, doc, ['content']);
  binding.setup();
});
