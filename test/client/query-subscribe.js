var expect = require('chai').expect;
var async = require('async');
var util = require('../util');

module.exports = function(options) {
  var getQuery = options.getQuery;

  describe('client query subscribe', function() {
    before(function() {
      if (!getQuery) return this.skip();
      this.matchAllDbQuery = getQuery({query: {}});
    });

    it('creating a document updates a subscribed query', function(done) {
      var connection = this.backend.connect();
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').on('error', done).create({age: 3});
      });
      query.on('error', done);
      query.on('insert', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        expect(util.pluck(docs, 'data')).eql([{age: 3}]);
        expect(index).equal(0);
        expect(util.pluck(query.results, 'id')).eql(['fido']);
        expect(util.pluck(query.results, 'data')).eql([{age: 3}]);
        done();
      });
    });

    it('creating an additional document updates a subscribed query', function(done) {
      var connection = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.get('dogs', 'taco').on('error', done).create({age: 2});
        });
        query.on('error', done);
        query.on('insert', function(docs, index) {
          expect(util.pluck(docs, 'id')).eql(['taco']);
          expect(util.pluck(docs, 'data')).eql([{age: 2}]);
          expect(query.results[index]).equal(docs[0]);
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['fido', 'spot', 'taco']);
          expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}, {age: 2}]);
          done();
        });
      });
    });

    it('deleting a document updates a subscribed query', function(done) {
      var connection = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.get('dogs', 'fido').del();
        });
        query.on('error', done);
        query.on('remove', function(docs, index) {
          expect(util.pluck(docs, 'id')).eql(['fido']);
          expect(util.pluck(docs, 'data')).eql([undefined]);
          expect(index).a('number');
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['spot']);
          expect(util.pluck(results, 'data')).eql([{age: 5}]);
          done();
        });
      });
    });

    it('subscribed query removes document from results before sending delete op to other clients', function(done) {
      var connection1 = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection1.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection1.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection2.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection1.get('dogs', 'fido').del();
        });
        query.on('error', done);
        var removed = false;
        connection2.get('dogs', 'fido').on('del', function() {
          expect(removed).equal(true);
          done();
        });
        query.on('remove', function(docs, index) {
          removed = true;
          expect(util.pluck(docs, 'id')).eql(['fido']);
          expect(util.pluck(docs, 'data')).eql([{age: 3}]);
          expect(index).a('number');
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['spot']);
          expect(util.pluck(results, 'data')).eql([{age: 5}]);
        });
      });
    });

    it('subscribed query does not get updated after destroyed', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          query.destroy(function(err) {
            if (err) return done(err);
            connection2.get('dogs', 'taco').on('error', done).create({age: 2}, done);
          });
        });
        query.on('error', done);
        query.on('insert', function() {
          done();
        });
      });
    });

    it('subscribed query does not get updated after connection is disconnected', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.close();
          connection2.get('dogs', 'taco').on('error', done).create({age: 2}, done);
        });
        query.on('error', done);
        query.on('insert', function() {
          done();
        });
      });
    });

    it('subscribed query gets update after reconnecting', function(done) {
      var backend = this.backend;
      var connection = backend.connect();
      var connection2 = backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.close();
          connection2.get('dogs', 'taco').on('error', done).create({age: 2});
          process.nextTick(function() {
            backend.connect(connection);
          });
        });
        query.on('error', done);
        query.on('insert', function() {
          done();
        });
      });
    });

    it('subscribed query gets simultaneous insert and remove after reconnecting', function(done) {
      var backend = this.backend;
      var connection = backend.connect();
      var connection2 = backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.close();
          connection2.get('dogs', 'fido').fetch(function(err) {
            if (err) return done(err);
            connection2.get('dogs', 'fido').del();
            connection2.get('dogs', 'taco').on('error', done).create({age: 2});
            process.nextTick(function() {
              backend.connect(connection);
            });
          });
        });
        query.on('error', done);
        var wait = 2;
        function finish() {
          if (--wait) return;
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['spot', 'taco']);
          expect(util.pluck(results, 'data')).eql([{age: 5}, {age: 2}]);
          done();
        }
        query.on('insert', function(docs) {
          expect(util.pluck(docs, 'id')).eql(['taco']);
          expect(util.pluck(docs, 'data')).eql([{age: 2}]);
          finish();
        });
        query.on('remove', function(docs) {
          expect(util.pluck(docs, 'id')).eql(['fido']);
          // We don't assert the value of data, because the del op could be
          // applied by the client before or after the query result is removed.
          // Order of ops & query result updates is not currently guaranteed
          finish();
        });
      });
    });

    it('creating an additional document updates a subscribed query', function(done) {
      var connection = this.backend.connect();
      var matchAllDbQuery = this.matchAllDbQuery;
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
          if (err) return done(err);
          connection.get('dogs', 'taco').on('error', done).create({age: 2});
        });
        query.on('error', done);
        query.on('insert', function(docs, index) {
          expect(util.pluck(docs, 'id')).eql(['taco']);
          expect(util.pluck(docs, 'data')).eql([{age: 2}]);
          expect(query.results[index]).equal(docs[0]);
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['fido', 'spot', 'taco']);
          expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}, {age: 2}]);
          done();
        });
      });
    });

    it('pollDebounce option reduces subsequent poll interval', function(done) {
      var connection = this.backend.connect();
      this.backend.db.canPollDoc = function() {
        return false;
      };
      var query = connection.createSubscribeQuery('items', this.matchAllDbQuery, {pollDebounce: 1000});
      query.on('error', done);
      var batchSizes = [];
      var total = 0;

      query.on('insert', function(docs) {
        batchSizes.push(docs.length);
        total += docs.length;
        if (total === 1) {
        // first write received by client. we're debouncing. create 9
        // more documents.
          for (var i = 1; i < 10; i++) {
            connection.get('items', i.toString()).on('error', done).create({});
          }
        }
        if (total === 10) {
        // first document is its own batch; then subsequent creates
        // are debounced until after all other 9 docs are created
          expect(batchSizes).eql([1, 9]);
          done();
        }
      });

      // create an initial document. this will lead to the 'insert'
      // event firing the first time, while sharedb is definitely
      // debouncing
      connection.get('items', '0').on('error', done).create({});
    });

    it('db.pollDebounce option reduces subsequent poll interval', function(done) {
      var connection = this.backend.connect();
      this.backend.db.canPollDoc = function() {
        return false;
      };
      this.backend.db.pollDebounce = 1000;
      var query = connection.createSubscribeQuery('items', this.matchAllDbQuery);
      query.on('error', done);
      var batchSizes = [];
      var total = 0;

      query.on('insert', function(docs) {
        batchSizes.push(docs.length);
        total += docs.length;
        if (total === 1) {
        // first write received by client. we're debouncing. create 9
        // more documents.
          for (var i = 1; i < 10; i++) {
            connection.get('items', i.toString()).on('error', done).create({});
          }
        }
        if (total === 10) {
        // first document is its own batch; then subsequent creates
        // are debounced until after all other 9 docs are created
          expect(batchSizes).eql([1, 9]);
          done();
        }
      });

      // create an initial document. this will lead to the 'insert'
      // event firing the first time, while sharedb is definitely
      // debouncing
      connection.get('items', '0').on('error', done).create({});
    });

    it('pollInterval updates a subscribed query after an unpublished create', function(done) {
      var connection = this.backend.connect();
      this.backend.suppressPublish = true;
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, {pollInterval: 50}, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').on('error', done).create({});
      });
      query.on('error', done);
      query.on('insert', function(docs) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        done();
      });
    });

    it('db.pollInterval updates a subscribed query after an unpublished create', function(done) {
      var connection = this.backend.connect();
      this.backend.suppressPublish = true;
      this.backend.db.pollInterval = 50;
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').on('error', done).create({});
      });
      query.on('error', done);
      query.on('insert', function(docs) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        done();
      });
    });

    it('pollInterval captures additional unpublished creates', function(done) {
      var connection = this.backend.connect();
      this.backend.suppressPublish = true;
      var count = 0;
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, {pollInterval: 50}, function(err) {
        if (err) return done(err);
        connection.get('dogs', count.toString()).on('error', done).create({});
      });
      query.on('error', done);
      query.on('insert', function() {
        count++;
        if (count === 3) return done();
        connection.get('dogs', count.toString()).on('error', done).create({});
      });
    });

    it('query extra is returned to client', function(done) {
      var connection = this.backend.connect();
      this.backend.db.query = function(collection, query, fields, options, callback) {
        process.nextTick(function() {
          callback(null, [], {colors: ['brown', 'gold']});
        });
      };
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err, results, extra) {
        if (err) return done(err);
        expect(results).eql([]);
        expect(extra).eql({colors: ['brown', 'gold']});
        expect(query.extra).eql({colors: ['brown', 'gold']});
        done();
      });
      query.on('error', done);
    });

    it('query extra is updated on change', function(done) {
      var connection = this.backend.connect();
      this.backend.db.query = function(collection, query, fields, options, callback) {
        process.nextTick(function() {
          callback(null, [], 1);
        });
      };
      this.backend.db.queryPoll = function(collection, query, options, callback) {
        process.nextTick(function() {
          callback(null, [], 2);
        });
      };
      this.backend.db.canPollDoc = function() {
        return false;
      };
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err, results, extra) {
        if (err) return done(err);
        expect(extra).eql(1);
        expect(query.extra).eql(1);
      });
      query.on('error', done);
      query.on('extra', function(extra) {
        expect(extra).eql(2);
        expect(query.extra).eql(2);
        done();
      });
      connection.get('dogs', 'fido').on('error', done).create({age: 3});
    });

    it('changing a filtered property removes from a subscribed query', function(done) {
      var connection = this.backend.connect();
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 3}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var dbQuery = getQuery({query: {age: 3}});
        var query = connection.createSubscribeQuery('dogs', dbQuery, null, function(err, results) {
          if (err) return done(err);
          var sorted = util.sortById(results);
          expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 3}]);
          connection.get('dogs', 'fido').submitOp({p: ['age'], na: 2});
        });
        query.on('error', done);
        query.on('remove', function(docs, index) {
          expect(util.pluck(docs, 'id')).eql(['fido']);
          expect(util.pluck(docs, 'data')).eql([{age: 5}]);
          expect(index).a('number');
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['spot']);
          expect(util.pluck(results, 'data')).eql([{age: 3}]);
          done();
        });
      });
    });

    it('changing a filtered property inserts to a subscribed query', function(done) {
      var connection = this.backend.connect();
      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var dbQuery = getQuery({query: {age: 3}});
        var query = connection.createSubscribeQuery('dogs', dbQuery, null, function(err, results) {
          if (err) return done(err);
          var sorted = util.sortById(results);
          expect(util.pluck(sorted, 'id')).eql(['fido']);
          expect(util.pluck(sorted, 'data')).eql([{age: 3}]);
          connection.get('dogs', 'spot').submitOp({p: ['age'], na: -2});
        });
        query.on('error', done);
        query.on('insert', function(docs, index) {
          expect(util.pluck(docs, 'id')).eql(['spot']);
          expect(util.pluck(docs, 'data')).eql([{age: 3}]);
          expect(index).a('number');
          var results = util.sortById(query.results);
          expect(util.pluck(results, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 3}]);
          done();
        });
      });
    });

    it('changing a sorted property moves in a subscribed query', function(done) {
      var connection = this.backend.connect();

      async.parallel([
        function(cb) {
          connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
        },
        function(cb) {
          connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
        }
      ], function(err) {
        if (err) return done(err);
        var dbQuery = getQuery({query: {}, sort: [['age', 1]]});
        var query = connection.createSubscribeQuery(
          'dogs',
          dbQuery,
          null,
          function(err, results) {
            if (err) return done(err);
            expect(util.pluck(results, 'id')).eql(['fido', 'spot']);
            expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
            connection.get('dogs', 'spot').submitOp({p: ['age'], na: -3});
          });
        query.on('error', done);
        query.on('move', function(docs, from, to) {
          expect(docs.length).eql(1);
          expect(from).a('number');
          expect(to).a('number');
          expect(util.pluck(query.results, 'id')).eql(['spot', 'fido']);
          expect(util.pluck(query.results, 'data')).eql([{age: 2}, {age: 3}]);
          done();
        });
      });
    });
  });
};
