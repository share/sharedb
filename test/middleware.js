var async = require('async');
var Backend = require('../lib/backend');
var expect = require('expect.js');
var types = require('../lib/types');
var pry = require('pryjs');

describe('middleware', function() {

  beforeEach(function() {
    this.backend = new Backend();
  });

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

  describe('doc', function() {
    beforeEach('Add fido to db', function(done) {
      this.snapshot = {v: 1, type: 'json0', data: {age: 3}};
      this.backend.db.commit('dogs', 'fido', {v: 0, create: {}}, this.snapshot, null, done);
    });

    describe('with default options for backend constructor', function() {

      it('is triggered when a single document is fetched', function(done) {
        this.backend.use('doc', function(request, next) {
          expect(request.collection).to.eql('dogs');
          expect(request.id).to.eql('fido');
          next();
          return done()
        });

        this.backend.fetch({}, 'dogs', 'fido', function(err) {
          if (err) throw(err);
        });
      });

      it('calls back with an error that is yielded by fetch', function(done) {
        var expectedError = new Error('Bad dog!');
        this.backend.use('doc', function(_request, next) {
          return next(expectedError);
        });

        this.backend.fetch({}, 'dogs', 'fido', function(err) {
          expect(err).to.eql(expectedError);
          done();
        })
      });

      it('is triggered when a multiple documents are fetched by ids', function(done) {
        this.backend.use('doc', function(request, next) {
          expect(request.collection).to.eql('dogs');
          expect(request.id).to.eql('fido');
          next();
          return done()
        });

        this.backend.fetchBulk({}, 'dogs', ['fido'], function(err) {
          if (err) throw(err);
        });
      });

      it('calls back with an error that is yielded by fetchBulk', function(done) {
        var expectedError = new Error('Bad dogs!');
        this.backend.use('doc', function(_request, next) {
          return next(expectedError);
        });

        this.backend.fetchBulk({}, 'dogs', ['fido'], function(err) {
          expect(err).to.eql(expectedError);
          done();
        })
      });

      ['queryFetch', 'querySubscribe'].forEach((function(queryMethod) {
        it('is triggered when multiple documents are retrieved with ' + queryMethod, function(done) {
          this.backend.use('doc', function(request, next) {
            expect(request.collection).to.eql('dogs');
            expect(request.id).to.eql('fido');
            next();
            return done()
          });

          this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, function(err) {
            if (err) throw(err);
          })
        });

        it('calls back with an error that is yielded by ' + queryMethod, function(done) {
          var expectedError = new Error('Bad dog!');
          this.backend.use('doc', function(_request, next) {
            return next(expectedError);
          });

          this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, function(err) {
            expect(err).to.eql(expectedError);
            done();
          });
        });

      }).bind(this));

    });

    describe('with disableDocAction option set to true for backend constructor', function() {

      beforeEach('Create backend with disableDocAction option', function() {
        this.backend = new Backend({disableDocAction: true});
      });

      it('is not triggered when a document is fetched', function(done) {
        this.backend.use('doc', function(_request, _next) {
          throw(new Error('doc should not have been triggered'));
        });

        this.backend.fetch({}, 'dogs', 'fido', done);
      });

      it('is not triggered when multiple documents are fetched by id', function(done) {
        this.backend.use('doc', function(_request, _next) {
          throw(new Error('doc should not have been triggered'));
        });

        this.backend.fetchBulk({}, 'dogs', ['fido'], done);
      });

      ['queryFetch', 'querySubscribe'].forEach((function(queryMethod) {
        it('is not triggered when multiple documents are retrieved with ' + queryMethod, function(done) {
          this.backend.use('doc', function(request, next) {
            throw(new Error('doc should not have been triggered'));
          });

          this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, done);
        });

        it('calls back with an error that is yielded by ' + queryMethod, function(done) {
          var expectedError = new Error('Bad dog!');
          this.backend.use('doc', function(_request, next) {
            throw(new Error('doc should not have been triggered'));
          });

          this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, done);
        });

      }).bind(this));
    });

  });

  describe('readDoc', function() {
    beforeEach('Add fido to db', function(done) {
      this.snapshot = {v: 1, type: 'json0', data: {age: 3}};
      this.backend.db.commit('dogs', 'fido', {v: 0, create: {}}, this.snapshot, null, done);
    });

    it('is triggered when a single document is fetched', function(done) {
      this.backend.use('readDoc', function(request, next) {
        expect(request.collection).to.eql('dogs');
        expect(request.id).to.eql('fido');
        next();
        return done()
      });

      this.backend.fetch({}, 'dogs', 'fido', function(err) {
        if (err) throw(err);
      })
    });

    it('calls back with an error that is yielded by fetch', function(done) {
      var expectedError = new Error('Bad dog!');
      this.backend.use('readDoc', function(_request, next) {
        return next(expectedError);
      });

      this.backend.fetch({}, 'dogs', 'fido', function(err) {
        expect(err).to.eql(expectedError);
        done();
      })
    });
  });

  describe('readDocBulk', function() {

    it('is triggered when multiple documents are fetched by ids', function(done) {
      this.backend.use('readDocBulk', function(request, next) {
        expect(request.collection).to.eql('dogs');
        expect(request.snapshotMap).to.have.property('fido');
        expect(request.snapshotMap).to.have.property('spot');
        next();
        return done()
      });

      this.backend.fetchBulk({}, 'dogs', ['fido', 'spot'], function(err) {
        if (err) throw(err);
      });
    });

    it('calls back with an error that is yielded by fetchBulk', function(done) {
      var expectedError = new Error('Bad dogs!');
      this.backend.use('readDocBulk', function(_request, next) {
        return next(expectedError);
      });

      this.backend.fetchBulk({}, 'dogs', ['fido', 'spot'], function(err) {
        expect(err).to.eql(expectedError);
        done();
      })
    });

  });

  describe('readDocs', function() {
    beforeEach('Add fido to db', function(done) {
      this.snapshot = {v: 1, type: 'json0', data: {age: 3}};
      this.backend.db.commit('dogs', 'fido', {v: 0, create: {}}, this.snapshot, null, done);
    });

    ['queryFetch', 'querySubscribe'].forEach((function(queryMethod) {
      it('is triggered when multiple documents are retrieved with ' + queryMethod, function(done) {
        this.backend.use('readDocs', function(request, next) {
          expect(request.collection).to.eql('dogs');
          expect(request.snapshots).to.have.length(1);
          expect(request.snapshots[0]).to.have.property('id', 'fido');
          expect(request.snapshots[0]).to.have.property('data').eql({age: 3});
          next();
          return done();
        });

        this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, function(err) {
          if (err) throw(err);
        })
      });

      it('calls back with an error that is yielded by ' + queryMethod, function(done) {
        var expectedError = new Error('Bad dog!');
        this.backend.use('readDocs', function(_request, next) {
          return next(expectedError);
        });

        this.backend[queryMethod]({}, 'dogs', {age: 3}, {}, function(err) {
          expect(err).to.eql(expectedError);
          done();
        });
      });

    }).bind(this));

  });

  describe('submit', function() {

    it('gets options passed to backend.submit', function(done) {
      this.backend.use('submit', function(request, next) {
        expect(request.options).eql({testOption: true});
        next();
        return done();
      });
      var op = {create: {type: types.defaultType.uri}};
      var options = {testOption: true};
      this.backend.submit(null, 'dogs', 'fido', op, options, function(err) {
        if (err) throw err;
      });
    });

  });

});
