# Collaborative Textarea with ShareDB

This is a collaborative plain textarea using the default ShareDB JSON document
type and the `sharedb-string-binding` module.

In this demo, data is not persisted. To persist data, run a Mongo
server and initialize ShareDB with the
[ShareDBMongo](https://github.com/share/sharedb-mongo) database adapter.

## Install dependencies
```
npm install
```

## Build JavaScript bundle and run server
```
npm run build && npm start
```

## Run app in browser
Load [http://localhost:8080](http://localhost:8080)
