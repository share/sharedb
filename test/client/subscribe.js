var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');

describe('client subscribe', function() {

  it('subscribed client gets create from first client', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc2.subscribe(function(err) {
      if (err) return done(err);
      doc2.on('create', function(context) {
        expect(context).equal(false);
        expect(doc2.version).eql(1);
        expect(doc2.snapshot).eql({age: 3});
        done();
      });
      doc.create('json0', {age: 3});
    });
  });

  it('subscribe fetches initial data', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        expect(doc2.version).eql(1);
        expect(doc2.snapshot).eql({age: 3})
        done();
      });
    });
  });

  it('fetch fetches new ops', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          doc2.on('op', function(op, context) {
            done();
          });
          doc2.fetch();
        });
      });
    });
  });

  it('subscribe fetches new ops', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          doc2.on('op', function(op, context) {
            done();
          });
          doc2.subscribe();
        });
      });
    });
  });

  it('subscribed client gets op from first client', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          expect(doc2.version).eql(2);
          expect(doc2.snapshot).eql({age: 4});
          done();
        });
        doc.submitOp({p: ['age'], na: 1});
      });
    });
  });

  it('unsubscribe stops op updates', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.unsubscribe(function(err) {
          if (err) return done(err);
          done();
          doc2.on('op', function(op, context) {
            done();
          });
          doc.submitOp({p: ['age'], na: 1});
        });
      });
    });
  });

  it('calling subscribe, unsubscribe, subscribe sync leaves a doc subscribed', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe();
      doc2.unsubscribe();
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        doc.submitOp({p: ['age'], na: 1});
      });
    });
  });

  it('calling subscribe, unsubscribe, subscribe sync leaves a doc subscribed', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe();
      doc2.unsubscribe();
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        doc.submitOp({p: ['age'], na: 1});
      });
    });
  });

});
