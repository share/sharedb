var Backend = require('../../lib/backend');
var expect = require('expect.js');
var util = require('../util');

module.exports = function() {
describe('client projections', function() {

  beforeEach(function(done) {
    this.backend = new Backend({db: this.db});
    this.backend.addProjection('dogs_summary', 'dogs', {age: true, owner: true});
    this.connection = this.backend.connect();
    var data = {age: 3, color: 'gold', owner: {name: 'jim'}, litter: {count: 4}};
    this.connection.get('dogs', 'fido').create(data, done);
  });

  ['fetch', 'subscribe'].forEach(function(method) {
    it('snapshot ' + method, function(done) {
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs_summary', 'fido');
      fido[method](function(err) {
        if (err) return done(err);
        expect(fido.data).eql({age: 3, owner: {name: 'jim'}});
        expect(fido.version).eql(1);
        done();
      });
    });
  });

  ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
    it('snapshot ' + method, function(done) {
      var connection2 = this.backend.connect();
      connection2[method]('dogs_summary', {}, null, function(err, results) {
        if (err) return done(err);
        expect(results.length).eql(1);
        expect(results[0].data).eql({age: 3, owner: {name: 'jim'}});
        expect(results[0].version).eql(1);
        done();
      });
    });
  });

  function opTests(test) {
    it('projected field', function(done) {
      test.call(this,
        {p: ['age'], na: 1},
        {age: 4, owner: {name: 'jim'}},
        done
      );
    });

    it('non-projected field', function(done) {
      test.call(this,
        {p: ['color'], oi: 'brown', od: 'gold'},
        {age: 3, owner: {name: 'jim'}},
        done
      );
    });

    it('parent field replace', function(done) {
      test.call(this,
        {p: [], oi: {age: 2, color: 'brown', owner: false}, od: {age: 3, color: 'gold', owner: {name: 'jim'}, litter: {count: 4}}},
        {age: 2, owner: false},
        done
      );
    });

    it('parent field set', function(done) {
      test.call(this,
        {p: [], oi: {age: 2, color: 'brown', owner: false}},
        {age: 2, owner: false},
        done
      );
    });

    it('projected child field', function(done) {
      test.call(this,
        {p: ['owner', 'sex'], oi: 'male'},
        {age: 3, owner: {name: 'jim', sex: 'male'}},
        done
      );
    });

    it('non-projected child field', function(done) {
      test.call(this,
        {p: ['litter', 'count'], na: 1},
        {age: 3, owner: {name: 'jim'}},
        done
      );
    });
  }

  describe('op fetch', function() {
    function test(op, expected, done) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs_summary', 'fido');
      fido.fetch(function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').submitOp(op, function(err) {
          if (err) return done(err);
          fido.fetch(function(err) {
            if (err) return done(err);
            expect(fido.data).eql(expected);
            expect(fido.version).eql(2);
            done();
          });
        });
      });
    };
    opTests(test);
  });

  describe('op subscribe', function() {
    function test(op, expected, done) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs_summary', 'fido');
      fido.subscribe(function(err) {
        if (err) return done(err);
        fido.on('after op', function() {
          expect(fido.data).eql(expected);
          expect(fido.version).eql(2);
          done();
        });
        connection.get('dogs', 'fido').submitOp(op);
      });
    };
    opTests(test);
  });

  describe('op fetch query', function() {
    function test(op, expected, done) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs_summary', 'fido');
      fido.fetch(function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').submitOp(op, function(err) {
          if (err) return done(err);
          connection2.createFetchQuery('dogs_summary', {}, null, function(err) {
            if (err) return done(err);
            expect(fido.data).eql(expected);
            expect(fido.version).eql(2);
            done();
          });
        });
      });
    };
    opTests(test);
  });

  describe('op subscribe query', function() {
    function test(op, expected, done) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs_summary', 'fido');
      connection2.createSubscribeQuery('dogs_summary', {}, null, function(err) {
        if (err) return done(err);
        fido.on('after op', function() {
          expect(fido.data).eql(expected);
          expect(fido.version).eql(2);
          done();
        });
        connection.get('dogs', 'fido').submitOp(op);
      });
    };
    opTests(test);
  });

  function queryUpdateTests(test) {
    it('doc create', function(done) {
      test.call(this,
        function(connection, callback) {
          var data = {age: 5, color: 'spotted', owner: {name: 'sue'}, litter: {count: 6}};
          connection.get('dogs', 'spot').create(data, callback);
        },
        function(err, results) {
          var sorted = util.sortById(results.slice());
          expect(sorted.length).eql(2);
          expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(sorted, 'data')).eql([
            {age: 3, owner: {name: 'jim'}},
            {age: 5, owner: {name: 'sue'}}
          ]);
          done();
        }
      );
    });
  }

  describe('subscribe query', function() {
    function test(trigger, callback) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      var query = connection2.createSubscribeQuery('dogs_summary', {}, null, function(err) {
        if (err) return callback(err);
        query.on('insert', function() {
          callback(null, query.results);
        });
        trigger(connection);
      });
    }
    queryUpdateTests(test);
  });

  describe('fetch query', function() {
    function test(trigger, callback) {
      var connection = this.connection;
      var connection2 = this.backend.connect();
      trigger(connection, function(err) {
        if (err) return callback(err);
        connection2.createFetchQuery('dogs_summary', {}, null, callback);
      });
    }
    queryUpdateTests(test);
  });
});
};
