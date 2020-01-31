var Backend = require('../../lib/backend');
var expect = require('chai').expect;
var MemoryDb = require('../../lib/db/memory');
var MemoryMilestoneDb = require('../../lib/milestone-db/memory');
var sinon = require('sinon');
var async = require('async');

describe('SnapshotVersionRequest', function() {
  var backend;

  beforeEach(function() {
    backend = new Backend();
  });

  afterEach(function(done) {
    backend.close(done);
  });

  describe('a document with some simple versions', function() {
    var v0 = {
      id: 'don-quixote',
      v: 0,
      type: null,
      data: undefined,
      m: null
    };

    var v1 = {
      id: 'don-quixote',
      v: 1,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'Don Quixote'
      },
      m: null
    };

    var v2 = {
      id: 'don-quixote',
      v: 2,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervante'
      },
      m: null
    };

    var v3 = {
      id: 'don-quixote',
      v: 3,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervantes'
      },
      m: null
    };

    beforeEach(function(done) {
      var doc = backend.connect().get('books', 'don-quixote');
      doc.create({title: 'Don Quixote'}, function(error) {
        if (error) return done(error);
        doc.submitOp({p: ['author'], oi: 'Miguel de Cervante'}, function(error) {
          if (error) return done(error);
          doc.submitOp({p: ['author'], od: 'Miguel de Cervante', oi: 'Miguel de Cervantes'}, done);
        });
      });
    });

    it('fetches v1', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', 1, function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql(v1);
        done();
      });
    });

    it('fetches v2', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', 2, function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('fetches v3', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', 3, function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql(v3);
        done();
      });
    });

    it('returns an empty snapshot if the version is 0', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', 0, function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql(v0);
        done();
      });
    });

    it('throws if the version is undefined', function() {
      var fetch = function() {
        backend.connect().fetchSnapshot('books', 'don-quixote', undefined, function() {});
      };

      expect(fetch).to.throw(Error);
    });

    it('fetches the latest version when the optional version is not provided', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql(v3);
        done();
      });
    });

    it('throws without a callback', function() {
      var fetch = function() {
        backend.connect().fetchSnapshot('books', 'don-quixote');
      };

      expect(fetch).to.throw(Error);
    });

    it('throws if the version is -1', function() {
      var fetch = function() {
        backend.connect().fetchSnapshot('books', 'don-quixote', -1, function() {});
      };

      expect(fetch).to.throw(Error);
    });

    it('errors if the version is a string', function() {
      var fetch = function() {
        backend.connect().fetchSnapshot('books', 'don-quixote', 'foo', function() { });
      };

      expect(fetch).to.throw(Error);
    });

    it('errors if asking for a version that does not exist', function(done) {
      backend.connect().fetchSnapshot('books', 'don-quixote', 4, function(error, snapshot) {
        expect(error.code).to.equal('ERR_OP_VERSION_NEWER_THAN_CURRENT_SNAPSHOT');
        expect(snapshot).to.equal(undefined);
        done();
      });
    });

    it('returns an empty snapshot if trying to fetch a non-existent document', function(done) {
      backend.connect().fetchSnapshot('books', 'does-not-exist', 0, function(error, snapshot) {
        if (error) return done(error);
        expect(snapshot).to.eql({
          id: 'does-not-exist',
          v: 0,
          type: null,
          data: undefined,
          m: null
        });
        done();
      });
    });

    it('starts pending, and finishes not pending', function(done) {
      var connection = backend.connect();

      connection.fetchSnapshot('books', 'don-quixote', null, function(error) {
        if (error) return done(error);
        expect(connection.hasPending()).to.equal(false);
        done();
      });

      expect(connection.hasPending()).to.equal(true);
    });

    it('deletes the request from the connection', function(done) {
      var connection = backend.connect();

      connection.fetchSnapshot('books', 'don-quixote', function(error) {
        if (error) return done(error);
        expect(connection._snapshotRequests).to.eql({});
        done();
      });

      expect(connection._snapshotRequests).to.not.eql({});
    });

    it('emits a ready event when done', function(done) {
      var connection = backend.connect();

      connection.fetchSnapshot('books', 'don-quixote', function(error) {
        if (error) return done(error);
      });

      var snapshotRequest = connection._snapshotRequests[1];
      snapshotRequest.on('ready', done);
    });

    it('fires the connection.whenNothingPending', function(done) {
      var connection = backend.connect();
      var snapshotFetched = false;

      connection.fetchSnapshot('books', 'don-quixote', function(error) {
        if (error) return done(error);
        snapshotFetched = true;
      });

      connection.whenNothingPending(function() {
        expect(snapshotFetched).to.equal(true);
        done();
      });
    });

    it('can drop its connection and reconnect, and the callback is just called once', function(done) {
      var connection = backend.connect();

      // Here we hook into middleware to make sure that we get the following flow:
      // - Connection established
      // - Connection attempts to fetch a snapshot
      // - Snapshot is about to be returned
      // - Connection is dropped before the snapshot is returned
      // - Connection is re-established
      // - Connection re-requests the snapshot
      // - This time the fetch operation is allowed to complete (because of the connectionInterrupted flag)
      // - The done callback is called just once (if it's called twice, then mocha will complain)
      var connectionInterrupted = false;
      backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(request, callback) {
        if (!connectionInterrupted) {
          connection.close();
          backend.connect(connection);
          connectionInterrupted = true;
        }

        callback();
      });

      connection.fetchSnapshot('books', 'don-quixote', done);
    });

    it('cannot send the same request twice over a connection', function(done) {
      var connection = backend.connect();

      // Here we hook into the middleware to make sure that we get the following flow:
      // - Attempt to fetch a snapshot
      // - The snapshot request is temporarily stored on the Connection
      // - Snapshot is about to be returned (ie the request was already successfully sent)
      // - We attempt to resend the request again
      // - The done callback is call just once, because the second request does not get sent
      //   (if the done callback is called twice, then mocha will complain)
      var hasResent = false;
      backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots, function(request, callback) {
        if (!hasResent) {
          connection._snapshotRequests[1]._onConnectionStateChanged();
          hasResent = true;
        }

        callback();
      });

      connection.fetchSnapshot('books', 'don-quixote', done);
    });

    describe('readSnapshots middleware', function() {
      it('triggers the middleware', function(done) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots,
          function(request) {
            expect(request.snapshots[0]).to.eql(v3);
            expect(request.snapshotType).to.equal(backend.SNAPSHOT_TYPES.byVersion);
            done();
          }
        );

        backend.connect().fetchSnapshot('books', 'don-quixote', 3, function() { });
      });

      it('can have its snapshot manipulated in the middleware', function(done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function(request, callback) {
            request.snapshots[0].data.title = 'Alice in Wonderland';
            callback();
          }
        ];

        backend.connect().fetchSnapshot('books', 'don-quixote', function(error, snapshot) {
          if (error) return done(error);
          expect(snapshot.data.title).to.equal('Alice in Wonderland');
          done();
        });
      });

      it('respects errors thrown in the middleware', function(done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function(request, callback) {
            callback({message: 'foo'});
          }
        ];

        backend.connect().fetchSnapshot('books', 'don-quixote', 0, function(error) {
          expect(error.message).to.equal('foo');
          done();
        });
      });
    });

    describe('with a registered projection', function() {
      beforeEach(function() {
        backend.addProjection('bookTitles', 'books', {title: true});
      });

      it('applies the projection to a snapshot', function(done) {
        backend.connect().fetchSnapshot('bookTitles', 'don-quixote', 2, function(error, snapshot) {
          if (error) return done(error);

          expect(snapshot.data.title).to.equal('Don Quixote');
          expect(snapshot.data.author).to.equal(undefined);
          done();
        });
      });
    });
  });

  describe('a document that is currently deleted', function() {
    beforeEach(function(done) {
      var doc = backend.connect().get('books', 'catch-22');
      doc.create({title: 'Catch 22'}, function(error) {
        if (error) return done(error);
        doc.del(function(error) {
          done(error);
        });
      });
    });

    it('returns a null type', function(done) {
      backend.connect().fetchSnapshot('books', 'catch-22', null, function(error, snapshot) {
        expect(snapshot).to.eql({
          id: 'catch-22',
          v: 2,
          type: null,
          data: undefined,
          m: null
        });

        done();
      });
    });

    it('fetches v1', function(done) {
      backend.connect().fetchSnapshot('books', 'catch-22', 1, function(error, snapshot) {
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'catch-22',
          v: 1,
          type: 'http://sharejs.org/types/JSONv0',
          data: {
            title: 'Catch 22'
          },
          m: null
        });

        done();
      });
    });
  });

  describe('a document that was deleted and then created again', function() {
    beforeEach(function(done) {
      var doc = backend.connect().get('books', 'hitchhikers-guide');
      doc.create({title: 'Hitchhiker\'s Guide to the Galaxy'}, function(error) {
        if (error) return done(error);
        doc.del(function(error) {
          if (error) return done(error);
          doc.create({title: 'The Restaurant at the End of the Universe'}, function(error) {
            done(error);
          });
        });
      });
    });

    it('fetches the latest version of the document', function(done) {
      backend.connect().fetchSnapshot('books', 'hitchhikers-guide', null, function(error, snapshot) {
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'hitchhikers-guide',
          v: 3,
          type: 'http://sharejs.org/types/JSONv0',
          data: {
            title: 'The Restaurant at the End of the Universe'
          },
          m: null
        });

        done();
      });
    });
  });

  describe('milestone snapshots enabled for every other version', function() {
    var milestoneDb;
    var db;
    var backendWithMilestones;

    beforeEach(function() {
      var options = {interval: 2};
      db = new MemoryDb();
      milestoneDb = new MemoryMilestoneDb(options);
      backendWithMilestones = new Backend({
        db: db,
        milestoneDb: milestoneDb
      });
    });

    afterEach(function(done) {
      backendWithMilestones.close(done);
    });

    it('fetches a snapshot using the milestone', function(done) {
      var doc = backendWithMilestones.connect().get('books', 'mocking-bird');

      async.waterfall([
        doc.create.bind(doc, {title: 'To Kill a Mocking Bird'}),
        doc.submitOp.bind(doc, {p: ['author'], oi: 'Harper Lea'}),
        doc.submitOp.bind(doc, {p: ['author'], od: 'Harper Lea', oi: 'Harper Lee'}),
        function(next) {
          sinon.spy(milestoneDb, 'getMilestoneSnapshot');
          sinon.spy(db, 'getOps');
          backendWithMilestones.connect().fetchSnapshot('books', 'mocking-bird', 3, next);
        },
        function(snapshot, next) {
          expect(milestoneDb.getMilestoneSnapshot.calledOnce).to.equal(true);
          expect(db.getOps.calledWith('books', 'mocking-bird', 2, 3)).to.equal(true);
          expect(snapshot.v).to.equal(3);
          expect(snapshot.data).to.eql({title: 'To Kill a Mocking Bird', author: 'Harper Lee'});
          next();
        }
      ], done);
    });
  });
});
