var Backend = require('../lib/backend');
var expect = require('chai').expect;

describe('Backend', function() {
  var backend;

  beforeEach(function() {
    backend = new Backend();
  });

  afterEach(function(done) {
    backend.close(done);
  });

  describe('a simple document', function() {
    beforeEach(function(done) {
      var doc = backend.connect().get('books', '1984');
      doc.create({title: '1984'}, function(error) {
        if (error) return done(error);
        doc.submitOp({p: ['author'], oi: 'George Orwell'}, done);
      });
    });

    describe('getOps', function() {
      it('fetches all the ops', function(done) {
        backend.getOps(null, 'books', '1984', 0, null, function(error, ops) {
          if (error) return done(error);
          expect(ops).to.have.length(2);
          expect(ops[0].create.data).to.eql({title: '1984'});
          expect(ops[1].op).to.eql([{p: ['author'], oi: 'George Orwell'}]);
          done();
        });
      });

      it('fetches the ops with metadata', function(done) {
        var options = {
          opsOptions: {metadata: true}
        };
        backend.getOps(null, 'books', '1984', 0, null, options, function(error, ops) {
          if (error) return done(error);
          expect(ops).to.have.length(2);
          expect(ops[0].m).to.be.ok;
          expect(ops[1].m).to.be.ok;
          done();
        });
      });
    });

    describe('fetch', function() {
      it('fetches the document', function(done) {
        backend.fetch(null, 'books', '1984', function(error, doc) {
          if (error) return done(error);
          expect(doc.data).to.eql({
            title: '1984',
            author: 'George Orwell'
          });
          done();
        });
      });

      it('fetches the document with metadata', function(done) {
        var options = {
          snapshotOptions: {metadata: true}
        };
        backend.fetch(null, 'books', '1984', options, function(error, doc) {
          if (error) return done(error);
          expect(doc.m).to.be.ok;
          done();
        });
      });
    });

    describe('subscribe', function() {
      it('subscribes to the document', function(done) {
        backend.subscribe(null, 'books', '1984', null, function(error, stream, snapshot) {
          if (error) return done(error);
          expect(stream.open).to.equal(true);
          expect(snapshot.data).to.eql({
            title: '1984',
            author: 'George Orwell'
          });
          var op = {op: {p: ['publication'], oi: 1949}};
          stream.on('data', function(data) {
            expect(data.op).to.eql(op.op);
            done();
          });
          backend.submit(null, 'books', '1984', op, null, function(error) {
            if (error) return done(error);
          });
        });
      });

      it('does not support subscribing to the document with options', function(done) {
        var options = {
          opsOptions: {metadata: true}
        };
        backend.subscribe(null, 'books', '1984', null, options, function(error) {
          expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
          done();
        });
      });
    });
  });
});
