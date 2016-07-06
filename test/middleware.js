var Backend = require('../lib/backend');
var expect = require('expect.js');

describe('middleware', function() {

  beforeEach(function() {
    this.backend = new Backend();
  });

  describe('connect', function() {

    it('passes the agent on connect', function() {
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

  describe('doc options', function() {
    it('on create', function(done) {
      this.backend.use('submit', function(req) {
        expect(req.op.options).eql({hairy: true});
        done();
      });

      var connection = this.backend.connect();
      connection.get('dogs', 'fido').create({}, Backend.types.defaultType.uri, {hairy: true});
    });

    it('on op', function(done) {
      var backend = this.backend;
      var connection = this.backend.connect();
      var doc = connection.get('dogs', 'fido');
      doc.create({}, function(err) {
        if (err) return done(err);

        backend.use('submit', function(req) {
          expect(req.op.options).eql({hairy: true});
          done();
        });
        doc.submitOp({p: ['age'], oi: 1}, {hairy: true});
      });
    });

    it('on del', function(done) {
      var backend = this.backend;
      var connection = this.backend.connect();
      var doc = connection.get('dogs', 'fido');
      doc.create({}, function(err) {
        if (err) return done(err);

        backend.use('submit', function(req) {
          expect(req.op.options).eql({hairy: true});
          done();
        });
        doc.del({hairy: true});
      });
    });
  });

});
