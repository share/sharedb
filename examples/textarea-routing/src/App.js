import React, { Component } from 'react';
import logo from './logo.svg';
import TextPad from './TextPad';
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App">
        <div className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h2>Welcome to React</h2>
        </div>
        <p className="App-intro">
          <TextPad docId="textarea" />
          <TextPad docId="textarea2" />
        </p>
      </div>
    );
  }
}

export default App;
