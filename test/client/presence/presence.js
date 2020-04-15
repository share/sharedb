var Backend = require('../../../lib/backend');
var PresencePauser = require('./presence-pauser');
var expect = require('chai').expect;
var async = require('async');
var errorHandler = require('../../util').errorHandler;
var sinon = require('sinon');

describe('Presence', function() {
  var backend;
  var connection1;
  var connection2;
  var presence1;
  var presence2;
  var presencePauser;

  beforeEach(function(done) {
    backend = new Backend({presence: true});
    var connectedCount = 0;
    connection1 = backend.connect();
    connection2 = backend.connect();

    var checkConnections = function() {
      connectedCount++;
      if (connectedCount === 2) done();
    };

    connection1.on('connected', checkConnections);
    connection2.on('connected', checkConnections);

    presencePauser = new PresencePauser();

    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(request, callback) {
      presencePauser.sendPresence(request, callback);
    });

    presence1 = connection1.getPresence('test-channel');
    presence2 = connection2.getPresence('test-channel');
  });

  afterEach(function(done) {
    sinon.restore();
    connection1.close();
    connection2.close();
    backend.close(done);
  });

  it('can subscribe to updates from other clients', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 5}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 5});
          next();
        });
      }
    ], done);
  });

  it('can unsubscribe from updates to other clients', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      presence2.unsubscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 5}, errorHandler(done));
        presence2.once('receive', function() {
          done(new Error('Should not have received presence update'));
        });
        next();
      }
    ], done);
  });

  it('resubscribes after a destroy', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var presence2a;

    async.series([
      presence2.subscribe.bind(presence2),
      presence2.destroy.bind(presence2),
      function(next) {
        presence2a = connection2.getPresence('test-channel');
        presence2a.subscribe(function(error) {
          next(error);
        });
      },
      function(next) {
        localPresence1.submit({index: 5}, errorHandler(done));
        presence2a.once('receive', function() {
          next();
        });
      }
    ], done);
  });

  it('requests existing presence from other subscribed clients when subscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, {index: 2}),
      function(next) {
        presence2.subscribe(errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 2});
          next();
        });
      }
    ], done);
  });

  it('removes remote presence when it is set to null', function(done) {
    var localPresence1 = presence1.create('presence-1');
    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 3}, errorHandler(done));
        presence2.once('receive', function() {
          expect(presence2.remotePresences).to.eql({
            'presence-1': {index: 3}
          });
          next();
        });
      },
      function(next) {
        localPresence1.submit(null, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.be.null;
          expect(presence2.remotePresences).to.eql({});
          next();
        });
      }
    ], done);
  });

  it('does not broadcast null local presence when requested', function(done) {
    var localPresence1 = presence1.create('presence-1');
    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, null),
      function(next) {
        presence2.subscribe(errorHandler(done));
        presence2.once('receive', function() {
          done(new Error('should not have received presence'));
        });
        next();
      }
    ], done);
  });

  it('destroys its connection reference, unsubscribes and nulls its local presences', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        localPresence2.submit({index: 2}, errorHandler(done));
        presence1.once('receive', function() {
          next();
        });
      },
      presence1.destroy.bind(presence1),
      function(next) {
        expect(presence1.localPresences).to.eql({});
        expect(presence2.remotePresences).to.eql({});
        expect(connection1._presences).to.eql({});
        next();
      }
    ], done);
  });

  it('supports multiple local presences on a single connection', function(done) {
    var localPresence1a = presence1.create('presence-1a');
    var localPresence1b = presence1.create('presence-1b');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1a.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1a');
          expect(presence).to.eql({index: 1});
          next();
        });
      },
      function(next) {
        localPresence1b.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1b');
          expect(presence).to.eql({index: 2});
          expect(Object.keys(presence1.localPresences)).to.eql(['presence-1a', 'presence-1b']);
          expect(presence2.remotePresences).to.eql({
            'presence-1a': {index: 1},
            'presence-1b': {index: 2}
          });
          next();
        });
      }
    ], done);
  });

  it('subscribes once the connection can send', function(done) {
    var localPresence1 = presence1.create('presence-1');

    connection2._setState('disconnected');
    expect(connection2.canSend).to.be.false;
    async.series([
      function(next) {
        presence2.subscribe(next);
        connection2._setState('connecting');
        connection2._setState('connected');
      },
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      }
    ], done);
  });

  it('sends local presence once the connection can send', function(done) {
    var localPresence1 = presence1.create('presence-1');

    connection1._setState('disconnected');
    expect(connection1.canSend).to.be.false;
    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
        connection1._setState('connecting');
        connection1._setState('connected');
      }
    ], done);
  });

  it('re-requests remote presence when reconnecting', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        connection2._setState('disconnected');
        expect(connection2.canSend).to.be.false;
        next();
      },
      localPresence1.submit.bind(localPresence1, {index: 1}),
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 1});
          next();
        });
        connection2._setState('connecting');
        connection2._setState('connected');
      }
    ], done);
  });

  it('calls multiple callbacks if subscribing multiple times in series', function(done) {
    var callbacksCalled = 0;

    var callback = function(error) {
      if (error) return done(error);
      callbacksCalled++;
      if (callbacksCalled === 3) done();
    };

    presence1.subscribe(callback);
    presence1.subscribe(callback);
    presence1.subscribe(callback);
  });

  it('finishes unsubscribed if calling immediately after subscribe', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      function(next) {
        var callbackCount = 0;
        var callback = function(error) {
          if (error) return done(error);
          callbackCount++;
          if (callbackCount === 2) next();
        };

        presence2.subscribe(callback);
        presence2.unsubscribe(callback);
      },
      function(next) {
        expect(presence2.wantSubscribe).to.be.false;
        expect(presence2.subscribed).to.be.false;
        localPresence1.submit({index: 1}, next);
        presence2.on('receive', function() {
          done(new Error('Should not have received presence'));
        });
      }
    ], done);
  });

  it('throws an error when trying to create a presence with a non-string ID', function() {
    expect(function() {
      presence1.create(123);
    }).to.throw();
  });

  it('assigns an ID if one is not provided', function() {
    var localPresence = presence1.create();
    expect(localPresence.presenceId).to.be.ok;
  });

  it('returns the error if a local presence cannot be destroyed because of a bad submit', function(done) {
    var localPresence1 = presence1.create('presence-1');
    sinon.stub(localPresence1, 'submit').callsFake(function(value, callback) {
      callback(new Error('bad'));
    });

    localPresence1.destroy(function(error) {
      expect(error).to.be.ok;
      done();
    });
  });

  it('throws an error if a presence is created with a non-string channel', function() {
    expect(function() {
      connection1.getPresence(123);
    }).to.throw();
  });

  it('throws an error if a presence is created with an empty string channel', function() {
    expect(function() {
      connection1.getPresence('');
    }).to.throw();
  });

  it('returns unsubscribe errors when trying to destroy presence', function(done) {
    sinon.stub(presence1, 'unsubscribe').callsFake(function(callback) {
      callback(new Error('bad'));
    });

    presence1.destroy(function(error) {
      expect(error).to.be.ok;
      done();
    });
  });

  it('emits unsubscribe errors when trying to destroy presence', function(done) {
    sinon.stub(presence1, 'unsubscribe').callsFake(function(callback) {
      callback(new Error('bad'));
    });

    presence1.once('error', function() {
      done();
    });
    presence1.destroy();
  });

  it('emits an error when trying to broadcast all presence with an error', function(done) {
    presence1.once('error', function() {
      done();
    });

    presence1._broadcastAllLocalPresence(new Error('bad'));
  });

  it('emits a subscribe error on reconnection', function(done) {
    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        var handleSubscribe = presence1._handleSubscribe;
        sinon.stub(presence1, '_handleSubscribe').callsFake(function(error, seq) {
          error = new Error('bad');
          handleSubscribe.apply(presence1, [error, seq]);
        });

        presence1.once('error', function() {
          next();
        });

        connection1._setState('disconnected');
        connection1._setState('connecting');
        connection1._setState('connected');
      }
    ], done);
  });

  it('emits a subscribe error on reconnection when there are subscribe requests without callbacks', function(done) {
    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        var handleSubscribe = presence1._handleSubscribe;
        sinon.stub(presence1, '_handleSubscribe').callsFake(function(error, seq) {
          error = new Error('bad');
          handleSubscribe.apply(presence1, [error, seq]);
        });

        presence1.once('error', function() {
          next();
        });

        connection1._setState('disconnected');
        presence1.subscribe();
        connection1._setState('connecting');
        connection1._setState('connected');
      }
    ], done);
  });

  it('ignores presence that arrives out of order', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        var hasPaused = false;
        // Catch the first presence update, but then allow later ones
        presencePauser.pause(function() {
          if (hasPaused) return false;
          hasPaused = true;
          return true;
        });

        localPresence1.submit({index: 2}, next);
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 3});

          presence2.once('receive', function() {
            done(new Error('should not get another presence event'));
          });

          presencePauser.resume();
          next();
        });

        localPresence1.submit({index: 3}, errorHandler(done));
      }
    ], done);
  });

  it('adds itself back onto the connection after a destroy and a resubscribe', function(done) {
    async.series([
      presence1.destroy.bind(presence1),
      presence1.subscribe.bind(presence1),
      function(next) {
        expect(connection1._presences[presence1.channel]).to.equal(presence1);
        next();
      }
    ], done);
  });

  it('broadcasts a null presence when the connection is disconnected', function(done) {
    var localPresence1 = presence1.create('presence-1');
    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 3}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
        connection1.close();
      }
    ], done);
  });
});
