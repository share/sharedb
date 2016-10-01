import React, { Component } from 'react';
import ShareDBStringBinding from './ShareDBStringBinding';
import connection from './connection';
import './TextPad.css';

function createIfNeeded(doc, callback){
  if(doc.type === null){
    doc.create('', callback);
  } else {
    callback();
  }
}

export default class TextPad extends Component {
  componentWillMount() {
    const collection = 'textPads';
    const doc = connection.get(collection, this.props.id);
    doc.subscribe((err) => {
      createIfNeeded(doc, () => {
      });
    });
    this.doc = doc;
  }
  render (){
    return (
      <ShareDBStringBinding
        type='textarea'
        doc={this.doc}
        className='text-pad'
      />
    );
  }
};
