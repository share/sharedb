// This module exposes a singleton WebSocket connection to ShareDB server.
import sharedb from 'sharedb/lib/client';

// This line enables connecting to ShareDB within the React dev tooling.
// Our ShareDB server started with `node server.js` runs on port 8080.
// Our create-react-app dev server started with `npm start` runs on port 3000.
// This line makes the WebSocket connection always use port 8080.
const host = window.location.host.replace("3000", "8080");

const webSocket = new WebSocket('ws://' + host);
const connection = new sharedb.Connection(webSocket);
export default connection;
