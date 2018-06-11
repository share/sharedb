var async = require('async');
var Backend = require('../lib/backend');
var expect = require('expect.js');
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
      var response = this.backend.use('submit', function(request, next) {});
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

  function testReadDoc(expectFidoOnly, expectFidoAndSpot) {
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
  }

  describe('doc', function() {
    describe('with default options for backend constructor', function() {
      function expectFido(request) {
        expect(request.collection).to.equal('dogs');
        expect(request.id).to.equal('fido');
        expect(request.snapshot).to.have.property('data').eql({age: 3});
      }
      function expectSpot(request) {
        expect(request.collection).to.equal('dogs');
        expect(request.id).to.equal('spot');
        expect(request.snapshot).to.have.property('type').equal(null);
      }

      function expectFidoOnly(backend, done) {
        var doneAfter = util.callAfter(1, done);
        backend.use('doc', function(request, next) {
          expectFido(request);
          doneAfter();
          next();
        });
        return doneAfter;
      }

      function expectFidoAndSpot(backend, done) {
        var doneAfter = util.callAfter(2, done);
        var i = 0;
        backend.use('doc', function(request, next) {
          doneAfter();
          if (doneAfter.called === 1) {
            expectFido(request);
          } else {
            expectSpot(request);
          }
          next();
        });
        return doneAfter;
      }

      testReadDoc(expectFidoOnly, expectFidoAndSpot);
    });

    describe('with disableDocAction option set to true for backend constructor', function() {
      beforeEach('Create backend with disableDocAction option', function() {
        this.backend = new Backend({disableDocAction: true});
      });

      it('is not triggered when a document is retrieved with fetch', function(done) {
        this.backend.use('doc', passError);
        this.backend.fetch({}, 'dogs', 'fido', done);
      });

      it('is not triggered when a document is retrieved with subscribe', function(done) {
        this.backend.use('doc', passError);
        this.backend.subscribe({}, 'dogs', 'fido', null, done);
      });

      ['queryFetch', 'querySubscribe'].forEach(function(queryMethod) {
        it('is not triggered when multiple documents are retrieved with ' + queryMethod, function(done) {
          this.backend.use('doc', passError);
          this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, done);
        });
      });

      ['fetchBulk', 'subscribeBulk'].forEach(function(bulkMethod) {
        it('is not triggered when a document is retrieved with ' + bulkMethod, function(done) {
          this.backend.use('doc', passError);
          this.backend[bulkMethod]({}, 'dogs', ['fido', 'spot'], done);
        });
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

    testReadDoc(expectFidoOnly, expectFidoAndSpot);
  });

  describe('submit lifecycle', function() {
    // DEPRECATED: 'after submit' is a synonym for 'afterSubmit'
    ['submit', 'apply', 'commit', 'afterSubmit', 'after submit'].forEach(function(action) {
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

});
