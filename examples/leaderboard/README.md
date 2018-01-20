# Leaderboard

![Demo](demo.gif)

This is a port of [https://github.com/percolatestudio/react-leaderboard](Leaderboard) to
ShareDB.

In this demo, data is not persisted. To persist data, run a Mongo
server and initialize ShareDB with the
[ShareDBMongo](https://github.com/share/sharedb-mongo) database adapter.

## Run this example

First, install dependencies.

Note: Make sure you're in the `examples/leaderboard` folder so that it uses the `package.json` located here).

```
npm install
```

Then build the client JavaScript file.
```
npm run build
```

Get the server running.
```
npm start
```

Finally, open the example app in the browser. It runs on port 8080 by default:
[http://localhost:8080](http://localhost:8080)

For testing out the real-time aspects of this demo, you'll want to open two browser windows!
