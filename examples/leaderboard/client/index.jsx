var Body = require('./Body.jsx');
var React = require('react');
var ReactDOM = require('react-dom');

// Expose to index.html
window.renderBody = function() {
  ReactDOM.render(<Body />, document.querySelector('#main'));
};
