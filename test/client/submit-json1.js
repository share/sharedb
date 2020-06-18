var expect = require('chai').expect;
var types = require('../../lib/types');
var json1Type = require('ot-json1');
types.register(json1Type.type);


module.exports = function() {
  describe('client json1 submit', function() {
    it('ops submitted sync get composed even if the composition returns null', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, json1Type.type.uri);
      doc.submitOp(json1Type.insertOp(['color'], 'gold'));
      doc.submitOp(json1Type.removeOp(['color']), function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 3});
        // Version is 1 instead of 3, because the create and ops got composed
        expect(doc.version).eql(1);
        doc.submitOp(json1Type.insertOp(['size'], 1));
        doc.submitOp(json1Type.removeOp(['size']), function(err) {
          if (err) return done(err);
          expect(doc.data).eql({age: 3});
          // Ops get composed
          expect(doc.version).eql(2);
          doc.submitOp(json1Type.insertOp(['size'], 1));
          doc.del(function(err) {
            if (err) return done(err);
            expect(doc.data).eql(undefined);
            // del DOES NOT get composed
            expect(doc.version).eql(4);
            done();
          });
        });
      });
    });
  });
};
