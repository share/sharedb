# Leaderboard

![Demo](demo.gif)

This is a port of [Leaderboard](https://github.com/percolatestudio/react-leaderboard) to
ShareDB.

In this demo, data is not persisted. To persist data, run a Mongo
server and initialize ShareDB with the
[ShareDBMongo](https://github.com/share/sharedb-mongo) database adapter.

## Install dependencies

Make sure you're in the `examples/leaderboard` folder so that it uses the `package.json` located here).
```
npm install
```

## Build JavaScript bundle and run server
```
npm run build && npm start
```

Finally, open the example app in the browser. It runs on port 8080 by default:
[http://localhost:8080](http://localhost:8080)

For testing out the real-time aspects of this demo, you'll want to open two browser windows!
