import React from 'react';
import { Router, Route, browserHistory } from 'react-router';
import TextPad from './TextPad';
import './App.css';

const App = ({ params }) => {
  return (
    <div className="App">
      <TextPad id={params.id} />
    </div>
  );
};

const AppRouter = () => {
  return (
    <Router history={browserHistory}>
      <Route path="/:id" component={App} />
    </Router>
  );
};

export default AppRouter;
