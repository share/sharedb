var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');
var util = require('../util');

module.exports = function() {
describe('client query subscribe', function() {

  beforeEach(function() {
    this.backend = new Backend({db: this.db});
    this.connection = this.backend.connect();
  });

  it('creating a document updates a subscribed query', function(done) {
    var connection = this.connection;
    var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
      if (err) return done(err);
      connection.get('dogs', 'fido').create({age: 3});
    });
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
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'taco').create({age: 2});
      });
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
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').del();
      });
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

  it('subscribed query does not get updated after destroyed', function(done) {
    var connection = this.connection;
    var connection2 = this.backend.connect();
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        query.destroy(function(err) {
          if (err) return done(err);
          connection2.get('dogs', 'taco').create({age: 2});
          done();
        });
      });
      query.on('insert', function() {
        done();
      });
    });
  });

  it('subscribed query does not get updated after connection is disconnected', function(done) {
    var connection = this.connection;
    var connection2 = this.backend.connect();
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.disconnect();
        connection2.get('dogs', 'taco').create({age: 2});
        done();
      });
      query.on('insert', function() {
        done();
      });
    });
  });

  it('subscribed query gets update after reconnecting', function(done) {
    var backend = this.backend;
    var connection = this.connection;
    var connection2 = backend.connect();
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.disconnect();
        connection2.get('dogs', 'taco').create({age: 2});
        process.nextTick(function() {
          backend.connect(connection);
        });
      });
      query.on('insert', function() {
        done();
      });
    });
  });

  it('subscribed query gets simultaneous insert and remove after reconnecting', function(done) {
    var backend = this.backend;
    var connection = this.connection;
    var connection2 = backend.connect();
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.disconnect();
        connection2.get('dogs', 'fido').fetch(function(err) {
          if (err) return done(err);
          connection2.get('dogs', 'fido').del();
          connection2.get('dogs', 'taco').create({age: 2});
          process.nextTick(function() {
            backend.connect(connection);
          });
        });
      });
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
        expect(util.pluck(docs, 'data')).eql([undefined]);
        finish();
      });
    });
  });

  it('creating an additional document updates a subscribed query', function(done) {
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {}, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'taco').create({age: 2});
      });
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

  it('changing a filtered property removes from a subscribed query', function(done) {
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 3}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {age: 3}, null, function(err, results) {
        if (err) return done(err);
        var sorted = util.sortById(results);
        expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
        expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 3}]);
        connection.get('dogs', 'fido').submitOp({p: ['age'], na: 2});
      });
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
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {age: 3}, null, function(err, results) {
        if (err) return done(err);
        var sorted = util.sortById(results);
        expect(util.pluck(sorted, 'id')).eql(['fido']);
        expect(util.pluck(sorted, 'data')).eql([{age: 3}]);
        connection.get('dogs', 'spot').submitOp({p: ['age'], na: -2});
      });
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
    var connection = this.connection;
    async.parallel([
      function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
      function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', {$orderby: {age: 1}}, null, function(err, results) {
        if (err) return done(err);
        expect(util.pluck(results, 'id')).eql(['fido', 'spot']);
        expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
        connection.get('dogs', 'spot').submitOp({p: ['age'], na: -3});
      });
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
