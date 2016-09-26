// Derived from https://github.com/share/sharedb/blob/master/examples/textarea/client.js

import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import sharedb from 'sharedb/lib/client';
import StringBinding from 'sharedb-string-binding';
import connection from './connection';

function createDocumentIfRequired(doc, callback){
  (doc.type === null) ? doc.create('', callback) : callback();
}

class TextPad extends Component {

  componentDidMount() {

    // Get a reference to the textArea DOM node.
    const textArea = ReactDOM.findDOMNode(this.refs.textArea);

    // Create local Doc instance mapped to 'examples' collection document
    // with id derived from this.props.docId
    const doc = connection.get('examples', this.props.docId);
    this.doc = doc;

    doc.subscribe((err) => {
      if (err) throw err;
      createDocumentIfRequired(doc, () => {
        const binding = new StringBinding(textArea, doc);
        binding.setup();
      });
    });
  }

  componentWillUnmount() {
    this.doc.destroy();
  }

  render() {
    return (
      <div>
        <textarea ref="textArea" />
      </div>
    );
  }
}

export default TextPad;
