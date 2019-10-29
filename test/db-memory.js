var expect = require('chai').expect;
var DB = require('../lib/db');
var BasicQueryableMemoryDB = require('./BasicQueryableMemoryDB');

describe('DB base class', function() {
  it('can call db.close() without callback', function() {
    var db = new DB();
    db.close();
  });

  it('can call db.close() with callback', function(done) {
    var db = new DB();
    db.close(done);
  });

  it('returns an error if db.commit() is unimplemented', function(done) {
    var db = new DB();
    db.commit('testcollection', 'test', {}, {}, null, function(err) {
      expect(err).instanceOf(Error);
      done();
    });
  });

  it('returns an error if db.getSnapshot() is unimplemented', function(done) {
    var db = new DB();
    db.getSnapshot('testcollection', 'foo', null, null, function(err) {
      expect(err).instanceOf(Error);
      done();
    });
  });

  it('returns an error if db.getOps() is unimplemented', function(done) {
    var db = new DB();
    db.getOps('testcollection', 'foo', 0, null, null, function(err) {
      expect(err).instanceOf(Error);
      done();
    });
  });

  it('returns an error if db.query() is unimplemented', function(done) {
    var db = new DB();
    db.query('testcollection', {x: 5}, null, null, function(err) {
      expect(err).instanceOf(Error);
      done();
    });
  });

  it('returns an error if db.queryPollDoc() is unimplemented', function(done) {
    var db = new DB();
    db.queryPollDoc('testcollection', 'foo', {x: 5}, null, function(err) {
      expect(err).instanceOf(Error);
      done();
    });
  });
});

// Run all the DB-based tests against the BasicQueryableMemoryDB.
require('./db')({
  create: function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    var db = new BasicQueryableMemoryDB(options);
    callback(null, db);
  },
  getQuery: function(options) {
    return {filter: options.query, sort: options.sort};
  }
});
