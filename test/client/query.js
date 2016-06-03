var expect = require('expect.js');
var async = require('async');
var util = require('../util');

module.exports = function(options) {
var getQuery = options.getQuery;

describe('client query', function() {
  before(function() {
    if (!getQuery) return this.skip();
    this.matchAllDbQuery = getQuery({query: {}});
  });

  ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
    it(method + ' on an empty collection', function(done) {
      var connection = this.backend.connect();
      connection[method]('dogs', this.matchAllDbQuery, null, function(err, results) {
        if (err) return done(err);
        expect(results).eql([]);
        done();
      });
    });

    it(method + ' on collection with fetched docs', function(done) {
      var connection = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        connection[method]('dogs', matchAllDbQuery, null, function(err, results) {
          if (err) return done(err);
          var sorted = util.sortById(results);
          expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 5}]);
          done();
        });
      });
    });

    it(method + ' on collection with unfetched docs', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        connection2[method]('dogs', matchAllDbQuery, null, function(err, results) {
          if (err) return done(err);
          var sorted = util.sortById(results);
          expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 5}]);
          done();
        });
      });
    });

    it(method + ' on collection with one fetched doc', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        connection2.get('dogs', 'fido').fetch(function(err) {
          if (err) return done(err);
          connection2[method]('dogs', matchAllDbQuery, null, function(err, results) {
            if (err) return done(err);
            var sorted = util.sortById(results);
            expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
            expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 5}]);
            done();
          });
        });
      });
    });

    it(method + ' on collection with one fetched doc missing an op', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
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
            connection2[method]('dogs', matchAllDbQuery, options, function(err, results) {
              if (err) return done(err);
              var sorted = util.sortById(results);
              expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
              expect(util.pluck(sorted, 'data')).eql([{age: 4}, {age: 5}]);
              done();
            });
          });
        });
      });
    });

  });

});
};
