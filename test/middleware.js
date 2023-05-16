var Backend = require('../lib/backend');
var expect = require('chai').expect;
var util = require('./util');
var types = require('../lib/types');
var errorHandler = util.errorHandler;
var ShareDBError = require('../lib/error');
var sinon = require('sinon');
var ACTIONS = require('../lib/message-actions').ACTIONS;

var ERROR_CODE = ShareDBError.CODES;

describe('middleware', function() {
  beforeEach(function() {
    this.backend = new Backend();
  });

  var expectedError = new Error('Bad dog!');
  function passError(_request, next) {
    return next(expectedError);
  }
  function getErrorTest(done) {
    return function(err) {
      expect(err).to.eql(expectedError);
      done();
    };
  }

  describe('use', function() {
    it('returns itself to allow chaining', function() {
      var response = this.backend.use('submit', function() {});
      expect(response).equal(this.backend);
    });

    it('accepts an array of action names', function() {
      var response = this.backend.use(['submit', 'connect'], function() {});
      expect(response).equal(this.backend);
    });
  });

  describe('connect', function() {
    it('passes the agent on connect', function(done) {
      var clientId;
      this.backend.use('connect', function(request, next) {
        clientId = request.agent.clientId;
        next();
      });

      var connection = this.backend.connect();
      expect(connection.id).equal(null);
      connection.on('connected', function() {
        expect(connection.id).equal(clientId);
        done();
      });
    });

    it('passing an error on connect stops the client', function(done) {
      this.backend.use('connect', function(request, next) {
        next({message: 'No good'});
      });

      var connection = this.backend.connect();
      connection.on('stopped', function() {
        done();
      });
    });
  });

  describe('readSnapshots', function() {
    function expectFido(request) {
      expect(request.collection).to.equal('dogs');
      expect(request.snapshots[0]).to.have.property('id', 'fido');
      expect(request.snapshots[0]).to.have.property('data').eql({age: 3});
    }
    function expectSpot(request) {
      expect(request.collection).to.equal('dogs');
      expect(request.snapshots[1]).to.have.property('id', 'spot');
      expect(request.snapshots[1]).to.have.property('type').equal(null);
    }

    function expectFidoOnly(backend, done) {
      var doneAfter = util.callAfter(1, done);
      backend.use('readSnapshots', function(request, next) {
        expect(request.snapshots).to.have.length(1);
        expectFido(request);
        doneAfter();
        next();
      });
      return doneAfter;
    }

    function expectFidoAndSpot(backend, done) {
      var doneAfter = util.callAfter(1, done);
      backend.use('readSnapshots', function(request, next) {
        expect(request.snapshots).to.have.length(2);
        expectFido(request);
        expectSpot(request);
        doneAfter();
        next();
      });
      return doneAfter;
    }

    beforeEach('Add fido to db', function(done) {
      this.snapshot = {v: 1, type: 'json0', data: {age: 3}};
      this.backend.db.commit('dogs', 'fido', {v: 0, create: {}}, this.snapshot, null, done);
    });

    it('is triggered when a document is retrieved with fetch', function(done) {
      var doneAfter = expectFidoOnly(this.backend, done);
      this.backend.fetch({}, 'dogs', 'fido', doneAfter);
    });

    it('calls back with an error that is yielded by fetch', function(done) {
      this.backend.use('readSnapshots', passError);
      this.backend.fetch({}, 'dogs', 'fido', getErrorTest(done));
    });

    it('is triggered when a document is retrieved with subscribe', function(done) {
      var doneAfter = expectFidoOnly(this.backend, done);
      this.backend.subscribe({}, 'dogs', 'fido', null, doneAfter);
    });

    it('calls back with an error that is yielded by subscribe', function(done) {
      this.backend.use('readSnapshots', passError);
      this.backend.subscribe({}, 'dogs', 'fido', null, getErrorTest(done));
    });

    ['queryFetch', 'querySubscribe'].forEach(function(queryMethod) {
      it('is triggered when multiple documents are retrieved with ' + queryMethod, function(done) {
        var doneAfter = expectFidoOnly(this.backend, done);
        this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, doneAfter);
      });

      it('calls back with an error that is yielded by ' + queryMethod, function(done) {
        this.backend.use('readSnapshots', passError);
        this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, getErrorTest(done));
      });
    });

    ['fetchBulk', 'subscribeBulk'].forEach(function(bulkMethod) {
      it('is triggered when a document is retrieved with ' + bulkMethod, function(done) {
        var doneAfter = expectFidoAndSpot(this.backend, done);
        this.backend[bulkMethod]({}, 'dogs', ['fido', 'spot'], doneAfter);
      });

      it('calls back with an error that is yielded by ' + bulkMethod, function(done) {
        this.backend.use('readSnapshots', passError);
        this.backend[bulkMethod]({}, 'dogs', ['fido', 'spot'], getErrorTest(done));
      });
    });
  });

  describe('reply', function() {
    beforeEach(function(done) {
      this.snapshot = {v: 1, type: 'json0', data: {age: 3}};
      this.backend.db.commit('dogs', 'fido', {v: 0, create: {}}, this.snapshot, null, done);
    });

    it('context has request and reply objects', function(done) {
      var snapshot = this.snapshot;
      this.backend.use('reply', function(replyContext, next) {
        if (replyContext.request.a !== 'qf') return next();
        expect(replyContext).to.have.property('action', 'reply');
        expect(replyContext.request).to.eql({a: 'qf', id: 1, c: 'dogs', q: {age: 3}});
        expect(replyContext.reply).to.eql({
          data: [{v: 1, data: snapshot.data, d: 'fido'}],
          extra: undefined,
          a: 'qf',
          id: 1
        });
        expect(replyContext).to.have.property('agent');
        expect(replyContext).to.have.property('backend');
        next();
      });

      var connection = this.backend.connect();
      connection.createFetchQuery('dogs', {age: 3}, null, function(err, results) {
        if (err) {
          return done(err);
        }
        expect(results).to.have.length(1);
        expect(results[0].data).to.eql(snapshot.data);
        done();
      });
    });

    it('can produce errors that get sent back to client', function(done) {
      var errorMessage = 'This is an error from reply middleware';
      this.backend.use('reply', function(replyContext, next) {
        if (replyContext.request.a !== 'f') return next();
        next(errorMessage);
      });
      var connection = this.backend.connect();
      var doc = connection.get('dogs', 'fido');
      doc.fetch(function(err) {
        expect(err).to.have.property('message', errorMessage);
        done();
      });
    });

    it('can make raw additions to query reply extra', function(done) {
      var snapshot = this.snapshot;
      this.backend.use('reply', function(replyContext, next) {
        expect(replyContext.request.a === 'qf');
        replyContext.reply.extra = replyContext.reply.extra || {};
        replyContext.reply.extra.replyMiddlewareValue = 'some value';
        next();
      });

      var connection = this.backend.connect();
      connection.createFetchQuery('dogs', {age: 3}, null, function(err, results, extra) {
        if (err) {
          return done(err);
        }
        expect(results).to.have.length(1);
        expect(results[0].data).to.eql(snapshot.data);
        expect(extra).to.eql({replyMiddlewareValue: 'some value'});
        done();
      });
    });
  });

  describe('submit lifecycle', function() {
    ['submit', 'apply', 'commit', 'afterWrite'].forEach(function(action) {
      it(action + ' gets options passed to backend.submit', function(done) {
        var doneAfter = util.callAfter(1, done);
        this.backend.use(action, function(request, next) {
          expect(request.options).eql({testOption: true});
          doneAfter();
          next();
        });
        var op = {create: {type: types.defaultType.uri}};
        var options = {testOption: true};
        var connection = this.backend.connect();
        var agent = connection.agent;
        this.backend.submit(agent, 'dogs', 'fido', op, options, doneAfter);
      });
    });
  });

  describe('access control', function() {
    function setupOpMiddleware(backend) {
      backend.use('apply', function(request, next) {
        request.priorAccountId = request.snapshot.data && request.snapshot.data.accountId;
        next();
      });
      backend.use('commit', function(request, next) {
        var accountId = (request.snapshot.data) ?
          // For created documents, get the accountId from the document data
          request.snapshot.data.accountId :
          // For deleted documents, get the accountId from before
          request.priorAccountId;
        // Store the accountId for the document on the op for efficient access control
        request.op.accountId = accountId;
        next();
      });
      backend.use('op', function(request, next) {
        if (request.op.accountId === request.agent.accountId) {
          return next();
        }
        var err = {message: 'op accountId does not match', code: 'ERR_OP_READ_FORBIDDEN'};
        return next(err);
      });
    }

    it('is possible to cache add additional top-level fields on ops for access control', function(done) {
      setupOpMiddleware(this.backend);
      var connection1 = this.backend.connect();
      var connection2 = this.backend.connect();
      connection2.agent.accountId = 'foo';

      // Fetching the snapshot here will cause subsequent fetches to get ops
      connection2.get('dogs', 'fido').fetch(function(err) {
        if (err) return done(err);
        var data = {accountId: 'foo', age: 2};
        connection1.get('dogs', 'fido').create(data, function(err) {
          if (err) return done(err);
          // This will go through the 'op' middleware and should pass
          connection2.get('dogs', 'fido').fetch(done);
        });
      });
    });

    it('op middleware can reject ops', function(done) {
      setupOpMiddleware(this.backend);
      var connection1 = this.backend.connect();
      var connection2 = this.backend.connect();
      connection2.agent.accountId = 'baz';

      // Fetching the snapshot here will cause subsequent fetches to get ops
      connection2.get('dogs', 'fido').fetch(function(err) {
        if (err) return done(err);
        var data = {accountId: 'foo', age: 2};
        connection1.get('dogs', 'fido').create(data, function(err) {
          if (err) return done(err);
          // This will go through the 'op' middleware and fail;
          connection2.get('dogs', 'fido').fetch(function(err) {
            expect(err.code).equal('ERR_OP_READ_FORBIDDEN');
            done();
          });
        });
      });
    });

    it('pubsub subscribe can check top-level fields for access control', function(done) {
      setupOpMiddleware(this.backend);
      var connection1 = this.backend.connect();
      var connection2 = this.backend.connect();
      connection2.agent.accountId = 'foo';

      // Fetching the snapshot here will cause subsequent fetches to get ops
      connection2.get('dogs', 'fido').subscribe(function(err) {
        if (err) return done(err);
        var data = {accountId: 'foo', age: 2};
        connection1.get('dogs', 'fido').create(data, function(err) {
          if (err) return done(err);
          // The subscribed op will go through the 'op' middleware and should pass
          connection2.get('dogs', 'fido').on('create', function() {
            done();
          });
        });
      });
    });
  });

  describe('extra information (x)', function() {
    var connection;
    var db;
    var doc;

    beforeEach(function(done) {
      connection = this.backend.connect();
      db = this.backend.db;
      doc = connection.get('dogs', 'fido');

      doc.create({name: 'fido'}, done);
      // Need to actively enable this feature
      doc.submitSource = true;
    });

    it('has the source in commit middleware', function(done) {
      this.backend.use('commit', function(request) {
        expect(request.extra).to.eql({source: 'trainer'});
        done();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], {source: 'trainer'}, errorHandler(done));
    });

    it('has the source in afterWrite middleware', function(done) {
      this.backend.use('afterWrite', function(request) {
        expect(request.extra).to.eql({source: 'trainer'});
        done();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], {source: 'trainer'}, errorHandler(done));
    });

    it('does not commit extra information to the database', function(done) {
      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], {source: 'trainer'}, function(error) {
        if (error) return done(error);
        var ops = db.ops.dogs.fido;
        ops.forEach(function(op) {
          expect('x' in op).to.be.false;
        });
        done();
      });
    });

    it('does not submit the source if it is disabled', function(done) {
      doc.submitSource = false;

      this.backend.use('commit', function(request) {
        expect('source' in request.extra).to.be.false;
        done();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], {source: 'trainer'}, errorHandler(done));
    });

    it('composes ops with the same source', function(done) {
      doc.submitSource = true;

      this.backend.use('commit', function(request) {
        expect(request.op.op).to.have.length(3);
        expect(request.extra).to.eql({source: {type: 'trainer'}});
        done();
      });

      var source = {type: 'trainer'};
      doc.submitOp([{p: ['tricks'], oi: []}], {source: source}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 0], li: 'fetch'}], {source: source}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 1], li: 'stay'}], {source: source}, errorHandler(done));
    });

    it('does not compose ops with the different sources', function(done) {
      doc.submitSource = true;

      this.backend.use('commit', function(request) {
        expect(request.op.op).to.have.length(2);
        expect(request.extra).to.eql({source: {type: 'trainer'}});
        done();
      });

      var source1 = {type: 'trainer'};
      var source2 = {type: 'owner'};
      doc.submitOp([{p: ['tricks'], oi: []}], {source: source1}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 0], li: 'fetch'}], {source: source1}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 1], li: 'stay'}], {source: source2}, errorHandler(done));
    });

    it('composes ops with different sources when disabled', function(done) {
      doc.submitSource = false;

      this.backend.use('commit', function(request) {
        expect(request.op.op).to.have.length(3);
        done();
      });

      doc.submitOp([{p: ['tricks'], oi: []}], {source: 'a'}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 0], li: 'fetch'}], {source: 'b'}, errorHandler(done));
      doc.submitOp([{p: ['tricks', 1], li: 'stay'}], {source: 'c'}, errorHandler(done));
    });
  });

  describe('$fixup', function() {
    var connection;
    var backend;
    var doc;

    beforeEach(function(done) {
      backend = this.backend;
      connection = backend.connect();
      doc = connection.get('dogs', 'fido');

      doc.create({name: 'fido'}, done);
    });

    it('applies a fixup op to the client that submitted it', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 1], li: 'stay'}]);
        next();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], function(error) {
        if (error) return done(error);
        expect(doc.data.tricks).to.eql(['fetch', 'stay']);
        expect(doc.version).to.equal(2);
        done();
      });
    });

    it('emits an op event for the fixup', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 1], li: 'stay'}]);
        next();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], errorHandler(done));

      doc.on('op', function() {
        expect(doc.data.tricks).to.eql(['fetch', 'stay']);
        done();
      });
    });

    it('passes the fixed up op to future middleware', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 1], li: 'stay'}]);
        next();
      });

      backend.use('apply', function(request, next) {
        expect(request.op.op).to.eql([
          {p: ['tricks'], oi: ['fetch']},
          {p: ['tricks', 1], li: 'stay'}
        ]);
        next();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], done);
    });

    it('applies the composed op to a remote client', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 1], li: 'stay'}]);
        next();
      });

      var remoteConnection = backend.connect();
      var remoteDoc = remoteConnection.get('dogs', 'fido');

      remoteDoc.subscribe(function(error) {
        if (error) return done(error);

        expect(remoteDoc.data).to.eql({name: 'fido'});

        remoteDoc.on('op batch', function() {
          expect(remoteDoc.data.tricks).to.eql(['fetch', 'stay']);
          expect(doc.version).to.equal(remoteDoc.version);
          done();
        });

        doc.submitOp([{p: ['tricks'], oi: ['fetch']}], errorHandler(done));
      });
    });

    it('transforms pending ops by the fixup for remote clients', function(done) {
      var applied = false;
      backend.use('apply', function(request, next) {
        if (applied) return next();
        applied = true;
        request.$fixup([{p: ['tricks', 0], li: 'stay'}]);
        next();
      });

      var remoteConnection = backend.connect();
      var remoteDoc = remoteConnection.get('dogs', 'fido');

      remoteDoc.subscribe(function(error) {
        if (error) return done(error);

        expect(remoteDoc.data).to.eql({name: 'fido'});

        remoteDoc.on('op batch', function() {
          if (remoteDoc.version !== 3) return;
          expect(remoteDoc.data.tricks).to.eql(['stay', 'fetch', 'sit']);
          expect(remoteDoc.data).to.eql(doc.data);
          done();
        });

        doc.preventCompose = true;
        doc.submitOp([{p: ['tricks'], oi: ['fetch']}], errorHandler(done));
        doc.submitOp([{p: ['tricks', 1], li: 'sit'}], errorHandler(done));
      });
    });

    it('transforms pending ops by the fixup for the local doc', function(done) {
      var applied = false;
      backend.use('apply', function(request, next) {
        if (applied) return next();
        applied = true;
        request.$fixup([{p: ['tricks', 0, 0], si: 'go '}]);
        next();
      });

      var remoteConnection = backend.connect();
      var remoteDoc = remoteConnection.get('dogs', 'fido');

      remoteDoc.subscribe(function(error) {
        if (error) return done(error);

        expect(remoteDoc.data).to.eql({name: 'fido'});

        remoteDoc.on('op batch', function() {
          if (remoteDoc.version !== 3) return;
          expect(remoteDoc.data.tricks).to.eql(['stay', 'go fetch']);
          expect(remoteDoc.data).to.eql(doc.data);
          done();
        });

        doc.preventCompose = true;
        doc.submitOp([{p: ['tricks'], oi: ['fetch', 'stay']}], errorHandler(done));
        doc.submitOp([{p: ['tricks', 0], lm: 1}], errorHandler(done));
      });
    });

    it('applies a fixup to a creation op', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['goodBoy'], oi: true}]);
        next();
      });

      doc = connection.get('dogs', 'rover');
      doc.create({name: 'rover'}, function(error) {
        if (error) return done(error);
        expect(doc.data.goodBoy).to.be.true;
        done();
      });
    });

    it('throws an error if trying to fixup a deletion', function(done) {
      backend.use('apply', function(request, next) {
        var error;
        try {
          request.$fixup([{p: ['tricks', 0], oi: ['stay']}]);
        } catch (e) {
          error = e;
        }
        next(error);
      });

      doc.del(function(error) {
        expect(error.code).to.equal(ERROR_CODE.ERR_CANNOT_FIXUP_DELETION);
        done();
      });
    });

    it('throws an error if trying to fixup in commit middleware', function(done) {
      backend.use('commit', function(request, next) {
        var error;
        try {
          request.$fixup([{p: ['tricks', 0], oi: ['stay']}]);
        } catch (e) {
          error = e;
        }
        next(error);
      });

      doc.submitOp([{p: ['goodBoy'], oi: true}], function(error) {
        expect(error.code).to.equal(ERROR_CODE.ERR_FIXUP_IS_ONLY_VALID_ON_APPLY);
        done();
      });
    });

    it('retry fixup', function(done) {
      var flush;
      backend.use('apply', function(request, next) {
        expect(request.op.m.fixup).to.be.undefined;
        if (flush) return next();
        flush = function() {
          request.$fixup([{p: ['name', 0], si: 'fixup'}]);
          next();
        };
      });

      doc.subscribe(function(error) {
        if (error) return done(error);

        var remoteConnection = backend.connect();
        var remoteDoc = remoteConnection.get('dogs', 'fido');

        doc.submitOp([{p: ['name', 0], si: 'foo'}], function(error) {
          if (error) return done(error);
          expect(doc.data).to.eql({});
          done();
        });

        remoteDoc.subscribe(function(error) {
          if (error) return done(error);
          remoteDoc.submitOp([{p: ['name'], od: 'fido'}], errorHandler(done));
        });

        doc.once('op', function(op, source) {
          if (source) return;
          expect(doc.data).to.eql({});
          flush();
        });
      });
    });

    it('fixup that ignores no-op', function(done) {
      var flush;
      backend.use('apply', function(request, next) {
        if (request.op.src !== connection.id) return next();
        if (flush) {
          request.$fixup([{p: ['name'], oi: 'fixup'}]);
          return next();
        }
        flush = function() {
          request.$fixup([{p: ['name', 0], si: 'fixup'}]);
          next();
        };
      });

      doc.subscribe(function(error) {
        if (error) return done(error);

        var remoteConnection = backend.connect();
        var remoteDoc = remoteConnection.get('dogs', 'fido');

        var count = 0;
        var callback = function() {
          count++;
          if (count !== 2) return;
          expect(doc.data).to.eql({name: 'fixup'});
          expect(remoteDoc.data).to.eql(doc.data);
          expect(doc.version).to.equal(remoteDoc.version);
          done();
        };

        doc.submitOp([{p: ['name', 0], si: 'foo'}], function(error) {
          if (error) return done(error);
          callback();
        });

        remoteDoc.on('op', function(op, source) {
          if (source) return;
          callback();
        });

        remoteDoc.subscribe(function(error) {
          if (error) return done(error);
          remoteDoc.submitOp([{p: ['name'], od: 'fido'}], errorHandler(done));
        });

        doc.once('op', function(op, source) {
          if (source) return;
          expect(doc.data).to.eql({});
          flush();
        });
      });
    });

    it('applies two fixups', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 0], li: 'sit'}]);
        next();
      });

      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['tricks', 0], li: 'stay'}]);
        next();
      });

      doc.submitOp([{p: ['tricks'], oi: ['fetch']}], function(error) {
        if (error) return done(error);
        expect(doc.data.tricks).to.eql(['stay', 'sit', 'fetch']);
        done();
      });
    });

    it('rolls the doc back if the fixup cannot be applied', function(done) {
      backend.use('apply', function(request, next) {
        request.$fixup([{p: ['stay'], oi: true}]);
        next();
      });

      backend.use('reply', function(request, next) {
        if (request.reply[ACTIONS.fixup]) {
          // Deliberately overwrite our fixup op to trigger a client rollback
          request.reply[ACTIONS.fixup][0].op = [{p: ['fetch'], ld: 'bad'}];
        }
        next();
      });

      sinon.spy(doc, '_fetch');

      doc.submitOp([{p: ['fetch'], oi: true}], function(error) {
        expect(error).to.be.ok;
        expect(doc._fetch.calledOnce).to.be.true;
        done();
      });
    });

    describe('no compose', function() {
      var originalCompose;

      beforeEach(function() {
        originalCompose = types.defaultType.compose;
        delete types.defaultType.compose;
      });

      afterEach(function() {
        types.defaultType.compose = originalCompose.bind(types.defaultType);
      });

      it('throws an error if trying to compose on a type that does not support it', function(done) {
        backend.use('apply', function(request, next) {
          var error;
          try {
            request.$fixup([{p: ['tricks', 0], oi: ['stay']}]);
          } catch (e) {
            error = e;
          }
          next(error);
        });

        doc.submitOp([{p: ['goodBoy'], oi: true}], function(error) {
          expect(error.code).to.equal(ERROR_CODE.ERR_TYPE_DOES_NOT_SUPPORT_COMPOSE);
          done();
        });
      });
    });
  });
});
