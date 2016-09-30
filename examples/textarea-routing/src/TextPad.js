import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import ShareDBStringBinding from './ShareDBStringBinding';
import './TextPad.css';

export default ({id}) => {
  return (
    <ShareDBStringBinding
      type='textarea'
      collection='textPads'
      id={id} 
      className='text-pad'
    />
  );
};
