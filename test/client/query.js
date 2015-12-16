var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');

module.exports = function() {
describe('client query', function() {

  ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
    it(method + ' on an empty collection', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      connection[method]('dogs', {}, null, function(err, results) {
        if (err) return done(err);
        expect(results).eql([]);
        done();
      });
    });

    it(method + ' on collection with fetched docs', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        connection[method]('dogs', {}, null, function(err, results) {
          if (err) return done(err);
          sortById(results);
          expect(pluck(results, 'id')).eql(['fido', 'spot']);
          expect(pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
          done();
        });
      });
    });

    it(method + ' on collection with unfetched docs', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        var connection2 = backend.connect();
        connection2[method]('dogs', {}, null, function(err, results) {
          if (err) return done(err);
          sortById(results);
          expect(pluck(results, 'id')).eql(['fido', 'spot']);
          expect(pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
          done();
        });
      });
    });

    it(method + ' on collection with one fetched doc', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        var connection2 = backend.connect();
        connection2.get('dogs', 'fido').fetch(function(err) {
          if (err) return done(err);
          connection2[method]('dogs', {}, null, function(err, results) {
            if (err) return done(err);
            sortById(results);
            expect(pluck(results, 'id')).eql(['fido', 'spot']);
            expect(pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
            done();
          });
        });
      });
    });

    it(method + ' on collection with one fetched doc missing an op', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        var connection2 = backend.connect();
        connection2.get('dogs', 'fido').fetch(function(err) {
          if (err) return done(err);
          connection.get('dogs', 'fido').submitOp([{p: ['age'], na: 1}], function(err) {
            if (err) return done(err);
            // The results option is meant for making resubscribing more
            // efficient and has no effect on query fetching
            var options = {
              results: [
                connection2.get('dogs', 'fido'),
                connection2.get('dogs', 'spot')
              ]
            };
            connection2[method]('dogs', {}, options, function(err, results) {
              if (err) return done(err);
              sortById(results);
              expect(pluck(results, 'id')).eql(['fido', 'spot']);
              expect(pluck(results, 'data')).eql([{age: 4}, {age: 5}]);
              done();
            });
          });
        });
      });
    });

  });

});
};

function sortById(docs) {
  docs.sort(function(a, b) {
    if (a.id > b.id) return 1;
    if (b.id > a.id) return -1;
    return 0;
  });
}

function pluck(docs, key) {
  var values = [];
  for (var i = 0; i < docs.length; i++) {
    values.push(docs[i][key]);
  }
  return values;
}
