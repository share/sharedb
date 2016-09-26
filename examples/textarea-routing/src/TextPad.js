// Derived from https://github.com/share/sharedb/blob/master/examples/textarea/client.js

import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import sharedb from 'sharedb/lib/client';
import StringBinding from 'sharedb-string-binding';

class TextPad extends Component {

  componentDidMount() {

    // Get a reference to the textArea DOM node.
    const textArea = ReactDOM.findDOMNode(this.refs.textArea);

    // Open WebSocket connection to ShareDB server
    const socket = new WebSocket('ws://' + window.location.host);
    const connection = new sharedb.Connection(socket);

    // Create local Doc instance mapped to 'examples' collection document with id 'textarea'
    const doc = connection.get('examples', 'textarea');
    doc.subscribe(function(err) {
      if (err) throw err;
      const binding = new StringBinding(textArea, doc);
      binding.setup();
    });
  }

  render() {
    return (
      <div>
        <textarea ref="textArea"></textarea>
      </div>
    );
  }
}

export default TextPad;
