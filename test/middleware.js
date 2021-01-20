var Backend = require('../lib/backend');
var expect = require('chai').expect;
var util = require('./util');
var types = require('../lib/types');
var errorHandler = util.errorHandler;

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
        this.backend.submit(null, 'dogs', 'fido', op, options, doneAfter);
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
});
