var Backend = require('../../lib/backend');
var expect = require('chai').expect;
var MemoryDb = require('../../lib/db/memory');
var MemoryMilestoneDb = require('../../lib/milestone-db/memory');
var sinon = require('sinon');
var async = require('async');

describe('SnapshotTimestampRequest', function() {
  var backend;
  var clock;
  var day0 = new Date(2017, 11, 31).getTime();
  var day1 = new Date(2018, 0, 1).getTime();
  var day2 = new Date(2018, 0, 2).getTime();
  var day3 = new Date(2018, 0, 3).getTime();
  var day4 = new Date(2018, 0, 4).getTime();
  var day5 = new Date(2018, 0, 5).getTime();
  var ONE_DAY = 1000 * 60 * 60 * 24;

  beforeEach(function() {
    clock = sinon.useFakeTimers(day1);
    backend = new Backend();
  });

  afterEach(function(done) {
    clock.uninstall();
    backend.close(done);
  });

  describe('a document with some simple versions separated by a day', function() {
    var v0 = {
      id: 'time-machine',
      v: 0,
      type: null,
      data: undefined,
      m: null
    };

    var v1 = {
      id: 'time-machine',
      v: 1,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'The Time Machine'
      },
      m: null
    };

    var v2 = {
      id: 'time-machine',
      v: 2,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'The Time Machine',
        author: 'HG Wells'
      },
      m: null
    };

    var v3 = {
      id: 'time-machine',
      v: 3,
      type: 'http://sharejs.org/types/JSONv0',
      data: {
        title: 'The Time Machine',
        author: 'H.G. Wells'
      },
      m: null
    };

    beforeEach(function(done) {
      var doc = backend.connect().get('books', 'time-machine');
      async.series([
        doc.create.bind(doc, {title: 'The Time Machine'}),
        function(next) {
          clock.tick(ONE_DAY);
          doc.submitOp({p: ['author'], oi: 'HG Wells'}, next);
        },
        function(next) {
          clock.tick(ONE_DAY);
          doc.submitOp({p: ['author'], od: 'HG Wells', oi: 'H.G. Wells'}, next);
        }
      ], done);
    });

    it('fetches the version at exactly day 1', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', day1),
        function(snapshot, next) {
          expect(snapshot).to.eql(v1);
          next();
        }
      ], done);
    });

    it('fetches the version at exactly day 2', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', day2),
        function(snapshot, next) {
          expect(snapshot).to.eql(v2);
          next();
        }
      ], done);
    });

    it('fetches the version at exactly day 3', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', day3),
        function(snapshot, next) {
          expect(snapshot).to.eql(v3);
          next();
        }
      ], done);
    });

    it('fetches the day 2 version when asking for a time halfway between days 2 and 3', function(done) {
      var halfwayBetweenDays2and3 = (day2 + day3) * 0.5;
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', halfwayBetweenDays2and3),
        function(snapshot, next) {
          expect(snapshot).to.eql(v2);
          next();
        }
      ], done);
    });

    it('fetches the day 3 version when asking for a time after day 3', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', day4),
        function(snapshot, next) {
          expect(snapshot).to.eql(v3);
          next();
        }
      ], done);
    });

    it('fetches the most recent version when not specifying a timestamp', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine'),
        function(snapshot, next) {
          expect(snapshot).to.eql(v3);
          next();
        }
      ], done);
    });

    it('fetches an empty snapshot if the timestamp is before the document creation', function(done) {
      var connection = backend.connect();
      async.waterfall([
        connection.fetchSnapshotByTimestamp.bind(connection, 'books', 'time-machine', day0),
        function(snapshot, next) {
          expect(snapshot).to.eql(v0);
          next();
        }
      ], done);
    });

    it('throws if the timestamp is undefined', function() {
      var fetch = function() {
        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', undefined, function() {});
      };

      expect(fetch).to.throw(Error);
    });

    it('throws without a callback', function() {
      var fetch = function() {
        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine');
      };

      expect(fetch).to.throw(Error);
    });

    it('throws if the timestamp is -1', function() {
      var fetch = function() {
        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', -1, function() { });
      };

      expect(fetch).to.throw(Error);
    });

    it('errors if the timestamp is a string', function() {
      var fetch = function() {
        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', 'foo', function() { });
      };

      expect(fetch).to.throw(Error);
    });

    it('returns an empty snapshot if trying to fetch a non-existent document', function(done) {
      backend.connect().fetchSnapshotByTimestamp('books', 'does-not-exist', day1, function(error, snapshot) {
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

      connection.fetchSnapshotByTimestamp('books', 'time-machine', null, function(error) {
        if (error) return done(error);
        expect(connection.hasPending()).to.equal(false);
        done();
      });

      expect(connection.hasPending()).to.equal(true);
    });

    it('deletes the request from the connection', function(done) {
      var connection = backend.connect();

      connection.fetchSnapshotByTimestamp('books', 'time-machine', function(error) {
        if (error) return done(error);
        expect(connection._snapshotRequests).to.eql({});
        done();
      });

      expect(connection._snapshotRequests).to.not.eql({});
    });

    it('emits a ready event when done', function(done) {
      var connection = backend.connect();

      connection.fetchSnapshotByTimestamp('books', 'time-machine', function(error) {
        if (error) return done(error);
      });

      var snapshotRequest = connection._snapshotRequests[1];
      snapshotRequest.on('ready', done);
    });

    it('fires the connection.whenNothingPending', function(done) {
      var connection = backend.connect();
      var snapshotFetched = false;

      connection.fetchSnapshotByTimestamp('books', 'time-machine', function(error) {
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

      connection.fetchSnapshotByTimestamp('books', 'time-machine', done);
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

      connection.fetchSnapshotByTimestamp('books', 'time-machine', done);
    });

    describe('readSnapshots middleware', function() {
      it('triggers the middleware', function(done) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots,
          function(request) {
            expect(request.snapshots[0]).to.eql(v3);
            expect(request.snapshotType).to.equal(backend.SNAPSHOT_TYPES.byTimestamp);
            done();
          }
        );

        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', day3, function() { });
      });

      it('can have its snapshot manipulated in the middleware', function(done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function(request, callback) {
            request.snapshots[0].data.title = 'Alice in Wonderland';
            callback();
          }
        ];

        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', function(error, snapshot) {
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

        backend.connect().fetchSnapshotByTimestamp('books', 'time-machine', day1, function(error) {
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
        backend.connect().fetchSnapshotByTimestamp('bookTitles', 'time-machine', day2, function(error, snapshot) {
          if (error) return done(error);

          expect(snapshot.data.title).to.equal('The Time Machine');
          expect(snapshot.data.author).to.equal(undefined);
          done();
        });
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

    describe('a doc with some versions in the milestone database', function() {
      beforeEach(function(done) {
        clock.reset();

        var doc = backendWithMilestones.connect().get('books', 'mocking-bird');

        async.series([
          doc.create.bind(doc, {title: 'To Kill a Mocking Bird'}),
          function(next) {
            clock.tick(ONE_DAY);
            doc.submitOp({p: ['author'], oi: 'Harper Lea'}, next);
          },
          function(next) {
            clock.tick(ONE_DAY);
            doc.submitOp({p: ['author'], od: 'Harper Lea', oi: 'Harper Lee'}, next);
          },
          function(next) {
            clock.tick(ONE_DAY);
            doc.submitOp({p: ['year'], oi: 1959}, next);
          },
          function(next) {
            clock.tick(ONE_DAY);
            doc.submitOp({p: ['year'], od: 1959, oi: 1960}, next);
          }
        ], done);
      });

      it('fetches a snapshot between two milestones using the milestones', function(done) {
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');
        sinon.spy(db, 'getOps');
        var halfwayBetweenDays3and4 = (day3 + day4) * 0.5;

        backendWithMilestones.connect()
          .fetchSnapshotByTimestamp('books', 'mocking-bird', halfwayBetweenDays3and4, function(error, snapshot) {
            if (error) return done(error);

            expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.calledOnce).to.equal(true);
            expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.calledOnce).to.equal(true);
            expect(db.getOps.calledWith('books', 'mocking-bird', 2, 4)).to.equal(true);

            expect(snapshot.v).to.equal(3);
            expect(snapshot.data).to.eql({title: 'To Kill a Mocking Bird', author: 'Harper Lee'});
            done();
          });
      });

      it('fetches a snapshot that matches a milestone snapshot', function(done) {
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');

        backendWithMilestones.connect()
          .fetchSnapshotByTimestamp('books', 'mocking-bird', day2, function(error, snapshot) {
            if (error) return done(error);

            expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.calledOnce).to.equal(true);
            expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.calledOnce).to.equal(true);

            expect(snapshot.v).to.equal(2);
            expect(snapshot.data).to.eql({title: 'To Kill a Mocking Bird', author: 'Harper Lea'});
            done();
          });
      });

      it('fetches a snapshot before any milestones', function(done) {
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');
        sinon.spy(db, 'getOps');

        backendWithMilestones.connect()
          .fetchSnapshotByTimestamp('books', 'mocking-bird', day1, function(error, snapshot) {
            if (error) return done(error);

            expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.calledOnce).to.equal(true);
            expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.calledOnce).to.equal(true);
            expect(db.getOps.calledWith('books', 'mocking-bird', 0, 2)).to.equal(true);

            expect(snapshot.v).to.equal(1);
            expect(snapshot.data).to.eql({title: 'To Kill a Mocking Bird'});
            done();
          });
      });

      it('fetches a snapshot after any milestones', function(done) {
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
        sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');
        sinon.spy(db, 'getOps');

        backendWithMilestones.connect()
          .fetchSnapshotByTimestamp('books', 'mocking-bird', day5, function(error, snapshot) {
            if (error) return done(error);

            expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.calledOnce).to.equal(true);
            expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.calledOnce).to.equal(true);
            expect(db.getOps.calledWith('books', 'mocking-bird', 4, null)).to.equal(true);

            expect(snapshot.v).to.equal(5);
            expect(snapshot.data).to.eql({
              title: 'To Kill a Mocking Bird',
              author: 'Harper Lee',
              year: 1960
            });

            done();
          });
      });

      describe('when timestamp is null', function() {
        it('fetches latest snapshot', function(done) {
          sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
          sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');
          sinon.spy(db, 'getOps');

          backendWithMilestones.connect()
            .fetchSnapshotByTimestamp('books', 'mocking-bird', null, function(error, snapshot) {
              if (error) return done(error);

              expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.called).to.be.false;
              expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.called).to.be.false;
              expect(db.getOps.called).to.be.false;

              expect(snapshot.v).to.equal(5);
              expect(snapshot.data).to.eql({
                title: 'To Kill a Mocking Bird',
                author: 'Harper Lee',
                year: 1960
              });

              done();
            });
        });

        it('returns error if getSnapshot fails', function(done) {
          sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrBeforeTime');
          sinon.spy(milestoneDb, 'getMilestoneSnapshotAtOrAfterTime');
          sinon.spy(db, 'getOps');

          sinon.stub(db, 'getSnapshot').callsFake(function(_collection, _id, _fields, _options, callback) {
            callback(new Error('TEST_ERROR'));
          });

          backendWithMilestones.connect()
            .fetchSnapshotByTimestamp('books', 'mocking-bird', null, function(error) {
              expect(error.message).to.be.equal('TEST_ERROR');

              expect(milestoneDb.getMilestoneSnapshotAtOrBeforeTime.called).to.be.false;
              expect(milestoneDb.getMilestoneSnapshotAtOrAfterTime.called).to.be.false;
              expect(db.getOps.called).to.be.false;
              expect(db.getSnapshot.called).to.be.true;

              done();
            });
        });
      });
    });
  });
});
