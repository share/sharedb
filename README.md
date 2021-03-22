_This README is for `sharedb@1.x`. For `sharedb@1.x-beta`, see [the 1.x-beta branch](https://github.com/share/sharedb/tree/1.x-beta). To upgrade, see [the upgrade guide](https://github.com/share/sharedb/wiki/Upgrading-to-sharedb@1.0.0-from-1.0.0-beta)._

# ShareDB

  [![NPM Version](https://img.shields.io/npm/v/sharedb.svg)](https://npmjs.org/package/sharedb)
  ![Test](https://github.com/share/sharedb/workflows/Test/badge.svg)
  [![Coverage Status](https://coveralls.io/repos/github/share/sharedb/badge.svg?branch=master)](https://coveralls.io/github/share/sharedb?branch=master)

ShareDB is a realtime database backend based on [Operational Transformation
(OT)](https://en.wikipedia.org/wiki/Operational_transformation) of JSON
documents. It is the realtime backend for the [DerbyJS web application
framework](http://derbyjs.com/).

For questions, discussion and announcements, join the [ShareJS mailing
list](https://groups.google.com/forum/?fromgroups#!forum/sharejs) or [check the FAQ](./docs/faq.md).

Please report any bugs you find to the [issue
tracker](https://github.com/share/sharedb/issues).

## Features

 - Realtime synchronization of any JSON document
 - Concurrent multi-user collaboration
 - Synchronous editing API with asynchronous eventual consistency
 - Realtime query subscriptions
 - Simple integration with any database
 - Horizontally scalable with pub/sub integration
 - Projections to select desired fields from documents and operations
 - Middleware for implementing access control and custom extensions
 - Ideal for use in browsers or on the server
 - Offline change syncing upon reconnection
 - In-memory implementations of database and pub/sub for unit testing
 - Access to historic document versions
 - Realtime user presence syncing

## Documentation

https://share.github.io/sharedb/

## Examples

### Counter

[<img src="examples/counter/demo.gif" height="300">](examples/counter)

### Leaderboard

[<img src="examples/leaderboard/demo.gif" height="436">](examples/leaderboard)
