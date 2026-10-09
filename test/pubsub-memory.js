var MemoryPubSub = require('../lib/pubsub/memory');
var PubSub = require('../lib/pubsub');
var expect = require('chai').expect;
var sinon = require('sinon');

require('./pubsub')(function(callback) {
  callback(null, new MemoryPubSub());
});
require('./pubsub')(function(callback) {
  callback(null, new MemoryPubSub({prefix: 'foo'}));
});

describe('PubSub base class', function() {
  it('returns an error if _subscribe is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub.subscribe('x', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error if _subscribe is unimplemented and callback is not provided', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
    pubsub.subscribe('x');
  });

  it('returns the _subscribe error to every concurrent subscriber', function(done) {
    var pubsub = new PubSub();
    sinon.spy(pubsub, '_subscribe');
    var errors = 0;
    function onSubscribe(err) {
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      if (++errors < 2) return;
      expect(pubsub._subscribe).to.have.been.calledOnce;
      done();
    }
    pubsub.subscribe('x', onSubscribe);
    pubsub.subscribe('x', onSubscribe);
  });

  it('calls _subscribe again after a failed subscribe', function(done) {
    var pubsub = new PubSub();
    pubsub.subscribe('x', function(err) {
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      pubsub._subscribe = function(channel, callback) {
        callback();
      };
      pubsub.subscribe('x', function(err) {
        if (err) return done(err);
        expect(pubsub.streamsCount).to.equal(1);
        done();
      });
    });
  });

  it('can resubscribe from a callback that destroyed the last stream', function(done) {
    var pubsub = new PubSub();
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub._unsubscribe = function(channel, callback) {
      callback();
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      stream.destroy();
      pubsub.subscribe('x', done);
    });
  });

  it('emits an error if _unsubscribe is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      pubsub.on('error', function(err) {
        expect(err).instanceOf(Error);
        expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
        done();
      });
      stream.destroy();
    });
  });

  it('returns an error if _publish is unimplemented', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', done);
    pubsub.publish(['x', 'y'], {test: true}, function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error if _publish is unimplemented and callback is not provided', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
    pubsub.publish(['x', 'y'], {test: true});
  });

  it('can emit events', function(done) {
    var pubsub = new PubSub();
    pubsub.on('error', function(err) {
      expect(err).instanceOf(Error);
      expect(err.message).equal('test error');
      done();
    });
    pubsub.emit('error', new Error('test error'));
  });
});
