var Backend = require('../../../lib/backend');
var expect = require('chai').expect;
var async = require('async');
var types = require('../../../lib/types');
var presenceTestType = require('./presence-test-type');
var errorHandler = require('../../util').errorHandler;
var PresencePauser = require('./presence-pauser');
types.register(presenceTestType.type);

describe('DocPresence', function() {
  var backend;
  var connection1;
  var connection2;
  var doc1;
  var doc2;
  var presence1;
  var presence2;
  var presencePauser;

  beforeEach(function(done) {
    backend = new Backend({presence: true});
    connection1 = backend.connect();
    connection2 = backend.connect();

    presencePauser = new PresencePauser();

    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(request, callback) {
      presencePauser.sendPresence(request, callback);
    });

    doc1 = connection1.get('books', 'northern-lights');
    doc2 = connection2.get('books', 'northern-lights');

    async.series([
      doc1.create.bind(doc1, 'North Lights', presenceTestType.type.name),
      doc1.subscribe.bind(doc1),
      doc2.subscribe.bind(doc2),
      function(next) {
        presence1 = connection1.getDocPresence('books', 'northern-lights');
        presence2 = connection2.getDocPresence('books', 'northern-lights');
        next();
      }
    ], done);
  });

  afterEach(function(done) {
    delete presenceTestType.type.invert;
    connection1.close();
    connection2.close();
    backend.close(done);
  });

  it('subscribes to presence from another client', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('transforms existing remote presence when a new local op is applied', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 7}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 7});
          next();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(doc2.data).to.eql('Northern Lights');
          expect(presence).to.eql({index: 10});
          expect(presence2.remotePresences).to.eql({
            'presence-1': {index: 10}
          });
          next();
        });

        doc2.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('transforms existing local presence when a new local op is applied', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      localPresence1.submit.bind(localPresence1, {index: 7}),
      doc1.submitOp.bind(doc1, {index: 5, value: 'ern'}),
      function(next) {
        expect(localPresence1.value).to.eql({index: 10});
        next();
      }
    ], done);
  });

  it('progresses another client\'s presence when they send an op at their index', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        localPresence2.submit({index: 5}, errorHandler(done));
        presence1.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc2.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 8});
          next();
        });
      }
    ], done);
  });

  it('does not progress another client\'s index when inserting a local op at their index', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        localPresence2.submit({index: 5}, errorHandler(done));
        presence1.once('receive', function() {
          next();
        });
      },
      function(next) {
        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 5});
          next();
        });
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('waits for pending ops before submitting presence', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        localPresence1.submit({index: 20}, errorHandler(done));

        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 20});
          expect(doc2.version).to.eql(2);
          next();
        });
      }
    ], done);
  });

  it('queues two updates immediately after one another', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 4}, errorHandler(done));
        localPresence1.submit({index: 5}, errorHandler(done));

        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 4});
          presence2.once('receive', function(id, presence) {
            expect(presence).to.eql({index: 5});
            next();
          });
        });
      }
    ], done);
  });

  it('transforms pending presence by another op submitted before a flush', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        localPresence1.submit({index: 20}, errorHandler(done));
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));

        presence2.once('receive', function(id, presence) {
          expect(doc2.version).to.eql(3);
          expect(doc2.data).to.eql('Northern Lights: His Dark Materials');
          expect(presence).to.eql({index: 23});
          next();
        });
      }
    ], done);
  });

  it('updates the document when the presence version is ahead', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.eql(1);
        expect(doc2.version).to.eql(2);

        localPresence2.submit({index: 12}, errorHandler(done));

        presence1.once('receive', function(id, presence) {
          expect(doc1.version).to.eql(2);
          expect(presence).to.eql({index: 12});
          next();
        });
      }
    ], done);
  });

  it('transforms old presence when its version is behind the latest doc', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.eql(1);
        expect(doc2.version).to.eql(2);

        localPresence1.submit({index: 12}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(doc2.version).to.eql(2);
          expect(presence).to.eql({index: 15});
          next();
        });
      }
    ], done);
  });

  it('returns errors when failing to transform old presence to the latest doc', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.eql(1);
        expect(doc2.version).to.eql(2);

        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          next();
        });
      }
    ], done);
  });

  it('transforms old presence when it arrives later than a new op', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        presencePauser.pause();
        presencePauser.onPause = function() {
          next();
        };
        localPresence1.submit({index: 12}, errorHandler(done));
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));

        doc2.once('op', function() {
          presencePauser.resume();
        });

        presence2.once('receive', function(id, presence) {
          expect(doc2.version).to.eql(2);
          expect(presence).to.eql({index: 15});
          next();
        });
      }
    ], done);
  });

  // This test case attempts to force us into a tight race condition corner case:
  // 1. doc1 sends presence, as well as submits an op
  // 2. doc2 receives the op first, followed by the presence, which is now out-of-date
  // 3. doc2 re-requests doc1's presence again
  // 4. doc1 sends *another* op, which *again* beats the presence update (this could
  //    in theory happen many times in a row)
  it('transforms old presence when new ops keep beating the presence responses', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        // Pause presence just before sending it back to the clients. It's already been
        // transformed by the server to what the server knows as the latest version
        presencePauser.pause();
        presencePauser.onPause = function() {
          next();
        };

        localPresence1.submit({index: 12}, errorHandler(done));
      },
      function(next) {
        // Now we submit another op, while the presence is still paused. We wait until
        // doc2 has received this op, so we know that when we finally receive our
        // presence, it will be stale
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        // At this point in the test, both docs are up-to-date on v2, but doc2 still
        // hasn't received doc1's v1 presence
        expect(doc1.version).to.eql(2);
        expect(doc2.version).to.eql(2);

        // Resume presence broadcasts so that doc2 receives v1's stale presence
        presencePauser.resume();
        // However, now immediately pause again. Set a conditional pause, which
        // will allow doc2 to request presence from doc1, but will pause doc1's
        // presence response, making it stale again
        presencePauser.pause(function(request) {
          return request.presence.id === 'presence-1';
        });
        presencePauser.onPause = function() {
          presencePauser.onPause = null;

          // When we capture doc1's response, doc1 also submits some ops, which
          // will make its response stale again.
          doc1.submitOp({index: 0, value: 'The'}, function(error) {
            if (error) return done(error);
            doc1.submitOp({index: 3, value: ' '}, errorHandler(done));
            doc2.on('op', function() {
              // This will get fired for v3 and then v4, so check for the later one
              if (doc1.version === 4 && doc2.version === 4) {
                // Only once doc2 has received the ops, should we resume our
                // broadcasts, ensuring that the update is stale again.
                presencePauser.resume();
                // Despite the second reply being stale, we expect to have transformed it
                // up to the current version.
                presence2.once('receive', function(id, presence) {
                  expect(doc2.version).to.eql(4);
                  expect(presence).to.eql({index: 19});
                  next();
                });
              }
            });
          });
        };
      }
    ], done);
  });

  // This test is for a similar case to the above test case, but ensures that our
  // op cache correctly handles deletion and creation ops
  it('transforms old presence when a doc is deleted and then created', function(done) {
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
        localPresence1.submit({index: 12}, errorHandler(done));
        presencePauser.pause();
        presencePauser.onPause = function() {
          presencePauser.onPause = null;
          next();
        };
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        expect(doc1.version).to.eql(2);
        expect(doc2.version).to.eql(2);

        presencePauser.resume();
        presencePauser.pause(function(request) {
          return request.presence.id === 'presence-1';
        });
        presencePauser.onPause = function() {
          presencePauser.onPause = null;

          async.series([
            doc1.del.bind(doc1),
            doc1.create.bind(doc1, 'Subtle Knife', presenceTestType.type.name),
            doc1.submitOp.bind(doc1, {index: 0, value: 'The '})
          ], errorHandler(done));
        };

        doc2.on('op', function() {
          if (doc2.version !== 5) return;
          presencePauser.resume();
          presence2.once('receive', function(id, presence) {
            expect(doc2.version).to.eql(5);
            expect(presence).to.be.null;
            next();
          });
        });
      }
    ], done);
  });

  it('transforms local presence when a doc is deleted and created locally', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      localPresence1.submit.bind(localPresence1, {index: 3}),
      doc1.del.bind(doc1),
      doc1.create.bind(doc1, 'Subtle Knife', presenceTestType.type.uri),
      function(next) {
        expect(localPresence1.value).to.be.null;
        next();
      }
    ], done);
  });

  it('transforms pending presence by a re-creation submitted before a flush', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        localPresence1.submit({index: 20}, errorHandler(done));
        doc1.del(errorHandler(done));
        doc1.create('Subtle Knife', presenceTestType.type.uri, errorHandler(done));

        presence2.on('receive', function(id, presence) {
          if (doc2.version !== 4) return;
          expect(doc2.data).to.eql('Subtle Knife');
          expect(presence).to.be.null;
          next();
        });
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

  it('ignores pending presence that arrives out of order', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        var pauseCount = 0;
        presencePauser.pause();
        presencePauser.onPause = function() {
          pauseCount++;
          if (pauseCount === 2) {
            expect(this._pendingBroadcasts[0][0].presence.p).to.eql({index: 2});
            expect(this._pendingBroadcasts[1][0].presence.p).to.eql({index: 4});
            expect(this._pendingBroadcasts[0][0].presence.pv)
              .to.be.lessThan(this._pendingBroadcasts[1][0].presence.pv);

            // Fire the broadcasts in the reverse order
            this._pendingBroadcasts[1][1]();
            this._pendingBroadcasts[0][1]();
          }
        };

        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 4});
          next();
        });

        localPresence2.submit({index: 2}, errorHandler(done));
        localPresence2.submit({index: 4}, errorHandler(done));
      }
    ], done);
  });

  it('rejects a presence message with a numeric collection', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.c = 1;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with an invalid version', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.v = -1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message without an ID', function(done) {
    var localPresence1 = presence1.create('presence-1');
    // Have to catch the error on the Presence instance, because obviously
    // we won't find the LocalPresence without the ID
    presence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.id = null;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('only sends presence responses for the associated doc', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence2.create('presence-2');
    var otherDoc1 = connection1.get('books', 'subtle-knife');
    var otherDoc2 = connection2.get('books', 'subtle-knife');
    var otherPresence1 = connection1.getDocPresence('books', 'subtle-knife');
    var otherPresence2 = connection2.getDocPresence('books', 'subtle-knife');
    var localOtherPresence1 = otherPresence1.create('other-presence-1');

    async.series([
      otherDoc1.create.bind(otherDoc1, 'Subtle Knife', presenceTestType.type.uri),
      otherDoc2.subscribe.bind(otherDoc2),
      otherPresence2.subscribe.bind(otherPresence2),
      function(next) {
        localOtherPresence1.submit({index: 0}, errorHandler(done));
        otherPresence2.once('receive', function() {
          next();
        });
      },
      localPresence1.submit.bind(localPresence1, {index: 3}),
      function(next) {
        localPresence2.submit({index: 5}, next);
        otherPresence1.on('receive', function() {
          done(new Error('Other document should not have had presence sent'));
        });
        otherPresence2.on('receive', function() {
          done(new Error('Other document should not have had presence sent'));
        });
      }
    ], done);
  });

  it('sends the presence data once the connection can send', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        connection2._setState('disconnected');
        localPresence2.submit({index: 1}, errorHandler(done));

        doc2.whenNothingPending(function() {
          // The connection tests whether we can send just before sending on
          // nothing pending, so let's also wait to reset the connection.
          connection2._setState('connecting');
          connection2._setState('connected');
        });

        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('re-requests presence when reconnecting', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        connection1.once('closed', function() {
          next();
        });
        connection1.close();
      },
      localPresence2.submit.bind(localPresence2, {index: 0}),
      function(next) {
        backend.connect(connection1);
        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 0});
          next();
        });
      }
    ], done);
  });

  it('un-transforms presence after a soft rollback', function(done) {
    // Mock invert so that we can trigger a soft rollback instead of a hard rollback
    presenceTestType.type.invert = function() {
      return {index: 5, del: 3};
    };

    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, {index: 7}),
      function(next) {
        localPresence2.submit({index: 8}, errorHandler(done));
        presence1.once('receive', function() {
          next();
        });
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.apply, function(request, callback) {
          callback({code: 'ERR_OP_SUBMIT_REJECTED'});
        });

        presence1.once('receive', function() {
          expect(localPresence1.value).to.eql({index: 10});
          expect(presence1.remotePresences).to.eql({
            'presence-2': {index: 11}
          });

          presence1.once('receive', function() {
            expect(localPresence1.value).to.eql({index: 7});
            expect(presence1.remotePresences).to.eql({
              'presence-2': {index: 8}
            });
            next();
          });
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('performs a hard reset on presence when the doc is hard rolled back', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, {index: 7}),
      function(next) {
        localPresence2.submit({index: 8}, errorHandler(done));
        presence1.once('receive', function() {
          next();
        });
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.apply, function(request, callback) {
          callback({code: 'ERR_OP_SUBMIT_REJECTED'});
        });

        presence1.once('receive', function() {
          expect(localPresence1.value).to.eql({index: 10});
          expect(presence1.remotePresences).to.eql({
            'presence-2': {index: 11}
          });

          presence1.once('receive', function() {
            expect(localPresence1.value).to.be.null;
            expect(presence1.remotePresences).to.eql({});
            next();
          });
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('can receive presence before performing the first fetch on a document', function(done) {
    var connection3 = backend.connect();
    var doc3 = connection3.get('books', 'northern-lights');
    var presence3 = connection3.getDocPresence('books', 'northern-lights');
    var localPresence3 = presence3.create('presence-3');

    async.series([
      presence1.subscribe.bind(presence1),
      doc3.fetch.bind(doc3),
      function(next) {
        localPresence3.submit({index: 1}, errorHandler(done));
        presence1.once('receive', function(id, presence) {
          expect(id).to.eql('presence-3');
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('errors when submitting presence on a document that has not been created', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      doc1.del.bind(doc1),
      function(next) {
        localPresence1.submit({index: 2}, function(error) {
          expect(error.code).to.eql('ERR_DOC_DOES_NOT_EXIST');
          next();
        });
      }
    ], done);
  });

  it('errors when trying to submit presence on a type that does not support it', function(done) {
    var jsonDoc = connection1.get('books', 'snuff');
    var jsonPresence = connection1.getDocPresence('books', 'snuff');
    var localJsonPresence = jsonPresence.create('json-presence');

    async.series([
      jsonDoc.create.bind(jsonDoc, {title: 'Snuff'}, 'json0'),
      function(next) {
        localJsonPresence.submit({index: 1}, function(error) {
          expect(error.code).to.eql('ERR_TYPE_DOES_NOT_SUPPORT_PRESENCE');
          next();
        });
      }
    ], done);
  });

  it('errors local presence when listening to ops on a type that does not support presence', function(done) {
    var jsonDoc = connection1.get('books', 'emma');
    var jsonPresence = connection1.getDocPresence('books', 'emma');
    var localJsonPresence = jsonPresence.create('json-presence');
    localJsonPresence.submit({index: 1}, function() {
      // Swallow error, which is expected since presence is unsupported
    });

    async.series([
      jsonDoc.create.bind(jsonDoc, {title: 'Emma'}, 'json0'),
      function(next) {
        localJsonPresence.once('error', function(error) {
          expect(error.code).to.eql('ERR_TYPE_DOES_NOT_SUPPORT_PRESENCE');
          next();
        });

        jsonDoc.submitOp({p: ['author'], oi: 'Jane Austen'});
      }
    ], done);
  });

  it('returns errors sent from the middleware', function(done) {
    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(request, callback) {
      callback('some error');
    });

    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        localPresence2.submit({index: 0}, errorHandler(done));
        presence1.once('error', function(error) {
          expect(error.message).to.equal('some error');
          next();
        });
      }
    ], done);
  });

  it('removes doc event listeners when destroying presence', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence2.subscribe.bind(presence2),
      localPresence2.submit.bind(localPresence2, {index: 2}),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      presence2.destroy.bind(presence2),
      function(next) {
        expect(doc2._eventsCount).to.equal(0);
        next();
      }
    ], done);
  });

  it('destroys remote presence when it is updated with null', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done)),
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        localPresence1.submit(null, errorHandler(done)),
        presence2.once('receive', function(id, presence) {
          expect(presence).to.be.null;
          expect(doc2._eventsCount).to.equal(0);
          next();
        });
      }
    ], done);
  });

  it('waits for local pending ops before accepting remote presence', function(done) {
    var localPresence2 = presence2.create('presence-2');

    var triggerApply;
    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.apply, function(request, callback) {
          triggerApply = callback;
          expect(doc1.inflightOp).to.be.ok;
          expect(doc1.pendingOps).to.be.empty;
          next();
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      },
      localPresence2.submit.bind(localPresence2, {index: 10}),
      function(next) {
        triggerApply();
        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 13});
          next();
        });
      }
    ], done);
  });

  it('emits an error when trying to transform bad local presence against an op', function(done) {
    var localPresence1 = presence1.create('presence-1');

    localPresence1.submit({badProp: 'foo'}, function(error) {
      expect(error).to.be.ok;
    });

    localPresence1.once('error', function() {
      done();
    });

    doc1.submitOp({index: 5, value: 'ern'});
  });

  it('emits an error when trying to transform bad remote presence against an op', function(done) {
    var localPresence2 = presence2.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      function(next) {
        localPresence2.submit({badProp: 'foo'}, errorHandler(done));
        presence1.once('receive', function(id, presence) {
          expect(presence).to.eql({badProp: 'foo'});
          next();
        });
      },
      function(next) {
        localPresence2.once('error', function() {
          // Ignore the local error
        });
        presence1.once('error', function() {
          next();
        });
        doc1.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('sends null presence when the doc is destroyed', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc1.destroy(errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
      }
    ], done);
  });

  it('does not error when destroying presence for a deleted doc', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      doc1.del.bind(doc1),
      localPresence1.destroy.bind(localPresence1),
      function(next) {
        expect(Object.keys(presence1.localPresences)).to.be.empty;
        next();
      }
    ], done);
  });

  it('does not transform presence submitted in an op event when the presence was created late', function(done) {
    var localPresence1;

    doc1.on('op', function() {
      localPresence1.submit({index: 7});
    });

    localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'});
        presence2.on('receive', function(id, value) {
          expect(value).to.eql({index: 7});
          next();
        });
      }
    ], done);
  });

  it('does transform late-created presence submitted in an op event by a deep second op', function(done) {
    var localPresence1;

    var submitted = false;
    doc1.on('op', function() {
      if (submitted) return;
      submitted = true;
      localPresence1.submit({index: 7});
      doc1.submitOp({index: 5, value: 'akg'});
    });

    localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'});
        presence2.on('receive', function(id, value) {
          expect(value).to.eql({index: 10});
          next();
        });
      }
    ], done);
  });

  it('does not trigger EventEmitter memory leak warnings', function() {
    for (var i = 0; i < 100; i++) {
      presence1.create();
    }

    expect(doc1._events.op.warned).not.to.be.ok;
    var emitter = connection1._docPresenceEmitter._emitters[doc1.collection][doc1.id];
    expect(emitter._events.op.warned).not.to.be.ok;
  });
});
