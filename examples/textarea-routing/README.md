This example demonstrates

 * One way to encapsulate [sharedb-string-binding](https://github.com/share/sharedb-string-binding) as a React component.
 * How [react-router](https://github.com/ReactTraining/react-router) can be used to provide routing.

To start, execute the following commands:

```
cd sharedb/examples/textarea-routing
npm install
node server.js
```

Now navigate to [http://localhost:8080/documentA](http://localhost:8080/documentA). You should see an empty text pad and be able to type in it. If you open another browser window to the same URL, you should see the two textpads synchronized in real time.

You can replace `documentA` with `documentB` or any other name to access other documents. For example, try accessing [http://localhost:8080/documentB](http://localhost:8080/documentB) and typing something there. Now you can navigate between `documentA` and `documentB` and see the content that belongs to each one.

This project was bootstrapped with [Create React App](https://github.com/facebookincubator/create-react-app). The implementation is compatible with the create-react-app dev server, so you can run `npm start`, then access [http://localhost:3000/documentA](http://localhost:3000/documentA), and you should see the same document that is served from the same URL on port 8080. The hot reloading from the dev server in conjunction with the persistent state in the ShareDB server give a great developer experience. Note that both servers need to be running at once for this to work - you'll need to run both `node server.js` AND `npm start` at the same time.
