var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');

module.exports = function() {
describe('client submit', function() {

  it('getting twice returns the same doc', function() {
    var backend = new Backend({db: this.db});
    var connection = backend.connect();
    var doc = connection.get('dogs', 'fido');
    var doc2 = connection.get('dogs', 'fido');
    expect(doc).equal(doc2);
  });

  it('getting then destroying then getting returns a new doc object', function() {
    var backend = new Backend({db: this.db});
    var connection = backend.connect();
    var doc = connection.get('dogs', 'fido');
    doc.destroy();
    var doc2 = connection.get('dogs', 'fido');
    expect(doc).not.equal(doc2);
    expect(doc).eql(doc2);
  });

  it('can fetch an uncreated doc', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    expect(doc.data).equal(undefined);
    expect(doc.version).equal(null);
    doc.fetch(function(err) {
      if (err) return done(err);
      expect(doc.data).equal(undefined);
      expect(doc.version).equal(0);
      done();
    });
  });

  it('can fetch then create a new doc', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.fetch(function(err) {
      if (err) return done(err);
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 3});
        expect(doc.version).eql(1);
        done();
      });
    });
  });

  it('can create a new doc without fetching', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 3});
      expect(doc.version).eql(1);
      done();
    });
  });

  it('can create then delete then create a doc', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 3});
      expect(doc.version).eql(1);

      doc.del(null, function(err) {
        if (err) return done(err);
        expect(doc.data).eql(undefined);
        expect(doc.version).eql(2);

        doc.create({age: 2}, function(err) {
          if (err) return done(err);
          expect(doc.data).eql({age: 2});
          expect(doc.version).eql(3);
          done();
        });
      });
    });
  });

  it('can create then submit an op', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 5});
        expect(doc.version).eql(2);
        done();
      });
    });
  });

  it('can create then submit an op sync', function() {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    expect(doc.data).eql({age: 3});
    expect(doc.version).eql(null);
    doc.submitOp({p: ['age'], na: 2});
    expect(doc.data).eql({age: 5});
    expect(doc.version).eql(null);
  });

  it('ops submitted sync get composed', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    doc.submitOp({p: ['age'], na: 2});
    doc.submitOp({p: ['age'], na: 2}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 7});
      // Version is 1 instead of 3, because the create and ops got composed
      expect(doc.version).eql(1);
      doc.submitOp({p: ['age'], na: 2});
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 11});
        // Ops get composed
        expect(doc.version).eql(2);
        doc.submitOp({p: ['age'], na: 2});
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

  it('can create a new doc then fetch', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.fetch(function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 3});
        expect(doc.version).eql(1);
        done();
      });
    });
  });

  it('calling create on the same doc twice fails', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.create({age: 4}, function(err) {
        expect(err).ok();
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
    });
  });

  it('trying to create an already created doc without fetching fails and fetches', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.create({age: 4}, function(err) {
        expect(err).ok();
        expect(doc2.version).equal(1);
        expect(doc2.data).eql({age: 3});
        done();
      });
    });
  });

  function delayedReconnect(backend, connection) {
    // Disconnect after the message has sent and before the server will have
    // had a chance to reply
    process.nextTick(function() {
      connection.disconnect();
      // Reconnect once the server has a chance to save the op data
      setTimeout(function() {
        backend.connect(connection);
      }, 100);
    });
  }

  it('resends create when disconnected before ack', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 3});
      done();
    });
    delayedReconnect(backend, doc.connection);
  });

  it('resent create on top of deleted doc gets proper starting version', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 4}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);

        var doc2 = backend.connect().get('dogs', 'fido');
        doc2.create({age: 3}, function(err) {
          if (err) return done(err);
          expect(doc2.version).equal(3);
          expect(doc2.data).eql({age: 3});
          done();
        });
        delayedReconnect(backend, doc2.connection);
      });
    });
  });

  it('resends delete when disconnected before ack', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);
        expect(doc.version).equal(2);
        expect(doc.data).eql(undefined);
        done();
      });
      delayedReconnect(backend, doc.connection);
    });
  });

  it('op submitted during inflight create does not compose and gets flushed', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    // Submit an op after message is sent but before server has a chance to reply
    process.nextTick(function() {
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.version).equal(2);
        expect(doc.data).eql({age: 5});
        done();
      });
    });
  });

  it('can commit then fetch in a new connection to get the same data', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 3});
        expect(doc2.data).eql({age: 3});
        expect(doc.version).eql(1);
        expect(doc2.version).eql(1);
        expect(doc.data).not.equal(doc2.data);
        done();
      });
    });
  });

  it('an op submitted concurrently is transformed by the first', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        var count = 0;
        doc.submitOp({p: ['age'], na: 2}, function(err) {
          count++;
          if (err) return done(err);
          if (count === 1) {
            expect(doc.data).eql({age: 5});
            expect(doc.version).eql(2);
          } else {
            expect(doc.data).eql({age: 12});
            expect(doc.version).eql(3);
            done();
          }
        });
        doc2.submitOp({p: ['age'], na: 7}, function(err) {
          count++;
          if (err) return done(err);
          if (count === 1) {
            expect(doc2.data).eql({age: 10});
            expect(doc2.version).eql(2);
          } else {
            expect(doc2.data).eql({age: 12});
            expect(doc2.version).eql(3);
            done();
          }
        });
      });
    });
  });

  it('second of two concurrent creates is rejected', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    var count = 0;
    doc.create({age: 3}, function(err) {
      count++;
      if (count === 1) {
        if (err) return done(err);
        expect(doc.version).eql(1);
        expect(doc.data).eql({age: 3});
      } else {
        expect(err).ok();
        expect(doc.version).eql(1);
        expect(doc.data).eql({age: 5});
        done();
      }
    });
    doc2.create({age: 5}, function(err) {
      count++;
      if (count === 1) {
        if (err) return done(err);
        expect(doc2.version).eql(1);
        expect(doc2.data).eql({age: 5});
      } else {
        expect(err).ok();
        expect(doc2.version).eql(1);
        expect(doc2.data).eql({age: 3});
        done();
      }
    });
  });

  it('concurrent delete operations transform', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        var count = 0;
        doc.del(function(err) {
          count++;
          if (err) return done(err);
          if (count === 1) {
            expect(doc.version).eql(2);
            expect(doc.data).eql(undefined);
          } else {
            expect(doc.version).eql(3);
            expect(doc.data).eql(undefined);
            done();
          }
        });
        doc2.del(function(err) {
          count++;
          if (err) return done(err);
          if (count === 1) {
            expect(doc2.version).eql(2);
            expect(doc2.data).eql(undefined);
          } else {
            expect(doc2.version).eql(3);
            expect(doc2.data).eql(undefined);
            done();
          }
        });
      });
    });
  });

  it('second client can create following delete', function(done) {
    var backend = new Backend({db: this.db});
    var doc = backend.connect().get('dogs', 'fido');
    var doc2 = backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);
        doc2.create({age: 5}, function(err) {
          if (err) return done(err);
          expect(doc2.version).eql(3);
          expect(doc2.data).eql({age: 5});
          done();
        });
      });
    });
  });

});
};
