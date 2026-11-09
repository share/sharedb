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

  it('stays subscribed when the last stream is destroyed just after a subscribe', function(done) {
    var pubsub = new PubSub();
    pubsub._subscribe = sinon.spy(function(channel, callback) {
      callback();
    });
    pubsub._unsubscribe = sinon.spy(function(channel, callback) {
      callback();
    });
    pubsub.subscribe('x', function(err, lastStream) {
      if (err) return done(err);
      pubsub.subscribe('x', function(err) {
        if (err) return done(err);
        expect(pubsub._unsubscribe).not.to.have.been.called;
        expect(pubsub._subscribe).to.have.been.calledOnce;
        expect(pubsub.subscribed.x).to.equal(true);
        expect(pubsub.streamsCount).to.equal(1);
        done();
      });
      lastStream.destroy();
    });
  });

  it('waits for an in-flight _unsubscribe before calling _subscribe', function(done) {
    var pubsub = new PubSub();
    var finishUnsubscribe;
    pubsub._subscribe = sinon.spy(function(channel, callback) {
      callback();
    });
    pubsub._unsubscribe = function(channel, callback) {
      finishUnsubscribe = callback;
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      stream.destroy();
      var resubscribed = 0;
      function onResubscribe(err) {
        if (err) return done(err);
        if (++resubscribed < 2) return;
        expect(pubsub._subscribe).to.have.been.calledTwice;
        expect(pubsub.streamsCount).to.equal(2);
        done();
      }
      pubsub.subscribe('x', onResubscribe);
      pubsub.subscribe('x', onResubscribe);
      expect(pubsub._subscribe).to.have.been.calledOnce;
      finishUnsubscribe();
    });
  });

  it('subscribes before throwing an unhandled in-flight _unsubscribe error', function(done) {
    var pubsub = new PubSub();
    var finishUnsubscribe;
    pubsub._subscribe = function(channel, callback) {
      callback();
    };
    pubsub._unsubscribe = function(channel, callback) {
      finishUnsubscribe = callback;
    };
    pubsub.subscribe('x', function(err, stream) {
      if (err) return done(err);
      stream.destroy();
      var resubscribed = false;
      pubsub.subscribe('x', function(err) {
        if (err) return done(err);
        resubscribed = true;
      });
      expect(function() {
        finishUnsubscribe(new Error('unsubscribe failed'));
      }).to.throw('unsubscribe failed');
      expect(resubscribed).to.equal(true);
      expect(pubsub.subscribed.x).to.equal(true);
      done();
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
