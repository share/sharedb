// This module exposes a singleton WebSocket connection to ShareDB server.
import sharedb from 'sharedb/lib/client';
const webSocket = new WebSocket('ws://' + window.location.host);
const connection = new sharedb.Connection(webSocket);
export default connection;
