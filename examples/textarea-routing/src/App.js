import React from 'react';
import { Router, Route, browserHistory } from 'react-router';
import TextPad from './TextPad';
import './App.css';

const App = ({ params }) => {
  return (
    <div className="App">
      <TextPad docId={params.docId} />
    </div>
  );
};

const AppRouter = () => {
  return (
    <Router history={browserHistory}>
      <Route path="/:docId" component={App} />
    </Router>
  );
};

export default AppRouter;
