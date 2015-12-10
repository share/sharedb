var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');

module.exports = function() {
describe.only('client query', function() {

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

    it(method + ' on collection with results', function(done) {
      var backend = new Backend({db: this.db});
      var connection = backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create('json0', {age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create('json0', {age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create('json0', {age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        connection[method]('dogs', {}, null, function(err, results) {
          if (err) return done(err);
          sortById(results);
          expect(pluck(results, 'id')).eql(['fido', 'spot']);
          expect(pluck(results, 'snapshot')).eql([{age: 3}, {age: 5}]);
          done();
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
