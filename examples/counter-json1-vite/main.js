import ReconnectingWebSocket from 'reconnecting-websocket';
import {json1} from 'sharedb-client-browser/dist/ot-json1-umd.cjs';
import sharedb from 'sharedb-client-browser/dist/sharedb-client-umd.cjs';

// Open WebSocket connection to ShareDB server
var socket = new ReconnectingWebSocket('ws://' + window.location.host + '/ws', [], {
  // ShareDB handles dropped messages, and buffering them while the socket
  // is closed has undefined behavior
  maxEnqueuedMessages: 0
});
sharedb.types.register(json1.type);
var connection = new sharedb.Connection(socket);

// Create local Doc instance mapped to 'examples' collection document with id 'counter'
var doc = connection.get('examples', 'counter');

// Get initial value of document and subscribe to changes
doc.subscribe(showNumbers);
// When document changes (by this client or any other, or the server),
// update the number on the page
doc.on('op', showNumbers);

function showNumbers() {
  document.querySelector('#num-clicks').textContent = doc.data.numClicks;
};

// When clicking on the '+1' button, change the number in the local
// document and sync the change to the server and other connected
// clients
function increment() {
  // Increment `doc.data.numClicks`. See
  // https://github.com/ottypes/json1/blob/master/spec.md for list of valid operations.
  doc.submitOp(['numClicks', {ena: 1}]);
}

var button = document.querySelector('button.increment');
button.addEventListener('click', increment);
