var expect = require('expect.js');
var Backend = require('../../lib/backend');

describe('client connection', function() {

  beforeEach(function() {
    this.backend = new Backend();
  });

  it('ends the agent stream when a connection is closed after connect', function(done) {
    var connection = this.backend.connect();
    connection.agent.stream.on('end', function() {
      done();
    });
    connection.on('connected', function() {
      connection.close();
    });
  });

  it('ends the agent stream when a connection is immediately closed', function(done) {
    var connection = this.backend.connect();
    connection.agent.stream.on('end', function() {
      done();
    });
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

  describe('backend.agentsCount', function() {
    it('updates after connect and connection.close()', function(done) {
      var backend = this.backend;
      expect(backend.agentsCount).equal(0);
      var connection = backend.connect();
      expect(backend.agentsCount).equal(1);
      connection.on('connected', function() {
        connection.close();
        setTimeout(function() {
          expect(backend.agentsCount).equal(0);
          done();
        }, 10);
      });
    });

    it('does not increment when agent connect is rejected', function() {
      var backend = this.backend;
      backend.use('connect', function(request, next) {
        next({message: 'Error'});
      });
      expect(backend.agentsCount).equal(0);
      var connection = backend.connect();
      expect(backend.agentsCount).equal(0);
    });
  });

});
