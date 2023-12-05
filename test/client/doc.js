var Backend = require('../../lib/backend');
var expect = require('chai').expect;
var async = require('async');
var json0 = require('ot-json0').type;
var richText = require('rich-text').type;
var ShareDBError = require('../../lib/error');
var errorHandler = require('../util').errorHandler;
var sinon = require('sinon');
var types = require('../../lib/types');

describe('Doc', function() {
  beforeEach(function() {
    this.backend = new Backend();
    this.connection = this.backend.connect();
  });

  it('getting twice returns the same doc', function() {
    var doc = this.connection.get('dogs', 'fido');
    var doc2 = this.connection.get('dogs', 'fido');
    expect(doc).equal(doc2);
  });

  it('calling doc.destroy unregisters it', function(done) {
    var connection = this.connection;
    var doc = connection.get('dogs', 'fido');
    expect(connection.getExisting('dogs', 'fido')).equal(doc);

    doc.destroy(function(err) {
      if (err) return done(err);
      expect(connection.getExisting('dogs', 'fido')).equal(undefined);

      var doc2 = connection.get('dogs', 'fido');
      expect(doc).not.equal(doc2);
      done();
    });

    // destroy is async
    expect(connection.getExisting('dogs', 'fido')).equal(doc);
  });

  it('getting then destroying then getting returns a new doc object', function(done) {
    var connection = this.connection;
    var doc = connection.get('dogs', 'fido');
    doc.destroy(function(err) {
      if (err) return done(err);
      var doc2 = connection.get('dogs', 'fido');
      expect(doc).not.equal(doc2);
      done();
    });
  });

  it('destroying then getting synchronously does not destroy the new doc', function(done) {
    var connection = this.connection;
    var doc = connection.get('dogs', 'fido');
    var doc2;

    doc.create({name: 'fido'}, function(error) {
      if (error) return done(error);

      doc.destroy(function(error) {
        if (error) return done(error);
        var doc3 = connection.get('dogs', 'fido');
        async.parallel([
          doc2.submitOp.bind(doc2, [{p: ['snacks'], oi: true}]),
          doc3.submitOp.bind(doc3, [{p: ['color'], oi: 'gray'}])
        ], done);
      });

      doc2 = connection.get('dogs', 'fido');
    });
  });

  it('doc.destroy() works without a callback', function() {
    var doc = this.connection.get('dogs', 'fido');
    doc.destroy();
  });

  it('errors when trying to set a very large seq', function(done) {
    var connection = this.connection;
    connection.seq = Number.MAX_SAFE_INTEGER;
    var doc = connection.get('dogs', 'fido');
    doc.create({name: 'fido'});
    doc.once('error', function(error) {
      expect(error.code).to.equal('ERR_CONNECTION_SEQ_INTEGER_OVERFLOW');
      done();
    });
  });

  describe('fetch', function() {
    it('only fetches once when calling in quick succession', function(done) {
      var connection = this.connection;
      var doc = connection.get('dogs', 'fido');
      sinon.spy(connection, 'sendFetch');
      var count = 0;
      var finish = function() {
        count++;
        expect(connection.sendFetch).to.have.been.calledOnce;
        if (count === 3) done();
      };
      doc.fetch(finish);
      doc.fetch(finish);
      doc.fetch(finish);
    });
  });

  describe('when connection closed', function() {
    beforeEach(function(done) {
      this.op1 = [{p: ['snacks'], oi: true}];
      this.op2 = [{p: ['color'], oi: 'gray'}];
      this.doc = this.connection.get('dogs', 'fido');
      this.doc.create({}, function(err) {
        if (err) return done(err);
        done();
      });
    });

    it('do not mutate previously inflight op', function(done) {
      var doc = this.doc;
      var op1 = this.op1;
      var op2 = this.op2;
      var connection = this.connection;

      this.connection.on('send', function() {
        expect(doc.pendingOps).to.have.length(0);
        expect(doc.inflightOp.op).to.eql(op1);
        expect(doc.inflightOp.sentAt).to.not.be.undefined;
        connection.close();
        expect(doc.pendingOps).to.have.length(1);
        doc.submitOp(op2);
        expect(doc.pendingOps).to.have.length(2);
        expect(doc.pendingOps[0].op).to.eql(op1);
        expect(doc.pendingOps[1].op).to.eql(op2);
        done();
      });

      this.doc.submitOp(this.op1, function() {
        done(new Error('Connection should have been closed'));
      });
    });
  });

  describe('applyStack', function() {
    beforeEach(function(done) {
      this.doc = this.connection.get('dogs', 'fido');
      this.doc2 = this.backend.connect().get('dogs', 'fido');
      this.doc3 = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.doc2;
      this.doc.create({}, function(err) {
        if (err) return done(err);
        doc2.fetch(done);
      });
    });

    function verifyConsistency(doc, doc2, doc3, handlers, callback) {
      doc.whenNothingPending(function(err) {
        if (err) return callback(err);
        expect(handlers.length).equal(0);
        doc2.fetch(function(err) {
          if (err) return callback(err);
          doc3.fetch(function(err) {
            if (err) return callback(err);
            expect(doc.data).eql(doc2.data);
            expect(doc.data).eql(doc3.data);
            callback();
          });
        });
      });
    }

    it('single component ops emit an `op` event', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'white'}]);
          expect(doc.data).eql({color: 'white'});
          doc.submitOp({p: ['color'], oi: 'gray'});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'gray'}]);
          expect(doc.data).eql({color: 'gray'});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([]);
          expect(doc.data).eql({color: 'gray'});
          doc.submitOp({p: ['color'], oi: 'black'});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'black'}]);
          expect(doc.data).eql({color: 'black'});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      doc2.submitOp([{p: ['color'], oi: 'brown'}], function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['color'], oi: 'white'});
        expect(doc.data).eql({color: 'gray'});
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

    it('remote multi component ops emit individual `op` events', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'white'}]);
          expect(doc.data).eql({color: 'white'});
          doc.submitOp([{p: ['color'], oi: 'gray'}, {p: ['weight'], oi: 40}]);
          expect(doc.data).eql({color: 'gray', weight: 40});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'gray'}, {p: ['weight'], oi: 40}]);
          expect(doc.data).eql({color: 'gray', weight: 40});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['age'], oi: 2}]);
          expect(doc.data).eql({color: 'gray', weight: 40, age: 2});
          doc.submitOp([{p: ['color'], oi: 'black'}, {p: ['age'], na: 1}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'black'}, {p: ['age'], na: 1}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 3});
          doc.submitOp({p: ['age'], na: 2});
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['age'], na: 2}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['owner'], oi: 'sue'}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5, owner: 'sue'});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      doc2.submitOp([{p: ['age'], oi: 2}, {p: ['owner'], oi: 'sue'}], function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['color'], oi: 'white'});
        expect(doc.data).eql({color: 'gray', weight: 40});
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

    it('remote ops are transformed by ops submitted in `before op` event handlers', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      function beforeOpHandler(op, source) {
        if (source) {
          return;
        }
        doc.off('before op', beforeOpHandler);
        doc.submitOp({p: ['list', 0], li: 2}, {source: true});
      }
      function opHandler(op, source) {
        if (source) {
          return;
        }
        doc.off('op', opHandler);
        doc.submitOp({p: ['list', 0], li: 3}, {source: true});
      }
      doc2.submitOp({p: ['list'], oi: []}, function() {
        doc.fetch(function() {
          doc.on('before op', beforeOpHandler);
          doc.on('op', opHandler);
          doc2.submitOp([{p: ['list', 0], li: 1}, {p: ['list', 1], li: 42}], function() {
            doc.fetch();
            verifyConsistency(doc, doc2, doc3, [], done);
          });
        });
      });
    });

    it('remote multi component ops are transformed by ops submitted in `op` event handlers', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks'], oi: ['fetching']}]);
          expect(doc.data).eql({tricks: ['fetching']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 0], li: 'stand'}]);
          expect(doc.data).eql({tricks: ['stand', 'fetching']});
          doc.submitOp([{p: ['tricks', 0], ld: 'stand'}, {p: ['tricks', 0, 8], si: ' stick'}]);
          expect(doc.data).eql({tricks: ['fetching stick']});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['tricks', 0], ld: 'stand'}, {p: ['tricks', 0, 8], si: ' stick'}]);
          expect(doc.data).eql({tricks: ['fetching stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 0], li: 'shake'}]);
          expect(doc.data).eql({tricks: ['shake', 'fetching stick']});
          doc.submitOp([{p: ['tricks', 1, 0], sd: 'fetch'}, {p: ['tricks', 1, 0], si: 'tug'}]);
          expect(doc.data).eql({tricks: ['shake', 'tuging stick']});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['tricks', 1, 0], sd: 'fetch'}, {p: ['tricks', 1, 0], si: 'tug'}]);
          expect(doc.data).eql({tricks: ['shake', 'tuging stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 1, 3], sd: 'ing'}]);
          expect(doc.data).eql({tricks: ['shake', 'tug stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([]);
          expect(doc.data).eql({tricks: ['shake', 'tug stick']});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      var remoteOp = [
        {p: ['tricks'], oi: ['fetching']},
        {p: ['tricks', 0], li: 'stand'},
        {p: ['tricks', 1], li: 'shake'},
        {p: ['tricks', 2, 5], sd: 'ing'},
        {p: ['tricks', 0], lm: 2}
      ];
      doc2.submitOp(remoteOp, function(err) {
        if (err) return done(err);
        doc.fetch();
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

    it('emits batch op events for a multi-component local op', function(done) {
      var doc = this.doc;
      var beforeOpBatchCount = 0;

      var submittedOp = [
        {p: ['tricks'], oi: ['fetching']},
        {p: ['tricks', 0], li: 'stand'}
      ];

      doc.on('before op batch', function(op, source) {
        expect(op).to.eql(submittedOp);
        expect(source).to.be.true;
        beforeOpBatchCount++;
      });

      doc.on('op batch', function(op, source) {
        expect(op).to.eql(submittedOp);
        expect(source).to.be.true;
        expect(beforeOpBatchCount).to.equal(1);
        expect(doc.data).to.eql({tricks: ['stand', 'fetching']});
        done();
      });

      doc.submitOp(submittedOp, errorHandler(done));
    });

    it('emits batch op events for a multi-component remote op', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var beforeOpBatchCount = 0;

      var submittedOp = [
        {p: ['tricks'], oi: ['fetching']},
        {p: ['tricks', 0], li: 'stand'}
      ];

      doc.on('before op batch', function(op, source) {
        expect(op).to.eql(submittedOp);
        expect(source).to.be.false;
        beforeOpBatchCount++;
      });

      doc.on('op batch', function(op, source) {
        expect(op).to.eql(submittedOp);
        expect(source).to.be.false;
        expect(beforeOpBatchCount).to.equal(1);
        expect(doc.data).to.eql({tricks: ['stand', 'fetching']});
        done();
      });

      async.series([
        doc.subscribe.bind(doc),
        doc2.submitOp.bind(doc2, submittedOp)
      ], errorHandler(done));
    });
  });

  describe('submitting ops in callbacks', function() {
    beforeEach(function() {
      this.doc = this.connection.get('dogs', 'scooby');
    });

    it('succeeds with valid op', function(done) {
      var doc = this.doc;
      doc.create({name: 'Scooby Doo'}, function(error) {
        expect(error).to.not.exist;
        // Build valid op that deletes a substring at index 0 of name.
        var textOpComponents = [{p: 0, d: 'Scooby '}];
        var op = [{p: ['name'], t: 'text0', o: textOpComponents}];
        doc.submitOp(op, function(error) {
          if (error) return done(error);
          expect(doc.data).eql({name: 'Doo'});
          done();
        });
      });
    });

    it('fails with invalid op', function(done) {
      var doc = this.doc;
      doc.create({name: 'Scooby Doo'}, function(error) {
        expect(error).to.not.exist;
        // Build op that tries to delete an invalid substring at index 0 of name.
        var textOpComponents = [{p: 0, d: 'invalid'}];
        var op = [{p: ['name'], t: 'text0', o: textOpComponents}];
        doc.submitOp(op, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });
    });
  });

  describe('submitting an invalid op', function() {
    var doc;
    var invalidOp;
    var validOp;

    beforeEach(function(done) {
      // This op is invalid because we try to perform a list deletion
      // on something that isn't a list
      invalidOp = {p: ['name'], ld: 'Scooby'};

      validOp = {p: ['snacks'], oi: true};

      doc = this.connection.get('dogs', 'scooby');
      doc.create({name: 'Scooby'}, function(error) {
        if (error) return done(error);
        doc.whenNothingPending(done);
      });
    });

    it('returns an error to the submitOp callback', function(done) {
      doc.submitOp(invalidOp, function(error) {
        expect(error.message).to.equal('Referenced element not a list');
        done();
      });
    });

    it('rolls the doc back to a usable state', function(done) {
      async.series([
        function(next) {
          doc.submitOp(invalidOp, function(error) {
            expect(error).to.be.instanceOf(Error);
            next();
          });
        },
        doc.whenNothingPending.bind(doc),
        function(next) {
          expect(doc.data).to.eql({name: 'Scooby'});
          next();
        },
        doc.submitOp.bind(doc, validOp),
        function(next) {
          expect(doc.data).to.eql({name: 'Scooby', snacks: true});
          next();
        }
      ], done);
    });

    it('rolls the doc back even if the op is not invertible', function(done) {
      var backend = this.backend;

      async.series([
        function(next) {
          // Register the rich text type, which can't be inverted
          json0.registerSubtype(richText);

          var validOp = {p: ['richName'], oi: {ops: [{insert: 'Scooby\n'}]}};
          doc.submitOp(validOp, function(error) {
            expect(error).to.not.exist;
            next();
          });
        },
        function(next) {
          // Make the server reject this insertion
          backend.use('submit', function(_context, backendNext) {
            backendNext(new ShareDBError(ShareDBError.CODES.ERR_UNKNOWN_ERROR, 'Custom unknown error'));
          });
          var nonInvertibleOp = {p: ['richName'], t: 'rich-text', o: [{insert: 'e'}]};

          // The server error should get all the way back to our handler
          doc.submitOp(nonInvertibleOp, function(error) {
            expect(error.message).to.eql('Custom unknown error');
            next();
          });
        },
        doc.whenNothingPending.bind(doc),
        function(next) {
          // The doc should have been reverted successfully
          expect(doc.data).to.eql({name: 'Scooby', richName: {ops: [{insert: 'Scooby\n'}]}});
          next();
        }
      ], done);
    });

    it('throws an error when hard rollback fetch failed', function(done) {
      var backend = this.backend;
      doc = this.connection.get('dogs', 'scrappy');
      types.register(richText);

      async.series([
        doc.create.bind(doc, {ops: [{insert: 'Scrappy'}]}, 'rich-text'),
        function(next) {
          backend.use('reply', function(replyContext, cb) {
            if (replyContext.request.a !== 'f') return cb();
            cb({code: 'FETCH_ERROR'});
          });
          backend.use('submit', function(_context, cb) {
            cb(new ShareDBError('SUBMIT_ERROR'));
          });
          var nonInvertibleOp = [{insert: 'e'}];

          var count = 0;
          function expectError(code) {
            count++;
            return function(error) {
              expect(error.code).to.equal(code);
              count--;
              if (!count) next();
            };
          }

          doc.on('error', expectError('ERR_HARD_ROLLBACK_FETCH_FAILED'));
          doc.submitOp(nonInvertibleOp, expectError('SUBMIT_ERROR'));
        }
      ], done);
    });

    it('rescues an irreversible op collision', function(done) {
      // This test case attempts to reconstruct the following corner case, with
      // two independent references to the same document. We submit two simultaneous, but
      // incompatible operations (eg one of them changes the data structure the other op is
      // attempting to manipulate).
      //
      // The second document to attempt to submit should have its op rejected, and its
      // state successfully rolled back to a usable state.
      var doc1 = this.backend.connect().get('dogs', 'snoopy');
      var doc2 = this.backend.connect().get('dogs', 'snoopy');

      var pauseSubmit = false;
      var fireSubmit;
      this.backend.use('submit', function(request, callback) {
        if (pauseSubmit) {
          fireSubmit = function() {
            pauseSubmit = false;
            callback();
          };
        } else {
          fireSubmit = null;
          callback();
        }
      });

      async.series([
        doc1.create.bind(doc1, {colours: ['white']}),
        doc1.whenNothingPending.bind(doc1),
        doc2.fetch.bind(doc2),
        doc2.whenNothingPending.bind(doc2),
        // Both documents start off at the same v1 state, with colours as a list
        function(next) {
          expect(doc1.data).to.eql({colours: ['white']});
          expect(doc2.data).to.eql({colours: ['white']});
          next();
        },
        doc1.submitOp.bind(doc1, {p: ['colours'], oi: 'white,black'}),
        // This next step is a little fiddly. We abuse the middleware to pause the op submission and
        // ensure that we get this repeatable sequence of events:
        // 1. doc2 is still on v1, where 'colours' is a list (but it's a string in v2)
        // 2. doc2 submits an op that assumes 'colours' is still a list
        // 3. doc2 fetches v2 before the op submission completes - 'colours' is no longer a list locally
        // 4. doc2's op is rejected by the server, because 'colours' is not a list on the server
        // 5. doc2 attempts to roll back the inflight op by turning a list insertion into a list deletion
        // 6. doc2 applies this list deletion to a field that is no longer a list
        // 7. type.apply throws, because this is an invalid op
        function(next) {
          pauseSubmit = true;
          doc2.submitOp({p: ['colours', '0'], li: 'black'}, function(error) {
            expect(error.message).to.equal('Referenced element not a list');
            next();
          });

          doc2.fetch(function(error) {
            if (error) return next(error);
            fireSubmit();
          });
        },
        // Validate that - despite the error in doc2.submitOp - doc2 has been returned to a
        // workable state in v2
        function(next) {
          expect(doc1.data).to.eql({colours: 'white,black'});
          expect(doc2.data).to.eql(doc1.data);
          doc2.submitOp({p: ['colours'], oi: 'white,black,red'}, next);
        }
      ], done);
    });
  });

  describe('errors on ops that could cause prototype corruption', function() {
    function expectReceiveError(
      connection,
      collectionName,
      docId,
      expectedError,
      done
    ) {
      connection.on('receive', function(request) {
        var message = request.data;
        if (message.c === collectionName && message.d === docId) {
          if ('error' in message) {
            request.data = null; // Stop further processing of the message
            if (message.error.message === expectedError) {
              return done();
            } else {
              return done('Unexpected ShareDB error: ' + message.error.message);
            }
          } else {
            return done('Expected error on ' + collectionName + '.' + docId + ' but got no error');
          }
        }
      });
    }

    ['__proto__', 'constructor'].forEach(function(badProp) {
      it('Rejects ops with collection ' + badProp, function(done) {
        var collectionName = badProp;
        var docId = 'test-doc';
        expectReceiveError(this.connection, collectionName, docId, 'Invalid collection', done);
        this.connection.send({
          a: 'op',
          c: collectionName,
          d: docId,
          v: 0,
          seq: this.connection.seq++,
          x: {},
          create: {type: 'http://sharejs.org/types/JSONv0', data: {name: 'Test doc'}}
        });
      });

      it('Rejects ops with doc id ' + badProp, function(done) {
        var collectionName = 'test-collection';
        var docId = badProp;
        expectReceiveError(this.connection, collectionName, docId, 'Invalid id', done);
        this.connection.send({
          a: 'op',
          c: collectionName,
          d: docId,
          v: 0,
          seq: this.connection.seq++,
          x: {},
          create: {type: 'http://sharejs.org/types/JSONv0', data: {name: 'Some doc'}}
        });
      });

      it('Rejects ops with ' + badProp + ' as first path segment', function(done) {
        var connection = this.connection;
        var collectionName = 'test-collection';
        var docId = 'test-doc';
        connection.get(collectionName, docId).create({id: docId}, function(err) {
          if (err) {
            return done(err);
          }
          expectReceiveError(connection, collectionName, docId, 'Invalid path segment', done);
          connection.send({
            a: 'op',
            c: collectionName,
            d: docId,
            v: 1,
            seq: connection.seq++,
            x: {},
            op: [{p: [badProp, 'toString'], oi: 'oops'}]
          });
        });
      });

      it('Rejects ops with ' + badProp + ' as later path segment', function(done) {
        var connection = this.connection;
        var collectionName = 'test-collection';
        var docId = 'test-doc';
        connection.get(collectionName, docId).create({id: docId}, function(err) {
          if (err) {
            return done(err);
          }
          expectReceiveError(connection, collectionName, docId, 'Invalid path segment', done);
          connection.send({
            a: 'op',
            c: collectionName,
            d: docId,
            v: 1,
            seq: connection.seq++,
            x: {},
            op: [{p: ['foo', badProp], oi: 'oops'}]
          });
        });
      });
    });
  });

  describe('toSnapshot', function() {
    var doc;
    beforeEach(function(done) {
      doc = this.connection.get('dogs', 'scooby');
      doc.create({name: 'Scooby'}, done);
    });

    it('generates a snapshot', function() {
      expect(doc.toSnapshot()).to.eql({
        v: 1,
        data: {name: 'Scooby'},
        type: 'http://sharejs.org/types/JSONv0'
      });
    });

    it('clones snapshot data to guard against mutation', function() {
      var snapshot = doc.toSnapshot();
      doc.data.name = 'Shaggy';
      expect(snapshot).to.eql({
        v: 1,
        data: {name: 'Scooby'},
        type: 'http://sharejs.org/types/JSONv0'
      });
    });
  });
});
