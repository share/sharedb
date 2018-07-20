var sharedb = require('sharedb/lib/client');
var StringBinding = require('sharedb-string-binding');

// Open WebSocket connection to ShareDB server
const WebSocket = require('reconnecting-websocket');
var socket = new WebSocket('ws://' + window.location.host);
var connection = new sharedb.Connection(socket);

var element = document.querySelector('textarea');
var statusSpan = document.getElementById('status-span');
status.innerHTML = "Not Connected"

element.style.backgroundColor = "gray";
socket.onopen = function(){
  status.innerHTML = "Connected"
  element.style.backgroundColor = "white";
};

socket.onclose = function(){
  status.innerHTML = "Closed"
  element.style.backgroundColor = "gray";
};

socket.onerror = function() {
  status.innerHTML = "Error"
  element.style.backgroundColor = "red";
}

// Create local Doc instance mapped to 'examples' collection document with id 'textarea'
var doc = connection.get('examples', 'textarea');
doc.subscribe(function(err) {
  if (err) throw err;
  
  var binding = new StringBinding(element, doc);
  binding.setup();
});
