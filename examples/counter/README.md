# Simple client/server sync with ShareDB

This is a simple websocket server that exposes the ShareDB protocol,
with a client showing an incrementing number that is sychronized
across all open browser tabs.

In this demo, data is not persisted. To persiste data, run a Mongo
server and initialize ShareDB with the
[ShareDBMongo](https://github.com/share/sharedb-mongo) database adapter.

## Run server
```
npm install
npm start
```

## Build client JavaScript file
```
num run build
```

## Run app in browser
Load [http://localhost:8080](http://localhost:8080)


