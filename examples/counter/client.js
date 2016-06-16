var sharedb = require('sharedb/lib/client');

// Open WebSocket connection to ShareDB server
var connection = new sharedb.Connection(new WebSocket('ws://localhost:8080'));

// Create local Doc instance mapped to 'counters' collection's
// document with id 'theCounter'
var doc = connection.get('dummy', 'counters');

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
  // https://github.com/ottypes/json0 for list of valid operations.
  doc.submitOp([{p: ['numClicks'], na: 1}], function(err) {
    if (err) throw err;
  });
}

// Expose to index.html
global.increment = increment;
