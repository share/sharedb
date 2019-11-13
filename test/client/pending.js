var expect = require('chai').expect;
var Backend = require('../../lib/backend');

describe('client connection', function() {
  beforeEach(function() {
    this.backend = new Backend();
  });

  it('new connection.hasPending() returns false', function() {
    var connection = this.backend.connect();
    expect(connection.hasPending()).equal(false);
  });
  it('new connection.hasWritePending() returns false', function() {
    var connection = this.backend.connect();
    expect(connection.hasWritePending()).equal(false);
  });
  it('new connection.whenNothingPending() calls back', function(done) {
    var connection = this.backend.connect();
    connection.whenNothingPending(done);
  });

  it('connection.hasPending() returns true after op', function() {
    var connection = this.backend.connect();
    connection.get('dogs', 'fido').create();
    expect(connection.hasPending()).equal(true);
  });
  it('connection.hasWritePending() returns true after op', function() {
    var connection = this.backend.connect();
    connection.get('dogs', 'fido').create();
    expect(connection.hasWritePending()).equal(true);
  });
  ['fetch', 'subscribe'].forEach(function(method) {
    it('connection.hasPending() returns true after doc ' + method, function() {
      var connection = this.backend.connect();
      connection.get('dogs', 'fido')[method]();
      expect(connection.hasPending()).equal(true);
    });
    it('connection.hasWritePending() returns false after doc ' + method, function() {
      var connection = this.backend.connect();
      connection.get('dogs', 'fido')[method]();
      expect(connection.hasWritePending()).equal(false);
    });
  });
  ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
    it('connection.hasPending() returns true after ' + method, function() {
      var connection = this.backend.connect();
      connection[method]('dogs', {});
      expect(connection.hasPending()).equal(true);
    });
    it('connection.hasWritePending() returns false after ' + method, function() {
      var connection = this.backend.connect();
      connection[method]('dogs', {});
      expect(connection.hasWritePending()).equal(false);
    });
  });

  it('connection.whenNothingPending() calls back after op', function(done) {
    var connection = this.backend.connect();
    var doc = connection.get('dogs', 'fido');
    doc.create();
    expect(doc.version).equal(null);
    connection.whenNothingPending(function() {
      expect(doc.version).equal(1);
      done();
    });
  });
  ['fetch', 'subscribe'].forEach(function(method) {
    it('connection.whenNothingPending() calls back after doc ' + method, function(done) {
      var connection = this.backend.connect();
      var doc = connection.get('dogs', 'fido');
      doc[method]();
      expect(doc.version).equal(null);
      connection.whenNothingPending(function() {
        expect(doc.version).equal(0);
        done();
      });
    });
  });
  ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
    it('connection.whenNothingPending() calls back after query fetch', function(done) {
      var connection = this.backend.connect();
      connection.get('dogs', 'fido').create({age: 3}, function() {
        var query = connection[method]('dogs', {});
        connection.whenNothingPending(function() {
          expect(query.results[0].id).equal('fido');
          done();
        });
      });
    });
  });
});
