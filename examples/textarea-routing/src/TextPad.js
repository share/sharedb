// Derived from https://github.com/share/sharedb/blob/master/examples/textarea/client.js

import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import sharedb from 'sharedb/lib/client';
import StringBinding from 'sharedb-string-binding';
import connection from './connection';

class TextPad extends Component {

  componentDidMount() {

    // Get a reference to the textArea DOM node.
    const textArea = ReactDOM.findDOMNode(this.refs.textArea);

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
