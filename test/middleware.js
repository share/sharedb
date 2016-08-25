var Backend = require('../lib/backend');
var expect = require('expect.js');
var types = require('../lib/types');

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

  describe('submit', function() {

    it('gets options passed to backend.submit', function(done) {
      this.backend.use('submit', function(request, next) {
        expect(request.options).eql({testOption: true});
        done();
      });
      var op = {create: {type: types.defaultType.uri}};
      var options = {testOption: true};
      this.backend.submit(null, 'dogs', 'fido', op, options, function(err) {
        if (err) throw err;
      });
    });

  });

});
