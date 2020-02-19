var Backend = require('../lib/backend');
var expect = require('chai').expect;
var util = require('./util');
var types = require('../lib/types');

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
});
