var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');

describe('client submit', function() {

  it('getting twice returns the same doc', function() {
    var backend = new Backend();
    var connection = backend.connect();
    var doc = connection.get('dogs', 'fido');
    var doc2 = connection.get('dogs', 'fido');
    expect(doc).equal(doc2);
  });

  it('getting then destroying then getting returns a new doc object', function() {
    var backend = new Backend();
    var connection = backend.connect();
    var doc = connection.get('dogs', 'fido');
    doc.destroy();
    var doc2 = connection.get('dogs', 'fido');
    expect(doc).not.equal(doc2);
    expect(doc).eql(doc2);
  });

  it('can fetch an uncreated doc', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    expect(doc.snapshot).equal(undefined);
    expect(doc.version).equal(null);
    doc.fetch(function(err) {
      if (err) throw err;
      expect(doc.snapshot).equal(undefined);
      expect(doc.version).equal(0);
      done();
    });
  });

  it('can fetch then create a new doc', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.fetch(function(err) {
      if (err) throw err;
      doc.create('json0', {age: 3}, function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql({age: 3});
        expect(doc.version).eql(1);
        done();
      });
    });
  });

  it('can create a new doc without fetching', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      expect(doc.snapshot).eql({age: 3});
      expect(doc.version).eql(1);
      done();
    });
  });

  it('can create then delete then create a doc', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      expect(doc.snapshot).eql({age: 3});
      expect(doc.version).eql(1);

      doc.del(null, function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql(undefined);
        expect(doc.version).eql(2);

        doc.create('json0', {age: 2}, function(err) {
          if (err) throw err;
          expect(doc.snapshot).eql({age: 2});
          expect(doc.version).eql(3);
          done();
        });
      });
    });
  });

  it('can create then submit an op', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql({age: 5});
        expect(doc.version).eql(2);
        done();
      });
    });
  });

  it('can create then submit an op sync', function() {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3});
    expect(doc.snapshot).eql({age: 3});
    expect(doc.version).eql(null);
    doc.submitOp({p: ['age'], na: 2});
    expect(doc.snapshot).eql({age: 5});
    expect(doc.version).eql(null);
  });

  it('ops submitted sync get composed', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3});
    doc.submitOp({p: ['age'], na: 2});
    doc.submitOp({p: ['age'], na: 2}, function(err) {
      if (err) throw err;
      expect(doc.snapshot).eql({age: 7});
      // Version is 1 instead of 3, because the create and ops got composed
      expect(doc.version).eql(1);
      doc.submitOp({p: ['age'], na: 2});
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql({age: 11});
        // Ops get composed
        expect(doc.version).eql(2);
        doc.submitOp({p: ['age'], na: 2});
        doc.del(function(err) {
          if (err) throw err;
          expect(doc.snapshot).eql(undefined);
          // Op and del get composed
          expect(doc.version).eql(3);
          done();
        });
      });
    });
  });

  it('can create a new doc then fetch', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc.fetch(function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql({age: 3});
        expect(doc.version).eql(1);
        done();
      });
    });
  });

  function delayedReconnect(backend, connection) {
    // Disconnect after the message has sent and before the server will have
    // had a chance to reply
    process.nextTick(function() {
      connection.disconnect();
      // Reconnect once the server has a chance to save the op snapshot
      setTimeout(function() {
        backend.connect(connection);
      }, 5);
    });
  }

  it('resends create when disconnected before ack', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.version).equal(1);
      expect(doc.snapshot).eql({age: 3});
      done();
    });
    delayedReconnect(backend, doc.connection);
  });

  it('resent create on top of deleted doc gets proper starting version', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 4}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);

        var doc2 = backend.connect().get('dogs', 'fido');
        doc2.create('json0', {age: 3}, function(err) {
          if (err) return done(err);
          expect(doc2.version).equal(3);
          expect(doc2.snapshot).eql({age: 3});
          done();
        });
        delayedReconnect(backend, doc2.connection);
      });
    });
  });

  it('resends delete when disconnected before ack', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);
        expect(doc.version).equal(2);
        expect(doc.snapshot).eql(undefined);
        done();
      });
      delayedReconnect(backend, doc.connection);
    });
  });

  it('can commit then fetch in a new connection to get the same data', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc2.fetch(function(err) {
        if (err) throw err;
        expect(doc.snapshot).eql({age: 3});
        expect(doc2.snapshot).eql({age: 3});
        expect(doc.version).eql(1);
        expect(doc2.version).eql(1);
        expect(doc.snapshot).not.equal(doc2.snapshot);
        done();
      });
    });
  });

  it('an op submitted concurrently is transformed by the first', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc2.fetch(function(err) {
        if (err) throw err;
        doc.submitOp({p: ['age'], na: 2});
        doc2.submitOp({p: ['age'], na: 7}, function(err) {
          if (err) throw err;
          expect(doc2.snapshot).eql({age: 12});
          expect(doc2.version).eql(3);
          done();
        });
      });
    });
  });

  it('second of two concurrent creates is rejected', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3});
    doc2.create('json0', {age: 5}, function(err) {
      expect(err).ok();
      expect(doc2.version).eql(1);
      expect(doc2.snapshot).eql({age: 3});
      done();
    });
  });

  it('concurrent delete operations transform', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc2.fetch(function(err) {
        if (err) throw err;
        doc.del();
        doc2.del(function(err) {
          if (err) throw err;
          expect(doc2.version).eql(3);
          expect(doc2.snapshot).eql(undefined);
          done();
        });
      });
    });
  });

  it('second client can create following delete', function(done) {
    var backend = new Backend();
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create('json0', {age: 3}, function(err) {
      if (err) throw err;
      doc.del(function(err) {
        if (err) throw err;
        doc2.create('json0', {age: 5}, function(err) {
          if (err) throw err;
          expect(doc2.version).eql(3);
          expect(doc2.snapshot).eql({age: 5});
          done();
        });
      });
    });
  });

});
