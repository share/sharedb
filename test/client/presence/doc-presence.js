var Backend = require('../../../lib/backend');
var expect = require('chai').expect;
var async = require('async');
var types = require('../../../lib/types');
var presenceTestType = require('./presence-test-type');
var errorHandler = require('../../util').errorHandler;
var PresencePauser = require('./presence-pauser');
var sinon = require('sinon');
var ACTIONS = require('../../../lib/message-actions').ACTIONS;
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

  function onPresenceThroughMiddleware(index, callback) {
    backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, next) {
      next();
      if (context.presence.p && context.presence.p.index === index) callback();
    });
  }

  function sendPresence(localPresence, fields) {
    var message = localPresence._message();
    message.v = doc2.version;
    message.t = presenceTestType.type.uri;
    for (var key in fields) message[key] = fields[key];
    connection1.send(message);
  }

  function holdNextSnapshotFetch(onHeld) {
    var getSnapshot = backend.db.getSnapshot;
    sinon.stub(backend.db, 'getSnapshot').callsFake(function(collection, id, fields, options, snapshotCallback) {
      var args = arguments;
      backend.db.getSnapshot.restore();
      onHeld(function release(error) {
        if (error) return snapshotCallback(error);
        getSnapshot.apply(backend.db, args);
      });
    });
  }

  function leaveWithHeldTransform(localPresence, leaveCallback) {
    var leave = {release: null};
    leave.submit = function(callback) {
      async.series([
        presence2.subscribe.bind(presence2),
        function(next) {
          localPresence.submit({index: 0}, errorHandler(callback));
          presence2.once('receive', function() {
            next();
          });
        },
        function(next) {
          holdNextSnapshotFetch(function(release) {
            leave.release = release;
            next();
          });
          localPresence.submit(null, leaveCallback);
        }
      ], callback);
    };
    return leave;
  }

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

  it('does not call getOps() when presence is already up-to-date', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      doc1.fetch.bind(doc1), // Ensure up-to-date
      function(next) {
        sinon.spy(Backend.prototype, 'getOps');
        next();
      },
      localPresence1.submit.bind(localPresence1, {index: 1}),
      function(next) {
        expect(Backend.prototype.getOps).not.to.have.been.called;
        next();
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

  it('rejects a presence message with a non-integer version', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.v = 1.5;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message without a version', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  [
    {description: 'without doc coordinates', c: undefined, d: undefined},
    {description: 'for another doc', c: 'books', d: 'subtle-knife'}
  ].forEach(function(test) {
    it('ignores remote presence on its channel ' + test.description, function(done) {
      sinon.spy(doc2, 'fetch');

      [doc2.version, doc2.version + 1].forEach(function(version, index) {
        var message = presence1.create('presence-' + index)._message();
        message.c = test.c;
        message.d = test.d;
        message.p = {index: 1};
        message.v = version;
        message.t = presenceTestType.type.uri;
        connection2.handleMessage(message);
      });

      doc2.whenNothingPending(function() {
        expect(presence2.remotePresences).to.be.empty;
        expect(presence2._remotePresenceInstances).to.be.empty;
        expect(doc2.fetch).not.to.have.been.called;
        done();
      });
    });
  });

  it('rejects presence whose version is ahead of the doc', function(done) {
    var localPresence1 = presence1.create('presence-1');
    presence2.on('receive', function() {
      done(new Error('Should not broadcast presence from the future'));
    });

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.on('error', function(error) {
          expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
          expect(connection1.agent.presenceRequests[presence1.channel]['presence-1'].p).to.be.null;
          next();
        });

        var message = localPresence1._message();
        message.p = {index: 1};
        message.v = doc1.version + 1;
        message.t = presenceTestType.type.uri;
        connection1.send(message);
      }
    ], done);
  });

  it('rejects presence ahead of a tracked doc', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      localPresence1.submit.bind(localPresence1, {index: 1}),
      function(next) {
        localPresence1.on('error', function(error) {
          expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
          next();
        });

        var message = localPresence1._message();
        message.p = {index: 1};
        message.v = doc1.version + 1;
        message.t = presenceTestType.type.uri;
        connection1.send(message);
      }
    ], done);
  });

  it('rejects presence ahead of a tracked doc after ops to a doc on the same channel', function(done) {
    var notesDoc1 = connection1.get('notes', 'private.alice');
    var diaryDoc1 = connection1.get('notes.private', 'alice');
    var diaryDoc2 = connection2.get('notes.private', 'alice');
    var localNotesPresence1 = connection1.getDocPresence('notes', 'private.alice').create('notes-presence');

    async.series([
      notesDoc1.create.bind(notesDoc1, 'Hello', presenceTestType.type.name),
      localNotesPresence1.submit.bind(localNotesPresence1, {index: 1}),
      diaryDoc2.create.bind(diaryDoc2, 'Dear diary', presenceTestType.type.name),
      diaryDoc1.subscribe.bind(diaryDoc1),
      function(next) {
        diaryDoc1.once('op', function() {
          next();
        });
        diaryDoc2.submitOp({index: 0, value: 'Oh, '}, errorHandler(done));
      },
      function(next) {
        localNotesPresence1.on('error', function(error) {
          expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
          next();
        });

        expect(diaryDoc2.version).to.be.above(notesDoc1.version);
        var message = localNotesPresence1._message();
        message.p = {index: 1};
        message.v = diaryDoc2.version;
        message.t = presenceTestType.type.uri;
        connection1.send(message);
      }
    ], done);
  });

  it('does not read the snapshot for presence after its own client\'s op', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc2.once('op', function() {
          next();
        });
        doc1.submitOp({index: 0, value: 'The '}, errorHandler(done));
      },
      function(next) {
        sinon.spy(backend.db, 'getSnapshot');
        localPresence1.submit({index: 6}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 6});
          expect(backend.db.getSnapshot).not.to.have.been.called;
          next();
        });
      }
    ], done);
  });

  it('does not read the snapshot for presence at the tracked doc version', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        sinon.spy(backend.db, 'getSnapshot');
        localPresence1.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 2});
          expect(backend.db.getSnapshot).not.to.have.been.called;
          next();
        });
      }
    ], done);
  });

  it('clamps a leave ahead of the doc to the doc version', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', done);
    sinon.spy(doc2, 'fetch');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          expect(connection1.agent.presenceRequests[presence1.channel]['presence-1'].v).to.equal(doc1.version);
          expect(doc2.fetch).not.to.have.been.called;
          next();
        });

        var leave = localPresence1._message();
        leave.p = null;
        leave.v = doc1.version + 1;
        leave.t = presenceTestType.type.uri;
        connection1.send(leave);
      }
    ], done);
  });

  it('broadcasts null presence on disconnect after rejecting presence ahead of the doc', function(done) {
    var localPresence1 = presence1.create('presence-1');

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
        localPresence1.once('error', function(error) {
          expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
          next();
        });

        var message = localPresence1._message();
        message.v = doc1.version + 1;
        message.t = presenceTestType.type.uri;
        connection1.send(message);
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

  it('accepts up-to-date presence when the agent\'s tracked doc version lags behind', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        connection1.agent.latestDocVersions.books['northern-lights'] = 1;
        localPresence1.submit({index: 12}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(doc2.version).to.eql(2);
          expect(presence).to.eql({index: 12});
          next();
        });
      }
    ], done);
  });

  it('transforms presence ahead of the agent\'s lagging tracked doc version by later ops', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        doc2.submitOp({index: 0, value: 'The '}, errorHandler(done));
        doc1.once('op', function() {
          next();
        });
      },
      function(next) {
        connection1.agent.latestDocVersions.books['northern-lights'] = 1;
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 16});
          next();
        });

        var message = localPresence1._message();
        message.p = {index: 12};
        message.v = 2;
        message.t = presenceTestType.type.uri;
        connection1.send(message);
      }
    ], done);
  });

  it('rejects presence ahead of the doc when transformed without a tracked version', function(done) {
    var presence = {
      c: 'books',
      d: 'northern-lights',
      p: {index: 1},
      v: doc1.version + 1,
      t: presenceTestType.type.uri
    };
    backend.transformPresenceToLatestVersion(connection1.agent, presence, function(error) {
      expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
      done();
    });
  });

  it('broadcasts the old leave before presence re-created with its id while the leave is transforming', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, errorHandler(done));
    var received = [];

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
      },
      function(next) {
        presence2.on('receive', function(id, presence) {
          received.push(presence);
          if (received.length === 2) next();
        });
        leave.release();
      },
      function(next) {
        expect(received).to.eql([null, {index: 2}]);
        expect(connection1.agent.presenceRequests[presence1.channel]['presence-1'].p).to.eql({index: 2});
        next();
      }
    ], done);
  });

  it('broadcasts the old leave before a later update from presence re-created with the same id', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, errorHandler(done));
    var received = [];

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(3, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
        sendPresence(localPresence1, {p: {index: 3}, pv: 1});
      },
      function(next) {
        presence2.on('receive', function(id, presence) {
          received.push(presence);
          if (presence && presence.index === 3) next();
        });
        leave.release();
      },
      function(next) {
        expect(received[0]).to.be.null;
        expect(presence2.remotePresences['presence-1']).to.eql({index: 3});
        next();
      }
    ], done);
  });

  it('broadcasts the old leave before presence re-created with its id when a later leave is rejected', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, errorHandler(done));
    var rejectLaterLeave;
    var received = [];

    async.series([
      leave.submit,
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (context.presence.pv !== 2) return callback();
          rejectLaterLeave = callback;
          next();
        });
        sendPresence(localPresence1, {p: null, pv: 2, v: doc1.version});
      },
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
      },
      function(next) {
        localPresence1.once('error', function(error) {
          expect(error.message).to.equal('Rejected');
          setImmediate(next);
        });
        rejectLaterLeave(new Error('Rejected'));
      },
      function(next) {
        presence2.on('receive', function(id, presence) {
          received.push(presence);
          if (received.length === 2) next();
        });
        leave.release();
      },
      function(next) {
        expect(received).to.eql([null, {index: 2}]);
        next();
      }
    ], done);
  });

  it('broadcasts presence re-created with its id when the old leave fails to publish', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var onLeaveAcked;
    var leave = leaveWithHeldTransform(localPresence1, function(error) {
      onLeaveAcked(error);
    });

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
      },
      function(next) {
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data, callback) {
          backend.pubsub.publish.restore();
          callback(new Error('Failed to publish'));
        });
        async.parallel([
          function(cb) {
            onLeaveAcked = function(error) {
              expect(error.message).to.equal('Failed to publish');
              cb();
            };
          },
          function(cb) {
            presence2.once('receive', function(id, presence) {
              expect(presence).to.eql({index: 2});
              cb();
            });
          }
        ], next);
        leave.release();
      }
    ], done);
  });

  it('broadcasts presence re-created with its id when the old leave fails to transform', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var onLeaveAcked;
    var leave = leaveWithHeldTransform(localPresence1, function(error) {
      onLeaveAcked(error);
    });

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
      },
      function(next) {
        async.parallel([
          function(cb) {
            onLeaveAcked = function(error) {
              expect(error.message).to.equal('Failed to get snapshot');
              cb();
            };
          },
          function(cb) {
            presence2.once('receive', function(id, presence) {
              expect(presence).to.eql({index: 2});
              cb();
            });
          }
        ], next);
        leave.release(new Error('Failed to get snapshot'));
      }
    ], done);
  });

  it('broadcasts and releases presence re-created behind an old leave that never finishes publishing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, function() {});

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0});
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          if (!data.p) return publish.call(backend.pubsub, channels, data, function() {});
          connection1.agent._pendingPresenceBroadcasts.forEach(function(broadcast) {
            expect(broadcast.waitingFor).to.be.null;
          });
          backend.pubsub.publish.restore();
          publish.apply(backend.pubsub, arguments);
        });
        presence2.on('receive', function(id, presence) {
          if (!presence) return;
          expect(presence).to.eql({index: 2});
          next();
        });
        leave.release();
      }
    ], done);
  });

  it('does not hold presence with another id behind a leave that is transforming', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var otherLocalPresence1 = presence1.create('presence-2');
    var leave = leaveWithHeldTransform(localPresence1, function() {});

    async.series([
      leave.submit,
      function(next) {
        otherLocalPresence1.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-2');
          expect(presence).to.eql({index: 2});
          leave.release();
          next();
        });
      }
    ], done);
  });

  it('broadcasts one leave for presence re-created behind its old leave when the client disconnects', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, function() {});
    var published = [];

    async.series([
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: 0, v: doc1.version});
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          callback();
          if (context.presence.p === null && context.presence.pv === 0) next();
        });
        connection1.close();
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          published.push({p: data.p, pv: data.pv, v: data.v});
          publish.apply(backend.pubsub, arguments);
        });
        leave.release();
        setImmediate(next);
      },
      function(next) {
        backend.pubsub.publish.restore();
        expect(published).to.have.deep.members([
          {p: null, pv: 1, v: doc2.version},
          {p: null, pv: 0, v: doc2.version}
        ]);
        next();
      }
    ], done);
  });

  it('drops presence queued behind a held unsubscribe leave when its client disconnects', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var agent = connection1.agent;
    var releaseUnsubscribeLeave;
    var droppedPresence;

    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, {index: 0}),
      function(next) {
        holdNextSnapshotFetch(function(release) {
          releaseUnsubscribeLeave = release;
          next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        onPresenceThroughMiddleware(1, next);
        localPresence1.submit({index: 1}, function() {});
      },
      function(next) {
        var dropPresence = agent._dropPresence;
        sinon.stub(agent, '_dropPresence').callsFake(function(presence) {
          agent._dropPresence.restore();
          droppedPresence = presence.p;
          dropPresence.apply(agent, arguments);
          next();
        });
        connection1.close();
      },
      function(next) {
        expect(droppedPresence).to.eql({index: 1});
        releaseUnsubscribeLeave();
        next();
      }
    ], done);
  });

  it('broadcasts a leave for presence in middleware at disconnect before a held unsubscribe leave', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseUnsubscribeLeave;
    var releaseUpdate;
    var updatePv;
    var published;

    async.series([
      presence1.subscribe.bind(presence1),
      localPresence1.submit.bind(localPresence1, {index: 0}),
      function(next) {
        holdNextSnapshotFetch(function(release) {
          releaseUnsubscribeLeave = release;
          next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (!context.presence.p || context.presence.p.index !== 1) return callback();
          updatePv = context.presence.pv;
          releaseUpdate = callback;
          next();
        });
        localPresence1.submit({index: 1}, function() {});
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          backend.pubsub.publish.restore();
          published = {p: data.p, pv: data.pv};
          publish.apply(backend.pubsub, arguments);
          next();
        });
        connection1.agent.stream.once('end', function() {
          releaseUpdate();
        });
        connection1.close();
      },
      function(next) {
        expect(published).to.eql({p: null, pv: updatePv});
        releaseUnsubscribeLeave();
        next();
      }
    ], done);
  });

  it('acks presence queued behind its leave when its client unsubscribes before the leave publishes', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, function() {});
    var onUpdateAcked;

    async.series([
      presence1.subscribe.bind(presence1),
      leave.submit,
      function(next) {
        onPresenceThroughMiddleware(2, next);
        localPresence1.submit({index: 2}, function(error) {
          onUpdateAcked(error);
        });
      },
      function(next) {
        onUpdateAcked = next;
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        leave.release();
        setImmediate(next);
      }
    ], done);
  });

  it('acks presence retracted behind a held unsubscribe leave, which still precedes a re-creation', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseUnsubscribeLeave;
    var onUpdateAcked;
    var received = [];

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 0}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        holdNextSnapshotFetch(function(release) {
          releaseUnsubscribeLeave = release;
          next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      presence1.subscribe.bind(presence1),
      function(next) {
        onPresenceThroughMiddleware(1, next);
        localPresence1.submit({index: 1}, function(error) {
          onUpdateAcked(error);
        });
      },
      function(next) {
        onUpdateAcked = next;
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        onPresenceThroughMiddleware(2, next);
        presence1.create('presence-1').submit({index: 2}, errorHandler(done));
      },
      function(next) {
        presence2.on('receive', function(id, presence) {
          received.push(presence);
          if (received.length === 2) next();
        });
        releaseUnsubscribeLeave();
      },
      function(next) {
        expect(received).to.eql([null, {index: 2}]);
        next();
      }
    ], done);
  });

  it('broadcasts presence re-created behind a held leave once a retracted leave supersedes it', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseUnsubscribeLeave;
    var releaseClientLeave;
    var clientLeave = 1;
    var received = [];

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 0}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        holdNextSnapshotFetch(function(release) {
          releaseUnsubscribeLeave = release;
          next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      presence1.subscribe.bind(presence1),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          callback();
          if (context.presence.pv === clientLeave) next();
        });
        localPresence1.submit(null, errorHandler(done));
      },
      function(next) {
        holdNextSnapshotFetch(function(release) {
          releaseClientLeave = release;
          next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        onPresenceThroughMiddleware(2, next);
        presence1.create('presence-1').submit({index: 2}, errorHandler(done));
      },
      function(next) {
        presence2.on('receive', function(id, presence) {
          received.push(presence);
          if (received.length === 2) next();
        });
        releaseClientLeave();
      },
      function(next) {
        releaseUnsubscribeLeave();
        setImmediate(next);
      },
      function(next) {
        expect(received).to.eql([null, {index: 2}]);
        expect(presence2.remotePresences['presence-1']).to.eql({index: 2});
        next();
      }
    ], done);
  });

  it('broadcasts a leave queued behind a held one when its client unsubscribes, dropping the held one', function(done) {
    var onEarlierLeaveAcked;
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, function(error) {
      onEarlierLeaveAcked(error);
    });
    var queuedLeave = 2;
    var unsubscribeLeave = 0;
    var publishedPresenceVersions = [];

    async.series([
      presence1.subscribe.bind(presence1),
      leave.submit,
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          callback();
          if (context.presence.pv === queuedLeave) next();
        });
        sendPresence(localPresence1, {p: null, pv: queuedLeave, v: doc1.version});
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          publishedPresenceVersions.push(data.pv);
          publish.apply(backend.pubsub, arguments);
          if (publishedPresenceVersions.length === 2) next();
        });
        presence1.unsubscribe(errorHandler(done));
      },
      function(next) {
        onEarlierLeaveAcked = next;
        leave.release();
      },
      function(next) {
        backend.pubsub.publish.restore();
        expect(publishedPresenceVersions).to.have.members([queuedLeave, unsubscribeLeave]);
        next();
      }
    ], done);
  });

  it('drains a long queue of untyped leaves with the same id in order without recursing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, errorHandler(done));
    var untypedLeavesToOverflowTheStack = 3000;
    var leavePresenceVersions = [];
    for (var pv = 1; pv <= untypedLeavesToOverflowTheStack + 1; pv++) leavePresenceVersions.push(pv);
    var untypedLeavePresenceVersions = leavePresenceVersions.slice(1);
    var publishedPresenceVersions = [];

    async.series([
      leave.submit,
      function(next) {
        var leavesThroughMiddleware = 0;
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          callback();
          if (++leavesThroughMiddleware === untypedLeavePresenceVersions.length) next();
        });
        untypedLeavePresenceVersions.forEach(function(pv) {
          connection1.send({a: 'p', ch: 'books.northern-lights', id: 'presence-1', p: null, pv: pv});
        });
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          publish.apply(backend.pubsub, arguments);
          publishedPresenceVersions.push(data.pv);
          if (publishedPresenceVersions.length < leavePresenceVersions.length) return;
          backend.pubsub.publish.restore();
          next();
        });
        leave.release();
      },
      function(next) {
        expect(publishedPresenceVersions).to.eql(leavePresenceVersions);
        next();
      }
    ], done);
  });

  it('broadcasts leaves with the same id in the order they arrive', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var leave = leaveWithHeldTransform(localPresence1, errorHandler(done));
    var transformingLeave = 1;
    var earlierArrivingLeave = 2;
    var laterArrivingLeave = 3;
    var recreation = 0;
    var expectedOrder = [transformingLeave, earlierArrivingLeave, laterArrivingLeave, recreation];
    var releaseEarlierArrivingLeave;
    var publishedPresenceVersions = [];

    async.series([
      leave.submit,
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (context.presence.pv !== earlierArrivingLeave) return callback();
          releaseEarlierArrivingLeave = callback;
        });
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          callback();
          if (context.presence.pv === laterArrivingLeave) next();
        });
        sendPresence(localPresence1, {p: null, pv: earlierArrivingLeave, v: doc1.version});
        sendPresence(localPresence1, {p: null, pv: laterArrivingLeave, v: doc1.version});
      },
      function(next) {
        releaseEarlierArrivingLeave();
        onPresenceThroughMiddleware(2, next);
        sendPresence(localPresence1, {p: {index: 2}, pv: recreation});
      },
      function(next) {
        var publish = backend.pubsub.publish;
        sinon.stub(backend.pubsub, 'publish').callsFake(function(channels, data) {
          publish.apply(backend.pubsub, arguments);
          publishedPresenceVersions.push(data.pv);
          if (publishedPresenceVersions.length < expectedOrder.length) return;
          backend.pubsub.publish.restore();
          next();
        });
        leave.release();
      },
      function(next) {
        expect(publishedPresenceVersions).to.eql(expectedOrder);
        next();
      }
    ], done);
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

  it('rejects a presence message for a different doc than its channel', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      expect(error.message).to.equal('Presence collection and doc ID do not match channel');
      done();
    });

    var message = localPresence1._message();
    message.d = 'subtle-knife';
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with a doc ID but no collection', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.c = null;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with a collection but no doc ID', function(done) {
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.d = null;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with an empty collection', function(done) {
    var localPresence1 = connection1.getDocPresence('', 'northern-lights').create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with an empty doc ID', function(done) {
    var localPresence1 = connection1.getDocPresence('books', '').create('presence-1');
    localPresence1.on('error', function(error) {
      expect(error.code).to.eql('ERR_MESSAGE_BADLY_FORMED');
      done();
    });

    var message = localPresence1._message();
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects presence on a doc the client cannot read', function(done) {
    backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(context, next) {
      next(new Error('Forbidden'));
    });

    var localPresence1 = presence1.create('presence-1');
    localPresence1.submit({index: 1}, function(error) {
      expect(error.message).to.equal('Forbidden');
      done();
    });
  });

  it('clears presence when a client that has lost read access disconnects', function(done) {
    var agent1 = connection1.agent;
    var canRead = true;
    [backend.MIDDLEWARE_ACTIONS.readSnapshots, backend.MIDDLEWARE_ACTIONS.op].forEach(function(action) {
      backend.use(action, function(context, next) {
        if (canRead || context.agent !== agent1) return next();
        next(new Error('Forbidden'));
      });
    });
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        doc2.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc1.once('op', function() {
          next();
        });
      },
      function(next) {
        canRead = false;
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
        connection1.close();
      }
    ], done);
  });

  it('ignores untyped presence on its channel', function(done) {
    var connection3 = backend.connect();
    var untypedPresence3 = connection3.getPresence('books.northern-lights');
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      untypedPresence3.subscribe.bind(untypedPresence3),
      function(next) {
        connection2.on('receive', function(request) {
          if (request.data.src !== connection3.id) return;
          localPresence1.submit({index: 1}, errorHandler(done));
        });
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 1});
          next();
        });
        connection3.send({
          a: 'p', ch: 'books.northern-lights', id: 'presence-1', p: {index: 9}, pv: 0, v: doc1.version
        });
      }
    ], done);
  });

  it('does not let untyped presence with the same ID ack its local presence', function(done) {
    var connection3 = backend.connect();
    var untypedPresence3 = connection3.getPresence('books.northern-lights');
    var localPresence1 = presence1.create('presence-1');
    var hasReceivedOwnPresence = false;

    async.series([
      presence1.subscribe.bind(presence1),
      untypedPresence3.subscribe.bind(untypedPresence3),
      function(next) {
        connection1.on('receive', function(request) {
          if (request.data.src === connection1.id) hasReceivedOwnPresence = true;
          if (request.data.src !== connection3.id) return;
          localPresence1.submit({index: 1}, function(error) {
            if (error) return done(error);
            expect(hasReceivedOwnPresence).to.be.true;
            next();
          });
        });
        connection3.send({
          a: 'p', ch: 'books.northern-lights', id: 'presence-1', p: {index: 9}, pv: 0, v: doc1.version
        });
      }
    ], done);
  });

  it('does not let typed presence from another client with the same ID ack its local presence', function(done) {
    var connection3 = backend.connect();
    var presence3 = connection3.getDocPresence('books', 'northern-lights');
    var localPresence1 = presence1.create('presence-1');
    var hasReceivedOwnPresence = false;

    async.series([
      presence1.subscribe.bind(presence1),
      presence3.subscribe.bind(presence3),
      function(next) {
        connection1.on('receive', function(request) {
          if (request.data.src === connection1.id) hasReceivedOwnPresence = true;
          if (request.data.src !== connection3.id) return;
          localPresence1.submit({index: 1}, function(error) {
            if (error) return done(error);
            expect(hasReceivedOwnPresence).to.be.true;
            next();
          });
        });
        connection3.send({
          a: 'p',
          ch: 'books.northern-lights',
          c: 'books',
          d: 'northern-lights',
          t: presenceTestType.type.uri,
          id: 'presence-1',
          p: {index: 9},
          pv: 0,
          v: doc1.version
        });
      }
    ], done);
  });

  it('emits a forwarded error for a presence with the same ID on the presence, not its local presence', function(done) {
    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(context, next) {
      next(new Error('uh-oh!'));
    });

    var connection3 = backend.connect();
    var doc3 = connection3.get('books', 'northern-lights');
    var localPresence3 = connection3.getDocPresence('books', 'northern-lights').create('presence-1');
    var localPresence1 = presence1.create('presence-1');
    localPresence1.on('error', done);

    async.series([
      doc3.subscribe.bind(doc3),
      presence1.subscribe.bind(presence1),
      function(next) {
        presence1.once('error', function(error) {
          expect(error.message).to.equal('uh-oh!');
          next();
        });
        localPresence3.submit({index: 1}, errorHandler(done));
      }
    ], done);
  });

  it('ignores presence for a doc whose collection and id join to the same channel', function(done) {
    var connection3 = backend.connect();
    var notesDoc1 = connection1.get('notes', 'private.alice');
    var notesDoc3 = connection3.get('notes', 'private.alice');
    var diaryDoc2 = connection2.get('notes.private', 'alice');
    var localNotesPresence1 = connection1.getDocPresence('notes', 'private.alice').create('notes-presence');
    var localDiaryPresence2 = connection2.getDocPresence('notes.private', 'alice').create('diary-presence');
    var notesPresence3 = connection3.getDocPresence('notes', 'private.alice');

    async.series([
      notesDoc1.create.bind(notesDoc1, 'Hello', presenceTestType.type.name),
      diaryDoc2.create.bind(diaryDoc2, 'Dear diary', presenceTestType.type.name),
      notesDoc3.subscribe.bind(notesDoc3),
      notesPresence3.subscribe.bind(notesPresence3),
      function(next) {
        notesPresence3.once('receive', function(id) {
          expect(id).to.equal('notes-presence');
          next();
        });
        localDiaryPresence2.submit({index: 1}, function(error) {
          if (error) return done(error);
          localNotesPresence1.submit({index: 1}, errorHandler(done));
        });
      }
    ], done);
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

  it('does not keep presence when fetching its doc version fails', function(done) {
    var localPresence1 = presence1.create('presence-1');

    backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(context, next) {
      next(new Error('denied'));
    });

    localPresence1.submit({index: 1}, function(error) {
      expect(error.message).to.contain('denied');
      expect(connection1.agent.presenceRequests).to.be.empty;
      expect(connection1.agent._pendingPresenceBroadcasts).to.be.empty;
      done();
    });
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


  it('errors local presence when doc is in hard rollback', function(done) {
    var localPresence1 = presence1.create('presence-1');

    doc1.on('error', function(error) {
      expect(error).to.be.equal('some error');
    });
    doc1._hardRollback('some error');
    localPresence1.submit({index: 1}, function(error) {
      expect(error.code).to.be.equal('ERR_DOC_IN_HARD_ROLLBACK');
      done();
    });
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

  it('emits an error and drops stale remote presence that cannot be transformed', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var catchUpCount = 0;

    function receiveUntransformablePresenceAtVersion(version) {
      connection2.handleMessage({
        a: ACTIONS.presence,
        ch: 'books.northern-lights',
        src: connection1.id,
        id: 'presence-1',
        p: {index: 0},
        pv: version,
        c: 'books',
        d: 'northern-lights',
        v: version,
        t: null
      });
    }

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        connection2.on('send', function(message) {
          if (message.a !== ACTIONS.presenceRequest) return;
          catchUpCount++;
          if (catchUpCount === 1) next();
        });
        receiveUntransformablePresenceAtVersion(0);
      },
      function(next) {
        doc2.once('op', function() {
          next();
        });
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      },
      function(next) {
        presence2.once('error', function(error) {
          expect(error).to.be.an.instanceOf(Error);
          expect(error.code).to.equal('ERR_DOC_TYPE_NOT_RECOGNIZED');
          next();
        });
        receiveUntransformablePresenceAtVersion(1);
      },
      function(next) {
        doc2.once('op', function() {
          next();
        });
        doc1.submitOp({index: 0, value: 'The'}, errorHandler(done));
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 1});
          expect(catchUpCount).to.equal(1);
          next();
        });
        localPresence1.submit({index: 1}, errorHandler(done));
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

  it('releases the doc version stream of presence in flight when unsubscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var streamsCount;

    backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, next) {
      if (context.presence.p === null) return next();
      presence1.unsubscribe(function(error) {
        if (error) return done(error);
        next();
      });
    });

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        streamsCount = backend.pubsub.streamsCount;
        next();
      },
      presence1.subscribe.bind(presence1),
      function(next) {
        async.parallel([
          function(cb) {
            presence2.once('receive', function(id, presence) {
              expect(id).to.equal('presence-1');
              expect(presence).to.be.null;
              cb();
            });
          },
          function(cb) {
            localPresence1.submit({index: 1}, cb);
          }
        ], next);
      },
      function(next) {
        expect(backend.pubsub.streamsCount).to.equal(streamsCount);
        next();
      }
    ], done);
  });

  it('releases the doc version stream of presence transformed across a delete when unsubscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence1.subscribe.bind(presence1),
      doc1.unsubscribe.bind(doc1),
      doc2.del.bind(doc2),
      localPresence1.submit.bind(localPresence1, {index: 1}),
      function(next) {
        expect(connection1.agent.presenceRequests['books.northern-lights']['presence-1'].p).to.be.null;
        expect(connection1.agent.latestDocVersionStreams).not.to.be.empty;
        presence1.unsubscribe(next);
      },
      function(next) {
        expect(connection1.agent.latestDocVersions).to.be.empty;
        expect(connection1.agent.latestDocVersionStreams).to.be.empty;
        next();
      }
    ], done);
  });

  it('releases the doc version stream of presence that failed to transform when unsubscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence1.create('presence-2');

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          expect(connection1.agent.latestDocVersionStreams).not.to.be.empty;
          presence1.unsubscribe(next);
        });
      },
      function(next) {
        expect(connection1.agent.latestDocVersions).to.be.empty;
        expect(connection1.agent.latestDocVersionStreams).to.be.empty;
        localPresence2.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id) {
          expect(id).to.equal('presence-2');
          next();
        });
      }
    ], done);
  });

  it('releases the doc version stream of presence that fails to transform after unsubscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseTransform;
    var onFailed;

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseTransform || context.agent !== connection1.agent) return callback();
          releaseTransform = callback;
          next();
        });
        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          onFailed();
        });
      },
      function(next) {
        presence1.unsubscribe(next);
      },
      function(next) {
        onFailed = function() {
          expect(connection1.agent.latestDocVersions).to.be.empty;
          expect(connection1.agent.latestDocVersionStreams).to.be.empty;
          expect(connection1.agent.presenceRequests).to.be.empty;
          next();
        };
        releaseTransform();
      }
    ], done);
  });

  it('does not broadcast an older presence that finishes transforming after its client unsubscribes', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence1.create('presence-2');
    var releaseFirstTransform;

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseFirstTransform || context.agent !== connection1.agent) return callback();
          releaseFirstTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, errorHandler(done));
      },
      function(next) {
        localPresence1.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 2});
          next();
        });
      },
      function(next) {
        presence1.unsubscribe(errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.be.null;
          next();
        });
      },
      function(next) {
        releaseFirstTransform();
        localPresence2.submit({index: 3}, errorHandler(done));
        presence2.once('receive', function(id) {
          expect(id).to.equal('presence-2');
          next();
        });
      },
      function(next) {
        expect(presence2.remotePresences).to.have.all.keys('presence-2');
        next();
      }
    ], done);
  });

  it('broadcasts an older presence still transforming when a newer one fails to transform', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseFirstTransform;

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseFirstTransform || context.agent !== connection1.agent) return callback();
          releaseFirstTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, errorHandler(done));
      },
      function(next) {
        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          next();
        });
      },
      function(next) {
        releaseFirstTransform();
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('broadcasts an older presence already transformed when a newer one fails to transform', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseTransforms = [];
    var onNewerPresenceFailed;

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (context.agent !== connection1.agent) return callback();
          releaseTransforms.push(callback);
          if (releaseTransforms.length === 2) next();
        });
        localPresence1.submit({index: 12}, errorHandler(done));
        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          onNewerPresenceFailed();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 15});
          next();
        });
        releaseTransforms[0]();
      },
      function(next) {
        onNewerPresenceFailed = next;
        releaseTransforms[1]();
      }
    ], done);
  });

  it('does not broadcast an older presence still transforming once a newer one is broadcast', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseOlderTransform;
    var onOlderPresenceAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseOlderTransform || context.agent !== connection1.agent) return callback();
          releaseOlderTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, function(error) {
          if (error) return done(error);
          onOlderPresenceAcked();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 2});
          next();
        });
        localPresence1.submit({index: 2}, errorHandler(done));
      },
      function(next) {
        var publish = sinon.spy(backend.pubsub, 'publish');
        onOlderPresenceAcked = function() {
          expect(publish.called).to.be.false;
          expect(connection1.agent.latestDocVersionStreams[doc1.collection][doc1.id]).to.be.ok;
          next();
        };
        releaseOlderTransform();
      }
    ], done);
  });

  it('does not broadcast an older presence still transforming once a newer one is broadcast as null', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseOlderTransform;
    var onOlderPresenceAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (context.presence.pv === 1) context.presence.p = null;
          callback();
        });
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseOlderTransform || context.agent !== connection1.agent) return callback();
          releaseOlderTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, function(error) {
          if (error) return done(error);
          onOlderPresenceAcked();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
        localPresence1.submit({index: 2}, errorHandler(done));
      },
      function(next) {
        var publish = sinon.spy(backend.pubsub, 'publish');
        onOlderPresenceAcked = function() {
          expect(publish.called).to.be.false;
          expect(connection1.agent.latestDocVersions).to.be.empty;
          next();
        };
        releaseOlderTransform();
      }
    ], done);
  });

  it('keeps the doc version for other live presence when dropping an older presence', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence3 = presence1.create('presence-3');
    var releaseOlderTransform;
    var onOlderPresenceAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        presence2.once('receive', function(id) {
          expect(id).to.equal('presence-3');
          next();
        });
        localPresence3.submit({index: 0}, errorHandler(done));
      },
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          var presence = context.presence;
          if (presence.id === 'presence-1' && presence.pv === 1) presence.p = null;
          callback();
        });
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseOlderTransform || context.agent !== connection1.agent) return callback();
          releaseOlderTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, function(error) {
          if (error) return done(error);
          onOlderPresenceAcked();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
        localPresence1.submit({index: 2}, errorHandler(done));
      },
      function(next) {
        onOlderPresenceAcked = function() {
          expect(connection1.agent.latestDocVersionStreams[doc1.collection][doc1.id]).to.be.ok;
          next();
        };
        releaseOlderTransform();
      }
    ], done);
  });

  it('releases the doc version when dropping an older presence beside untyped presence', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseOlderTransform;
    var onOlderPresenceAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        connection2.on('receive', function onUntypedPresence(request) {
          if (request.data.id !== 'untyped') return;
          connection2.removeListener('receive', onUntypedPresence);
          next();
        });
        connection1.send({
          a: 'p', ch: 'books.northern-lights', id: 'untyped', p: {index: 9}, pv: 0, v: doc1.version
        });
      },
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          var presence = context.presence;
          if (presence.id === 'presence-1' && presence.pv === 1) presence.p = null;
          callback();
        });
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseOlderTransform || context.agent !== connection1.agent) return callback();
          releaseOlderTransform = callback;
          next();
        });
        localPresence1.submit({index: 1}, function(error) {
          if (error) return done(error);
          onOlderPresenceAcked();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
        localPresence1.submit({index: 2}, errorHandler(done));
      },
      function(next) {
        onOlderPresenceAcked = function() {
          expect(connection1.agent.latestDocVersions).to.be.empty;
          next();
        };
        releaseOlderTransform();
      }
    ], done);
  });

  it('releases the doc version when dropping an older presence while another presence is leaving', function(done) {
    var localLeavingPresence = presence1.create('leaving-presence');
    var localDroppedPresence = presence1.create('dropped-presence');
    var releaseLeave;
    var releaseSubscribe;
    var onLeaveHeld;
    var onUpdateAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        presence2.once('receive', function(id) {
          expect(id).to.equal('leaving-presence');
          next();
        });
        localLeavingPresence.submit({index: 0}, errorHandler(done));
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          var presence = context.presence;
          if (releaseLeave || presence.id !== 'leaving-presence' || presence.p !== null) return callback();
          releaseLeave = callback;
          onLeaveHeld();
        });
        onLeaveHeld = next;
        localLeavingPresence.submit(null, errorHandler(done));
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(context, callback) {
          if (releaseSubscribe || context.agent !== connection1.agent) return callback();
          releaseSubscribe = callback;
          next();
        });
        localDroppedPresence.submit({index: 1}, function(error) {
          if (error) return done(error);
          onUpdateAcked();
        });
      },
      function(next) {
        localDroppedPresence.submit(null, next);
      },
      function(next) {
        onUpdateAcked = function() {
          expect(connection1.agent.latestDocVersions).to.be.empty;
          next();
        };
        releaseSubscribe();
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('leaving-presence');
          expect(presence).to.be.null;
          next();
        });
        releaseLeave();
      }
    ], done);
  });

  it('keeps the doc version for re-created presence when dropping its leave from before unsubscribing', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseLeave;
    var releaseSentinel;
    var onHeld;

    backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, next) {
      var presence = context.presence;
      var isClientLeave = presence.id === 'presence-1' && presence.p === null && !releaseLeave;
      var isSentinel = presence.id === 'presence-2' && !releaseSentinel;
      if (isClientLeave) releaseLeave = next;
      else if (isSentinel) releaseSentinel = next;
      else return next();
      onHeld();
    });

    async.series([
      presence1.subscribe.bind(presence1),
      presence2.subscribe.bind(presence2),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 1});
          next();
        });
      },
      function(next) {
        onHeld = next;
        localPresence1.submit(null, errorHandler(done));
      },
      function(next) {
        presence1.unsubscribe(errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.be.null;
          next();
        });
      },
      function(next) {
        presence1.create('presence-1').submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(presence).to.eql({index: 2});
          next();
        });
      },
      function(next) {
        onHeld = next;
        presence1.create('presence-2').submit({index: 3}, errorHandler(done));
      },
      function(next) {
        releaseLeave();
        releaseSentinel();
        presence2.once('receive', function(id) {
          expect(id).to.equal('presence-2');
          expect(connection1.agent.latestDocVersionStreams[doc1.collection][doc1.id]).to.be.ok;
          next();
        });
      }
    ], done);
  });

  it('does not broadcast an older presence that reaches the agent after a newer one is broadcast', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseOlderPresence;
    var onOlderPresenceAcked;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receive, function(context, callback) {
          var isOlderPresence = context.agent === connection1.agent &&
            context.data.a === ACTIONS.presence &&
            context.data.pv === 0;
          if (releaseOlderPresence || !isOlderPresence) return callback();
          releaseOlderPresence = callback;
          process.nextTick(next);
        });
        localPresence1.submit({index: 1}, function(error) {
          if (error) return done(error);
          onOlderPresenceAcked();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 2});
          next();
        });
        localPresence1.submit({index: 2}, errorHandler(done));
      },
      function(next) {
        var publish = sinon.spy(backend.pubsub, 'publish');
        onOlderPresenceAcked = function() {
          expect(publish.called).to.be.false;
          next();
        };
        releaseOlderPresence();
      }
    ], done);
  });

  it('clears an older presence on disconnect when it overtook a newer one that failed to transform', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releaseOlderPresence;
    var releaseNewerTransform;
    var onNewerPresenceFailed;

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (releaseOlderPresence || context.presence.pv !== 0) return callback();
          releaseOlderPresence = callback;
        });
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (releaseNewerTransform || context.agent !== connection1.agent) return callback();
          releaseNewerTransform = callback;
          next();
        });
        localPresence1.submit({index: 12}, errorHandler(done));
        localPresence1.submit({badProp: 'foo'}, function(error) {
          expect(error.code).to.equal('ERR_PRESENCE_TRANSFORM_FAILED');
          onNewerPresenceFailed();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 15});
          next();
        });
        releaseOlderPresence();
      },
      function(next) {
        onNewerPresenceFailed = next;
        releaseNewerTransform();
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

  it('broadcasts presence in flight when its leave fails to read the doc version', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var releasePresence;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.receivePresence, function(context, callback) {
          if (context.presence.p === null || releasePresence) return callback();
          releasePresence = callback;
          next();
        });
        localPresence1.submit({index: 1}, errorHandler(done));
      },
      function(next) {
        var getSnapshot = sinon.stub(backend.db, 'getSnapshot').callThrough();
        getSnapshot.onFirstCall().callsArgWithAsync(4, new Error('bad!'));
        localPresence1.submit(null, function(error) {
          expect(error.message).to.equal('bad!');
          next();
        });
      },
      function(next) {
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.eql({index: 1});
          next();
        });
        releasePresence();
      }
    ], done);
  });

  it('broadcasts a null presence still being transformed when the connection closes', function(done) {
    var localPresence1 = presence1.create('presence-1');

    async.series([
      presence2.subscribe.bind(presence2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        localPresence1.submit({index: 1}, errorHandler(done));
        presence2.once('receive', function() {
          next();
        });
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.op, function(context, callback) {
          if (context.agent !== connection1.agent) return callback();
          connection1.agent.stream.once('end', function() {
            callback();
          });
          connection1.close();
        });
        localPresence1.submit(null, errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
      }
    ], done);
  });

  it('does not broadcast presence still looking up its doc version when it is destroyed', function(done) {
    var localPresence1 = presence1.create('presence-1');
    var localPresence2 = presence1.create('presence-2');
    var releaseDocVersion;

    async.series([
      presence2.subscribe.bind(presence2),
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(context, callback) {
          if (releaseDocVersion || context.agent !== connection1.agent) return callback();
          releaseDocVersion = callback;
          next();
        });
        localPresence1.submit({index: 1}, errorHandler(done));
      },
      function(next) {
        localPresence1.destroy(errorHandler(done));
        presence2.once('receive', function(id, presence) {
          expect(id).to.equal('presence-1');
          expect(presence).to.be.null;
          next();
        });
      },
      function(next) {
        connection1.once('receive', function(request) {
          expect(request.data).to.include({id: 'presence-1', pv: 0});
          expect(connection1.agent.latestDocVersions).to.be.empty;
          expect(connection1.agent.latestDocVersionStreams).to.be.empty;
          next();
        });
        releaseDocVersion();
      },
      function(next) {
        localPresence2.submit({index: 2}, errorHandler(done));
        presence2.once('receive', function(id) {
          expect(id).to.equal('presence-2');
          next();
        });
      },
      function(next) {
        expect(presence2.remotePresences).to.have.all.keys('presence-2');
        next();
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
