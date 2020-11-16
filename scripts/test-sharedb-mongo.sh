#!/bin/bash

cd ../
git clone https://github.com/share/sharedb-mongo.git
cd sharedb-mongo
npm install
npm install ../sharedb
npm test
