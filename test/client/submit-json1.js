var expect = require('chai').expect;
var types = require('../../lib/types');
var json1Type = require('ot-json1');
types.register(json1Type.type);

module.exports = function() {
  describe('with json1 and composition returns null', function() {
    var firstOp = json1Type.insertOp(['color'], 'gold');
    var secondOp = json1Type.removeOp(['color']);

    it('uses composed ops that returns null', function() {
      var firstOp = json1Type.insertOp(['color'], 'gold');
      var secondOp = json1Type.removeOp(['color']);
      expect(json1Type.type.compose(firstOp, secondOp)).eql(null);
    });

    it('composes server operations', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, json1Type.type.uri, function(err) {
        if (err) return done(err);
        doc2.fetch(function(err) {
          if (err) return done(err);
          doc.submitOp(json1Type.removeOp(['age']), function(err) {
            if (err) return done(err);
            doc2.submitOp(json1Type.removeOp(['age']), function(err) {
              if (err) return done(err);
              expect(doc.data).eql({});
              expect(doc.version).eql(2);
              done();
            });
          });
        });
      });
    });

    it('create and ops submitted sync get composed even if the composition returns null', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, json1Type.type.uri);
      doc.submitOp(firstOp);
      doc.submitOp(secondOp, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 3});
        // Version is 1 instead of 3, because the create and ops got composed
        expect(doc.version).eql(1);
        done();
      });
    });

    it('ops submitted sync get composed even if the composition returns null', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, json1Type.type.uri, function(err) {
        if (err) return done(err);

        doc.submitOp(firstOp);
        doc.submitOp(secondOp, function(err) {
          if (err) return done(err);
          expect(doc.data).eql({age: 3});
          // Ops get composed
          expect(doc.version).eql(2);
          done();
        });
      });
    });

    it('delete ops submitted sync does not get composed', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, json1Type.type.uri, function(err) {
        if (err) return done(err);

        doc.submitOp(firstOp);
        doc.del(function(err) {
          if (err) return done(err);
          expect(doc.data).eql(undefined);
          // del DOES NOT get composed
          expect(doc.version).eql(3);
          done();
        });
      });
    });
  });
};
