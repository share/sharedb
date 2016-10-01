// This component encapsulates sharedb-string-binding as a React component.
//
// Derived from the original ShareDB textarea example found at
// https://github.com/share/sharedb/blob/master/examples/textarea/client.js

import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import StringBinding from 'sharedb-string-binding';
import './TextPad.css';


export default class ShareDBStringBinding extends Component {

  componentDidMount() {
    const { doc } = this.props;
    const textArea = ReactDOM.findDOMNode(this.refs.stringDOM);
    doc.subscribe((err) => {
      if (err) throw err;
      const binding = new StringBinding(textArea, doc);
      binding.setup();
    });
  }

  render() {
    const { type, className } = this.props;
    return React.createElement(
      type,
      {
        ref: 'stringDOM',
        type,
        className
      }
    );
  }
}
