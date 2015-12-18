var Backend = require('../../lib/backend');
var expect = require('expect.js');

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
        {p: ['color'], oi: 'brown'},
        {age: 3, owner: {name: 'jim'}},
        done
      );
    });

    it('parent field', function(done) {
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

});
};
