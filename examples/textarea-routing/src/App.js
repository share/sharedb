import React, { Component } from 'react';
import TextPad from './TextPad';
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App">
        <TextPad docId="textarea" />
      </div>
    );
  }
}

export default App;
