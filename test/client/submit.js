var async = require('async');
var expect = require('expect.js');
var types = require('../../lib/types');
var deserializedType = require('./deserialized-type');
var numberType = require('./number-type');
var otRichText = require('@teamwork/ot-rich-text');
types.register(deserializedType.type);
types.register(deserializedType.type2);
types.register(numberType.type);
types.register(otRichText.type);

module.exports = function() {
describe('client submit', function() {

  it('can fetch an uncreated doc', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 3});
      expect(doc.version).eql(1);
      done();
    });
  });

  it('can create then delete then create a doc', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
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

  it('can create then submit an op sync', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    expect(doc.data).eql({age: 3});
    expect(doc.version).eql(null);
    doc.submitOp({p: ['age'], na: 2});
    expect(doc.data).eql({age: 5});
    expect(doc.version).eql(null);
    doc.whenNothingPending(done);
  });

  it('submitting an op from a future version fails', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.version++;
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        expect(err).ok();
        done();
      });
    });
  });

  it('cannot submit op on an uncreated doc', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.submitOp({p: ['age'], na: 2}, function(err) {
      expect(err).ok();
      done();
    });
  });

  it('cannot delete an uncreated doc', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.del(function(err) {
      expect(err).ok();
      done();
    });
  });

  it('ops submitted sync get composed', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
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

  it('does not compose ops when doc.preventCompose is true', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.preventCompose = true;
    doc.create({age: 3});
    doc.submitOp({p: ['age'], na: 2});
    doc.submitOp({p: ['age'], na: 2}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 7});
      // Compare to version in above test
      expect(doc.version).eql(3);
      doc.submitOp({p: ['age'], na: 2});
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 11});
        // Compare to version in above test
        expect(doc.version).eql(5);
        done();
      });
    });
  });

  it('resumes composing after doc.preventCompose is set back to false', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.preventCompose = true;
    doc.create({age: 3});
    doc.submitOp({p: ['age'], na: 2});
    doc.submitOp({p: ['age'], na: 2}, function(err) {
      if (err) return done(err);
      expect(doc.data).eql({age: 7});
      // Compare to version in above test
      expect(doc.version).eql(3);
      // Reset back to start composing ops again
      doc.preventCompose = false;
      doc.submitOp({p: ['age'], na: 2});
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.data).eql({age: 11});
        // Compare to version in above test
        expect(doc.version).eql(4);
        done();
      });
    });
  });

  it('can create a new doc then fetch', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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

  it('server fetches and transforms by already committed op', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          doc2.submitOp({p: ['age'], na: 2}, function(err) {
            if (err) return done(err);
            expect(doc2.version).equal(3);
            expect(doc2.data).eql({age: 6});
            done();
          });
        });
      });
    });
  });

  it('submit fails if the server is missing ops required for transforming', function(done) {
    this.backend.db.getOpsToSnapshot = function(collection, id, from, snapshot, options, callback) {
      callback(null, []);
    };
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          doc2.submitOp({p: ['age'], na: 2}, function(err) {
            expect(err).ok();
            done();
          });
        });
      });
    });
  });

  it('submit fails if ops returned are not the expected version', function(done) {
    var getOpsToSnapshot = this.backend.db.getOpsToSnapshot;
    this.backend.db.getOpsToSnapshot = function(collection, id, from, snapshot, options, callback) {
      getOpsToSnapshot.call(this, collection, id, from, snapshot, options, function(err, ops) {
        ops[0].v++;
        callback(null, ops);
      });
    };
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          doc2.submitOp({p: ['age'], na: 2}, function(err) {
            expect(err).ok();
            done();
          });
        });
      });
    });
  });

  function delayedReconnect(backend, connection) {
    // Disconnect after the message has sent and before the server will have
    // had a chance to reply
    process.nextTick(function() {
      connection.close();
      // Reconnect once the server has a chance to save the op data
      setTimeout(function() {
        backend.connect(connection);
      }, 100);
    });
  }

  it('resends create when disconnected before ack', function(done) {
    var backend = this.backend;
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
    var backend = this.backend;
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
    var backend = this.backend;
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
    var doc = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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

  it('submits retry below the backend.maxSubmitRetries threshold', function(done) {
    this.backend.maxSubmitRetries = 10;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        var count = 0;
        var cb = function(err) {
          count++;
          if (err) return done(err);
          if (count > 1) done();
        };
        doc.submitOp({p: ['age'], na: 2}, cb);
        doc2.submitOp({p: ['age'], na: 7}, cb);
      });
    });
  });

  it('submits fail above the backend.maxSubmitRetries threshold', function(done) {
    this.backend.maxSubmitRetries = 0;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        var count = 0;
        var cb = function(err) {
          count++;
          if (count === 1) {
            if (err) return done(err);
          } else {
            expect(err).ok();
            done();
          }
        };
        doc.submitOp({p: ['age'], na: 2}, cb);
        doc2.submitOp({p: ['age'], na: 7}, cb);
      });
    });
  });

  it('pending delete transforms incoming ops', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc2.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          async.parallel([
            function(cb) { doc.del(cb); },
            function(cb) { doc.create({age: 5}, cb); }
          ], function(err) {
            if (err) return done(err);
            expect(doc.version).equal(4);
            expect(doc.data).eql({age: 5});
            done();
          });
        });
      });
    });
  });

  it('pending delete transforms incoming delete', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc2.del(function(err) {
          if (err) return done(err);
          async.parallel([
            function(cb) { doc.del(cb); },
            function(cb) { doc.create({age: 5}, cb); }
          ], function(err) {
            if (err) return done(err);
            expect(doc.version).equal(4);
            expect(doc.data).eql({age: 5});
            done();
          });
        });
      });
    });
  });

  it('submitting op after delete returns error', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc2.del(function(err) {
          if (err) return done(err);
          doc.submitOp({p: ['age'], na: 1}, function(err) {
            expect(err).ok();
            expect(doc.version).equal(1);
            expect(doc.data).eql({age: 3});
            done();
          });
        });
      });
    });
  });

  it('transforming pending op by server delete returns error', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc2.del(function(err) {
          if (err) return done(err);
          doc.pause();
          doc.submitOp({p: ['age'], na: 1}, function(err) {
            expect(err).ok();
            expect(err.code).to.equal(4017);
            expect(doc.version).equal(2);
            expect(doc.data).eql(undefined);
            done();
          });
          doc.fetch();
        });
      });
    });
  });

  it('transforming pending op by server create returns error', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);
        doc2.fetch(function(err) {
          if (err) return done(err);
          doc2.create({age: 5}, function(err) {
            if (err) return done(err);
            doc.pause();
            doc.create({age: 9}, function(err) {
              expect(err).ok();
              expect(err.code).to.equal(4018);
              expect(doc.version).equal(3);
              expect(doc.data).eql({age: 5});
              done();
            });
            doc.fetch();
          });
        });
      });
    });
  });

  it('second client can create following delete', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
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

  it('doc.pause() prevents ops from being sent', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.pause();
    doc.create({age: 3}, done);
    done();
  });

  it('can call doc.resume() without pausing', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.resume();
    doc.create({age: 3}, done);
  });

  it('doc.resume() resumes sending ops after pause', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.pause();
    doc.create({age: 3}, done);
    doc.resume();
  });

  it('pending ops are transformed by ops from other clients', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc.pause();
        doc.submitOp({p: ['age'], na: 1});
        doc.submitOp({p: ['color'], oi: 'gold'});
        expect(doc.version).equal(1);

        doc2.submitOp({p: ['age'], na: 5});
        process.nextTick(function() {
          doc2.submitOp({p: ['sex'], oi: 'female'}, function(err) {
            if (err) return done(err);
            expect(doc2.version).equal(3);

            async.parallel([
              function(cb) { doc.fetch(cb); },
              function(cb) { doc2.fetch(cb); }
            ], function(err) {
              if (err) return done(err);
              expect(doc.data).eql({age: 9, color: 'gold', sex: 'female'});
              expect(doc.version).equal(3);
              expect(doc.hasPending()).equal(true);

              expect(doc2.data).eql({age: 8, sex: 'female'});
              expect(doc2.version).equal(3);
              expect(doc2.hasPending()).equal(false);

              doc.resume();
              doc.whenNothingPending(function() {
                doc2.fetch(function(err) {
                  if (err) return done(err);
                  expect(doc.data).eql({age: 9, color: 'gold', sex: 'female'});
                  expect(doc.version).equal(4);
                  expect(doc.hasPending()).equal(false);

                  expect(doc2.data).eql({age: 9, color: 'gold', sex: 'female'});
                  expect(doc2.version).equal(4);
                  expect(doc2.hasPending()).equal(false);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('snapshot fetch does not revert the version of deleted doc without pending ops', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    this.backend.use('doc', function(request, next) {
      doc.create({age: 3});
      doc.del(next);
    });
    doc.fetch(function(err) {
      if (err) return done(err);
      expect(doc.version).equal(2);
      done();
    });
  });

  it('snapshot fetch does not revert the version of deleted doc with pending ops', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    this.backend.use('doc', function(request, next) {
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        next();
      });
      process.nextTick(function() {
        doc.pause();
        doc.del(done);
      });
    });
    doc.fetch(function(err) {
      if (err) return done(err);
      expect(doc.version).equal(1);
      doc.resume();
    });
  });

  it('snapshot fetch from query does not advance version of doc with pending ops', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({name: 'kido'}, function(err) {
      if (err) return done(err);
      doc2.fetch(function(err) {
        if (err) return done(err);
        doc2.submitOp({p: ['name', 0], si: 'f'}, function(err) {
          if (err) return done(err);
          expect(doc2.data).eql({name: 'fkido'});
          doc.connection.createFetchQuery('dogs', {}, null, function(err) {
            if (err) return done(err);
            doc.resume();
          });
        });
      });
    });
    process.nextTick(function() {
      doc.pause();
      doc.submitOp({p: ['name', 0], sd: 'k'}, function(err) {
        if (err) return done(err);
        doc.pause();
        doc2.fetch(function(err) {
          if (err) return done(err);
          expect(doc2.version).equal(3);
          expect(doc2.data).eql({name: 'fido'});
          done();
        });
      });
      doc.del();
    });
  });

  it('passing an error in submit middleware rejects a create and calls back with the erorr', function(done) {
    this.backend.use('submit', function(request, next) {
      next({message: 'Custom error'});
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      expect(err.message).equal('Custom error');
      expect(doc.version).equal(0);
      expect(doc.data).equal(undefined);
      done();
    });
    expect(doc.version).equal(null);
    expect(doc.data).eql({age: 3});
  });

  it('passing an error in submit middleware rejects a create and throws the erorr', function(done) {
    this.backend.use('submit', function(request, next) {
      next({message: 'Custom error'});
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    expect(doc.version).equal(null);
    expect(doc.data).eql({age: 3});
    doc.on('error', function(err) {
      expect(err.message).equal('Custom error');
      expect(doc.version).equal(0);
      expect(doc.data).equal(undefined);
      done();
    });
  });

  it('passing an error in submit middleware rejects pending ops after failed create', function(done) {
    var submitCount = 0;
    this.backend.use('submit', function(request, next) {
      submitCount++;
      if (submitCount === 1) return next({message: 'Custom error'});
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    async.parallel([
      function(cb) {
        doc.create({age: 3}, function(err) {
          expect(err.message).equal('Custom error');
          expect(doc.version).equal(0);
          expect(doc.data).equal(undefined);
          cb();
        });
        expect(doc.version).equal(null);
        expect(doc.data).eql({age: 3});
      },
      function(cb) {
        process.nextTick(function() {
          doc.submitOp({p: ['age'], na: 1}, function(err) {
            expect(err.message).equal('Custom error');
            expect(doc.version).equal(0);
            expect(doc.data).equal(undefined);
            expect(submitCount).equal(1);
            cb();
          });
          expect(doc.version).equal(null);
          expect(doc.data).eql({age: 4});
        });
      }
    ], done);
  });

  it('request.rejectedError() soft rejects a create', function(done) {
    this.backend.use('submit', function(request, next) {
      next(request.rejectedError());
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.version).equal(0);
      expect(doc.data).equal(undefined);
      done();
    });
    expect(doc.version).equal(null);
    expect(doc.data).eql({age: 3});
  });

  it('request.rejectedError() soft rejects a create without callback', function(done) {
    this.backend.use('submit', function(request, next) {
      next(request.rejectedError());
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3});
    expect(doc.version).equal(null);
    expect(doc.data).eql({age: 3});
    doc.whenNothingPending(function() {
      expect(doc.version).equal(0);
      expect(doc.data).equal(undefined);
      done();
    });
  });

  it('passing an error in submit middleware rejects an op and calls back with the erorr', function(done) {
    this.backend.use('submit', function(request, next) {
      if (request.op.op) return next({message: 'Custom error'});
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 1}, function(err) {
        expect(err.message).equal('Custom error');
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 4});
    });
  });

  it('passing an error in submit middleware rejects an op and emits the erorr', function(done) {
    this.backend.use('submit', function(request, next) {
      if (request.op.op) return next({message: 'Custom error'});
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 1});
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 4});
      doc.on('error', function(err) {
        expect(err.message).equal('Custom error');
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
    });
  });

  it('passing an error in submit middleware transforms pending ops after failed op', function(done) {
    var submitCount = 0;
    this.backend.use('submit', function(request, next) {
      submitCount++;
      if (submitCount === 2) return next({message: 'Custom error'});
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      async.parallel([
        function(cb) {
          doc.submitOp({p: ['age'], na: 1}, function(err) {
            expect(err.message).equal('Custom error');
            cb();
          });
          expect(doc.version).equal(1);
          expect(doc.data).eql({age: 4});
        },
        function(cb) {
          process.nextTick(function() {
            doc.submitOp({p: ['age'], na: 5}, cb);
            expect(doc.version).equal(1);
            expect(doc.data).eql({age: 9});
          });
        }
      ], function(err) {
        if (err) return done(err);
        expect(doc.version).equal(2);
        expect(doc.data).eql({age: 8});
        expect(submitCount).equal(3);
        done();
      });
    });
  });

  it('request.rejectedError() soft rejects an op', function(done) {
    this.backend.use('submit', function(request, next) {
      if (request.op.op) return next(request.rejectedError());
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 1}, function(err) {
        if (err) return done(err);
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 4});
    });
  });

  it('request.rejectedError() soft rejects an op without callback', function(done) {
    this.backend.use('submit', function(request, next) {
      if (request.op.op) return next(request.rejectedError());
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 1});
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 4});
      doc.whenNothingPending(function() {
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
    });
  });

  it('setting op.op to null makes it a no-op while returning success to the submitting client', function(done) {
    this.backend.use('submit', function(request, next) {
      if (request.op) request.op.op = null;
      next();
    });
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 1}, function(err) {
        if (err) return done(err);
        expect(doc.version).equal(2);
        expect(doc.data).eql({age: 4});
        doc2.fetch(function(err) {
          if (err) return done(err);
          expect(doc2.version).equal(2);
          expect(doc2.data).eql({age: 3});
          done();
        });
      });
      expect(doc.version).equal(1);
      expect(doc.data).eql({age: 4});
    });
  });

  it('submitting an invalid op message returns error', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc._submit({}, null, function(err) {
        expect(err).ok();
        done();
      });
    });
  });

  it('hasWritePending is false when create\'s callback is executed', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      expect(doc.hasWritePending()).equal(false);
      done();
    });
  });

  it('hasWritePending is false when submimtOp\'s callback is executed', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.submitOp({p: ['age'], na: 2}, function(err) {
        if (err) return done(err);
        expect(doc.hasWritePending()).equal(false);
        done();
      });
    });
  });

  it('hasWritePending is false when del\'s callback is executed', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc.del(function(err) {
        if (err) return done(err);
        expect(doc.hasWritePending()).equal(false);
        done();
      });
    });
  });

  it('allows snapshot and op to be a non-object', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create(5, numberType.type.uri, function (err) {
      if (err) return done(err);
      expect(doc.data).to.equal(5);
      doc.submitOp(2, function(err) {
        if (err) return done(err);
        expect(doc.data).to.equal(7);
        done();
      });
    });
  });

  it('does not skip processing when submitting a no-op by default', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
      done();
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitOp([]);
  });

  it('does not skip processing when submitting an identical snapshot by default', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
      done();
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('test') ]);
  });

  it('skips processing when submitting a no-op (no callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitOp([], { skipNoop: true });
    expect(doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
    done();
  });

  it('skips processing when submitting a no-op (with callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitOp([], { skipNoop: true }, done);
  });

  it('skips processing when submitting an identical snapshot (no callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('test') ], { skipNoop: true });
    expect(doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
    done();
  });

  it('skips processing when submitting an identical snapshot (with callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('test') ], { skipNoop: true }, done);
  });

  it('submits a snapshot when document is not created (no callback, no options)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4015);
      done();
    });
    doc.submitSnapshot(7);
  });

  it('submits a snapshot when document is not created (no callback, with options)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4015);
      done();
    });
    doc.submitSnapshot(7, { source: 'test' });
  });

  it('submits a snapshot when document is not created (with callback, no options)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', done);
    doc.submitSnapshot(7, function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4015);
      done();
    });
  });

  it('submits a snapshot when document is not created (with callback, with options)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', done);
    doc.submitSnapshot(7, { source: 'test' }, function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4015);
      done();
    });
  });

  it('submits a snapshot with source (no callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
      expect(source).to.equal('test');
      done();
    });
    doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' });
  });

  it('submits a snapshot with source (with callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var opEmitted = false;
    doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
      expect(source).to.equal('test');
      opEmitted = true;
    });
    doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' }, function(error) {
      expect(opEmitted).to.equal(true);
      done(error);
    });
  });

  it('submits a snapshot without source (no callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
      expect(source).to.equal(true);
      done();
    });
    doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ]);
  });

  it('submits a snapshot without source (with callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var opEmitted = false;
    doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
      expect(source).to.equal(true);
      opEmitted = true;
    });
    doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
    doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], function(error) {
      expect(opEmitted).to.equal(true);
      done(error);
    });
  });

  it('submits a snapshot and syncs it', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc2.on('create', function() {
      doc2.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ]);
    });
    doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
      expect(source).to.equal(false);
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
      done();
    });
    doc.subscribe(function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
      });
    });
  });

  it('submits a snapshot (no diff, no diffX, no callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4027);
      done();
    });
    doc.create({ test: 5 });
    doc.submitSnapshot({ test: 7 });
  });

  it('submits a snapshot (no diff, no diffX, with callback)', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.on('error', done);
    doc.create({ test: 5 });
    doc.submitSnapshot({ test: 7 }, function(error) {
      expect(error).to.be.an(Error);
      expect(error.code).to.equal(4027);
      done();
    });
  });

  it('submits a snapshot without a diffHint', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
    doc.on('op', function(op) {
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
      expect(op).to.eql([ otRichText.Action.createInsertText('a') ]);
      done();
    });
    doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ]);
  });

  it('submits a snapshot with a diffHint', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
    doc.on('op', function(op) {
      expect(doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
      expect(op).to.eql([ otRichText.Action.createRetain(2), otRichText.Action.createInsertText('a') ]);
      done();
    });
    doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ], { diffHint: 2 });
  });

  describe('type.deserialize', function() {
    it('can create a new doc', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create([3], deserializedType.type.uri, function(err) {
        if (err) return done(err);
        expect(doc.data).a(deserializedType.Node);
        expect(doc.data).eql({value: 3, next: null});
        done();
      });
    });

    it('is stored serialized in backend', function(done) {
      var db = this.backend.db;
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create([3], deserializedType.type.uri, function(err) {
        if (err) return done(err);
        db.getSnapshot('dogs', 'fido', null, null, function(err, snapshot) {
          if (err) return done(err);
          expect(snapshot.data).eql([3]);
          done();
        });
      });
    });

    it('deserializes on fetch', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      var backend = this.backend;
      doc.create([3], deserializedType.type.uri, function(err) {
        if (err) return done(err);
        doc2.fetch(function(err) {
          if (err) return done(err);
          expect(doc2.data).a(deserializedType.Node);
          expect(doc2.data).eql({value: 3, next: null});
          done();
        });
      });
    });

    it('can create then submit an op', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create([3], deserializedType.type.uri, function(err) {
        if (err) return done(err);
        doc.submitOp({insert: 0, value: 2}, function(err) {
          if (err) return done(err);
          expect(doc.data).eql({value: 2, next: {value: 3, next: null}});
          done();
        });
      });
    });

    it('server fetches and transforms by already committed op', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      var backend = this.backend;
      doc.create([3], deserializedType.type.uri, function(err) {
        if (err) return done(err);
        doc2.fetch(function(err) {
          if (err) return done(err);
          doc.submitOp({insert: 0, value: 2}, function(err) {
            if (err) return done(err);
            doc2.submitOp({insert: 1, value: 4}, function(err) {
              if (err) return done(err);
              expect(doc2.data).eql({value: 2, next: {value: 3, next: {value: 4, next: null}}});
              done();
            });
          });
        });
      });
    });
  });

  describe('type.createDeserialized', function() {
    it('can create a new doc', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create([3], deserializedType.type2.uri, function(err) {
        if (err) return done(err);
        expect(doc.data).a(deserializedType.Node);
        expect(doc.data).eql({value: 3, next: null});
        done();
      });
    });

    it('can create a new doc from deserialized form', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create(new deserializedType.Node(3), deserializedType.type2.uri, function(err) {
        if (err) return done(err);
        expect(doc.data).a(deserializedType.Node);
        expect(doc.data).eql({value: 3, next: null});
        done();
      });
    });
  });

});
};
