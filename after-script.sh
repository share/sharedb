#!/bin/bash

cat ./coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js

cd ../
git clone https://github.com/share/sharedb-mongo.git
cd sharedb-mongo
npm install
npm install ../sharedb
npm test

exit 0
