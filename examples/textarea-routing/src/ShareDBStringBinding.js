// This component encapsulates sharedb-string-binding as a React component.
//
// Derived from the original ShareDB textarea example found at
// https://github.com/share/sharedb/blob/master/examples/textarea/client.js

import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import StringBinding from 'sharedb-string-binding';
import connection from './connection';
import './TextPad.css';

function createIfNeeded(doc, callback){
  if(doc.type === null){
    doc.create('', callback);
  } else {
    callback();
  }
}

export default class ShareDBStringBinding extends Component {

  componentDidMount() {

    const { collection, id } = this.props;

    const doc = connection.get(collection, id);
    const textArea = ReactDOM.findDOMNode(this.refs.stringDOM);

    doc.subscribe((err) => {
      if (err) throw err;
      createIfNeeded(doc, () => {
        const binding = new StringBinding(textArea, doc);
        binding.setup();
      });
    });

    this.doc = doc;
  }

  componentWillUnmount() {
    this.doc.destroy();
  }

  render() {
    return React.createElement(
      this.props.type,
      Object.assign({ ref: 'stringDOM' }, this.props)
    );
  }
}
