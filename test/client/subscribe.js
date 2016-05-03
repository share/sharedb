var expect = require('expect.js');
var async = require('async');

module.exports = function() {
describe('client subscribe', function() {

  it('can call bulk without doing any actions', function() {
    var connection = this.backend.connect();
    connection.startBulk();
    connection.endBulk();
  });

  ['fetch', 'subscribe'].forEach(function(method) {
    it(method + ' gets initial data', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2[method](function(err) {
          if (err) return done(err);
          expect(doc2.version).eql(1);
          expect(doc2.data).eql({age: 3});
          done();
        });
      });
    });

    it(method + ' twice simultaneously calls back', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        async.parallel([
          function(cb) { doc2[method](cb); },
          function(cb) { doc2[method](cb); }
        ], function(err) {
          if (err) return done(err);
          expect(doc2.version).eql(1);
          expect(doc2.data).eql({age: 3});
          done();
        });
      });
    });

    it(method + ' twice in bulk simultaneously calls back', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2.connection.startBulk();
        async.parallel([
          function(cb) { doc2[method](cb); },
          function(cb) { doc2[method](cb); }
        ], function(err) {
          if (err) return done(err);
          expect(doc2.version).eql(1);
          expect(doc2.data).eql({age: 3});
          done();
        });
        doc2.connection.endBulk();
      });
    });

    it(method + ' bulk on same collection', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      async.parallel([
        function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
        function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
        function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
      ], function(err) {
        if (err) return done(err);
        var fido = connection2.get('dogs', 'fido');
        var spot = connection2.get('dogs', 'spot');
        var finn = connection2.get('cats', 'finn');
        connection2.startBulk();
        async.parallel([
          function(cb) { fido[method](cb); },
          function(cb) { spot[method](cb); },
          function(cb) { finn[method](cb); }
        ], function(err) {
          if (err) return done(err);
          expect(fido.data).eql({age: 3});
          expect(spot.data).eql({age: 5});
          expect(finn.data).eql({age: 2});
          done();
        });
        connection2.endBulk();
      });
    });

    it(method + ' bulk on same collection from known version', function(done) {
      var connection = this.backend.connect();
      var connection2 = this.backend.connect();
      var fido = connection2.get('dogs', 'fido');
      var spot = connection2.get('dogs', 'spot');
      var finn = connection2.get('cats', 'finn');
      connection2.startBulk();
      async.parallel([
        function(cb) { fido[method](cb); },
        function(cb) { spot[method](cb); },
        function(cb) { finn[method](cb); }
      ], function(err) {
        if (err) return done(err);
        expect(fido.version).equal(0);
        expect(spot.version).equal(0);
        expect(finn.version).equal(0);
        expect(fido.data).equal(undefined);
        expect(spot.data).equal(undefined);
        expect(finn.data).equal(undefined);

        async.parallel([
          function(cb) { connection.get('dogs', 'fido').create({age: 3}, cb); },
          function(cb) { connection.get('dogs', 'spot').create({age: 5}, cb); },
          function(cb) { connection.get('cats', 'finn').create({age: 2}, cb); }
        ], function(err) {
          if (err) return done(err);
          connection2.startBulk();
          async.parallel([
            function(cb) { fido[method](cb); },
            function(cb) { spot[method](cb); },
            function(cb) { finn[method](cb); }
          ], function(err) {
            if (err) return done(err);
            expect(fido.data).eql({age: 3});
            expect(spot.data).eql({age: 5});
            expect(finn.data).eql({age: 2});

            // Test sending a fetch without any new ops being created
            connection2.startBulk();
            async.parallel([
              function(cb) { fido[method](cb); },
              function(cb) { spot[method](cb); },
              function(cb) { finn[method](cb); }
            ], function(err) {
              if (err) return done(err);

              // Create new ops and test if they are received
              async.parallel([
                function(cb) { connection.get('dogs', 'fido').submitOp([{p: ['age'], na: 1}], cb); },
                function(cb) { connection.get('dogs', 'spot').submitOp([{p: ['age'], na: 1}], cb); },
                function(cb) { connection.get('cats', 'finn').submitOp([{p: ['age'], na: 1}], cb); }
              ], function(err) {
                if (err) return done(err);
                connection2.startBulk();
                async.parallel([
                  function(cb) { fido[method](cb); },
                  function(cb) { spot[method](cb); },
                  function(cb) { finn[method](cb); }
                ], function(err) {
                  if (err) return done(err);
                  expect(fido.data).eql({age: 4});
                  expect(spot.data).eql({age: 6});
                  expect(finn.data).eql({age: 3});
                  done();
                });
                connection2.endBulk();
              });
            });
            connection2.endBulk();
          });
          connection2.endBulk();
        });
      });
      connection2.endBulk();
    });

    it(method + ' gets new ops', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2.fetch(function(err) {
          if (err) return done(err);
          doc.submitOp({p: ['age'], na: 1}, function(err) {
            if (err) return done(err);
            doc2.on('op', function(op, context) {
              done();
            });
            doc2[method]();
          });
        });
      });
    });

    it(method + ' calls back after reconnect', function(done) {
      var backend = this.backend;
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2[method](function(err) {
          if (err) return done(err);
          expect(doc2.version).eql(1);
          expect(doc2.data).eql({age: 3});
          done();
        });
        doc2.connection.close();
        process.nextTick(function() {
          backend.connect(doc2.connection);
        });
      });
    });

    it(method + ' returns error passed to doc read middleware', function(done) {
      this.backend.use('doc', function(request, next) {
        next({message: 'Reject doc read'});
      });
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2[method](function(err) {
          expect(err.message).equal('Reject doc read');
          expect(doc2.version).eql(null);
          expect(doc2.data).eql(undefined);
          done();
        });
      });
    });

    it(method + ' emits error passed to doc read middleware', function(done) {
      this.backend.use('doc', function(request, next) {
        next({message: 'Reject doc read'});
      });
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc2[method]();
        doc2.on('error', function(err) {
          expect(err.message).equal('Reject doc read');
          expect(doc2.version).eql(null);
          expect(doc2.data).eql(undefined);
          done();
        });
      });
    });

    it(method + ' will call back when ops are pending', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        doc.pause();
        doc.submitOp({p: ['age'], na: 1});
        doc[method](done);
      });
    });

    it(method + ' will not call back when creating the doc is pending', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.pause();
      doc.create({age: 3});
      doc[method](done);
      // HACK: Delay done call to keep from closing the db connection too soon
      setTimeout(done, 10);
    });

    it(method + ' will wait for write when doc is locally created', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.pause();
      var calls = 0;
      doc.create({age: 3}, function(err) {
        if (err) return done(err);
        calls++;
      });
      doc[method](function(err) {
        if (err) return done(err);
        expect(calls).equal(1);
        expect(doc.version).equal(1);
        expect(doc.data).eql({age: 3});
        done();
      });
      setTimeout(function() {
        doc.resume();
      }, 10);
    });

    it(method + ' will wait for write when doc is locally created and will fail to submit', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.backend.connect().get('dogs', 'fido');
      doc2.create({age: 5}, function(err) {
        if (err) return done(err);
        doc.pause();
        var calls = 0;
        doc.create({age: 3}, function(err) {
          expect(err).ok();
          calls++;
        });
        doc[method](function(err) {
          if (err) return done(err);
          expect(calls).equal(1);
          expect(doc.version).equal(1);
          expect(doc.data).eql({age: 5});
          done();
        });
        setTimeout(function() {
          doc.resume();
        }, 10);
      });
    });
  });

  it('unsubscribe calls back immediately on disconnect', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.subscribe(function(err) {
      if (err) return done(err);
      doc.unsubscribe(done);
      doc.connection.close();
    });
  });

  it('unsubscribe calls back immediately when already disconnected', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    doc.subscribe(function(err) {
      if (err) return done(err);
      doc.connection.close();
      doc.unsubscribe(done);
    });
  });

  it('subscribed client gets create from other client', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc2.subscribe(function(err) {
      if (err) return done(err);
      doc2.on('create', function(context) {
        expect(context).equal(false);
        expect(doc2.version).eql(1);
        expect(doc2.data).eql({age: 3});
        done();
      });
      doc.create({age: 3});
    });
  });

  it('subscribed client gets op from other client', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          expect(doc2.version).eql(2);
          expect(doc2.data).eql({age: 4});
          done();
        });
        doc.submitOp({p: ['age'], na: 1});
      });
    });
  });

  it('disconnecting stops op updates', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        doc2.connection.close();
        doc.submitOp({p: ['age'], na: 1}, done);
      });
    });
  });

  it('backend.suppressPublish stops op updates', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        backend.suppressPublish = true;
        doc.submitOp({p: ['age'], na: 1}, done);
      });
    });
  });

  it('unsubscribe stops op updates', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        doc2.unsubscribe(function(err) {
          if (err) return done(err);
          doc.submitOp({p: ['age'], na: 1}, done);
        });
      });
    });
  });

  it('doc destroy stops op updates', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          done();
        });
        doc2.destroy(function(err) {
          if (err) return done(err);
          doc.submitOp({p: ['age'], na: 1}, done);
        });
      });
    });
  });

  it('bulk unsubscribe stops op updates', function(done) {
    var connection = this.backend.connect();
    var connection2 = this.backend.connect();
    var doc = connection.get('dogs', 'fido');
    var fido = connection2.get('dogs', 'fido');
    var spot = connection2.get('dogs', 'spot');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      async.parallel([
        function(cb) { fido.subscribe(cb); },
        function(cb) { spot.subscribe(cb); }
      ], function(err) {
        if (err) return done(err);
        fido.connection.startBulk();
        async.parallel([
          function(cb) { fido.unsubscribe(cb); },
          function(cb) { spot.unsubscribe(cb); }
        ], function(err) {
          if (err) return done(err);
          fido.on('op', function(op, context) {
            done();
          });
          doc.submitOp({p: ['age'], na: 1}, done);
        });
        fido.connection.endBulk();
      });
    });
  });

  it('a subscribed doc is re-subscribed after reconnect and gets any missing ops', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        doc2.on('op', function(op, context) {
          expect(doc2.version).eql(2);
          expect(doc2.data).eql({age: 4});
          done();
        });

        doc2.connection.close();
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          backend.connect(doc2.connection);
        });
      });
    });
  });

  it('calling subscribe, unsubscribe, subscribe sync leaves a doc subscribed', function(done) {
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
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

  it('doc fetches ops to catch up if it receives a future op', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        var expected = [
          [{p: ['age'], na: 1}],
          [{p: ['age'], na: 5}],
        ];
        doc2.on('op', function(op, context) {
          var item = expected.shift();
          expect(op).eql(item);
          if (expected.length) return;
          expect(doc2.version).equal(3);
          expect(doc2.data).eql({age: 9});
          done();
        });
        backend.suppressPublish = true;
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          backend.suppressPublish = false;
          doc.submitOp({p: ['age'], na: 5});
        });
      });
    });
  });

  it('doc fetches ops to catch up if it receives multiple future ops', function(done) {
    var backend = this.backend;
    var doc = this.backend.connect().get('dogs', 'fido');
    var doc2 = this.backend.connect().get('dogs', 'fido');
    // Delaying op replies will cause multiple future ops to be received
    // before the fetch to catch up completes
    backend.use('op', function(request, next) {
      setTimeout(next, 10 * Math.random());
    });
    doc.create({age: 3}, function(err) {
      if (err) return done(err);
      doc2.subscribe(function(err) {
        if (err) return done(err);
        var wait = 4;
        doc2.on('op', function(op, context) {
          if (--wait) return;
          expect(doc2.version).eql(5);
          expect(doc2.data).eql({age: 122});
          done();
        });
        backend.suppressPublish = true;
        doc.submitOp({p: ['age'], na: 1}, function(err) {
          if (err) return done(err);
          backend.suppressPublish = false;
          doc.submitOp({p: ['age'], na: 5}, function(err) {
            if (err) return done(err);
            doc.submitOp({p: ['age'], na: 13}, function(err) {
              if (err) return done(err);
              doc.submitOp({p: ['age'], na: 100});
            });
          });
        });
      });
    });
  });

  describe('doc.subscribed', function() {
    it('is set to false initially', function() {
      var doc = this.backend.connect().get('dogs', 'fido');
      expect(doc.subscribed).equal(false);
    });

    it('remains false before subscribe call completes', function() {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.subscribe();
      expect(doc.subscribed).equal(false);
    });

    it('is set to true after subscribe completes', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.subscribe(function(err) {
        if (err) return done(err);
        expect(doc.subscribed).equal(true);
        done();
      });
    });

    it('is not set to true after subscribe completes if already unsubscribed', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.subscribe(function(err) {
        if (err) return done(err);
        expect(doc.subscribed).equal(false);
        done();
      });
      doc.unsubscribe();
    });

    it('is set to false sychronously in unsubscribe', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.subscribe(function(err) {
        if (err) return done(err);
        expect(doc.subscribed).equal(true);
        doc.unsubscribe();
        expect(doc.subscribed).equal(false);
        done();
      });
    });

    it('is set to false sychronously on disconnect', function(done) {
      var doc = this.backend.connect().get('dogs', 'fido');
      doc.subscribe(function(err) {
        if (err) return done(err);
        expect(doc.subscribed).equal(true);
        doc.connection.close();
        expect(doc.subscribed).equal(false);
        done();
      });
    });
  });
});
};
