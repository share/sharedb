var expect = require('expect.js');
var DB = require('../lib/db');
var MingoMemoryDB = require('sharedb-mingo-memory');

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
    db.commit('testcollection', 'test', {}, {}, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getSnapshot() is unimplemented', function(done) {
    var db = new DB();
    db.getSnapshot('testcollection', 'foo', null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.getOps() is unimplemented', function(done) {
    var db = new DB();
    db.getOps('testcollection', 'foo', 0, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.query() is unimplemented', function(done) {
    var db = new DB();
    db.query('testcollection', {x: 5}, null, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });

  it('returns an error if db.queryPollDoc() is unimplemented', function(done) {
    var db = new DB();
    db.queryPollDoc('testcollection', 'foo', {x: 5}, null, function(err) {
      expect(err).an(Error);
      done();
    });
  });
});

require('./db')(function(callback) {
  var db = new MingoMemoryDB();
  callback(null, db);
});

