var expect = require('expect.js');
var Backend = require('../../lib/backend');

describe('client connection', function() {

  beforeEach(function() {
    this.backend = new Backend();
  });

  it('ends the agent stream when a connection is closed after connect', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.stream.on('end', function() {
        done();
      });
      next();
    });
    var connection = this.backend.connect();
    connection.on('connected', function() {
      connection.close();
    });
  });

  it('ends the agent stream when a connection is immediately closed', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.stream.on('end', function() {
        done();
      });
      next();
    });
    var connection = this.backend.connect();
    connection.close();
  });

  it('emits closed event on call to connection.close()', function(done) {
    var connection = this.backend.connect();
    connection.on('closed', function() {
      done();
    });
    connection.close();
  });

  it('ends the agent steam on call to agent.close()', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.stream.on('end', function() {
        done();
      });
      request.agent.close();
      next();
    });
    var connection = this.backend.connect();
  })

  it('emits stopped event on call to agent.close()', function(done) {
    this.backend.use('connect', function(request, next) {
      request.agent.close();
      next();
    });
    var connection = this.backend.connect();
    connection.on('stopped', function() {
      done();
    });
  });

  it('emits socket errors as "connection error" events', function(done) {
    var connection = this.backend.connect();
    connection.on('connection error', function(err) {
      expect(err.message).equal('Test');
      done();
    });
    connection.socket.onerror({message: 'Test'});
  });

});
