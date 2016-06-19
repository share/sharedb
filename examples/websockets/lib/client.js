var sharedb = require('sharedb/lib/client');

var connection = new sharedb.Connection(new WebSocket('ws://localhost:8888'));

var doc = connection.get('collection', 'document');

doc.subscribe(function(error) {
  if (!doc.type) {
    var initialData = {x: 'hello'};
    doc.create(initialData);
    console.log('Doc created with data: ', initialData);
  }

  doc.on('op', function(ops, isLocal) {
    console.log('Handle op...');
    console.log('Local?: ', isLocal);
    console.log('Ops: ', ops);
    console.log('Doc: ', doc.data);
  });

  if (doc.type) {
    var counter = 0
    setInterval(function() {
      doc.submitOp([{p: ['x', 5], si: ' ' + (++counter)}]);
    }, 2000);
  }
});
