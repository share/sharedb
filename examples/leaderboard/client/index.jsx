var Body = require('./Body.jsx');
var React = require('react');
var ReactDOM = require('react-dom');

var sharedb = require('sharedb/lib/client');

// Open WebSocket connection to ShareDB server
connection = new sharedb.Connection(new WebSocket('ws://' + window.location.host));

// Expose to index.html
window.renderBody = function() {
  ReactDOM.render(<Body />, document.querySelector('#main'));
};
