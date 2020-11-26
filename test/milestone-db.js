var expect = require('chai').expect;
var Backend = require('../lib/backend');
var MilestoneDB = require('../lib/milestone-db');
var NoOpMilestoneDB = require('../lib/milestone-db/no-op');
var Snapshot = require('../lib/snapshot');
var async = require('async');
var errorHandler = require('./util').errorHandler;

describe('Base class', function() {
  var db;

  beforeEach(function() {
    db = new MilestoneDB();
  });

  it('calls back with an error when trying to get a snapshot', function(done) {
    db.getMilestoneSnapshot('books', '123', 1, function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error when trying to get a snapshot', function(done) {
    db.on('error', function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });

    db.getMilestoneSnapshot('books', '123', 1);
  });

  it('calls back with an error when trying to save a snapshot', function(done) {
    db.saveMilestoneSnapshot('books', {}, function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('emits an error when trying to save a snapshot', function(done) {
    db.on('error', function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });

    db.saveMilestoneSnapshot('books', {});
  });

  it('calls back with an error when trying to get a snapshot before a time', function(done) {
    db.getMilestoneSnapshotAtOrBeforeTime('books', '123', 1000, function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });

  it('calls back with an error when trying to get a snapshot after a time', function(done) {
    db.getMilestoneSnapshotAtOrAfterTime('books', '123', 1000, function(error) {
      expect(error.code).to.equal('ERR_DATABASE_METHOD_NOT_IMPLEMENTED');
      done();
    });
  });
});

describe('NoOpMilestoneDB', function() {
  var db;

  beforeEach(function() {
    db = new NoOpMilestoneDB();
  });

  it('does not error when trying to save and fetch a snapshot', function(done) {
    var snapshot = new Snapshot(
      'catcher-in-the-rye',
      2,
      'http://sharejs.org/types/JSONv0',
      {title: 'Catcher in the Rye'},
      null
    );

    async.waterfall([
      db.saveMilestoneSnapshot.bind(db, 'books', snapshot),
      db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', null),
      function(snapshot, next) {
        expect(snapshot).to.equal(undefined);
        next();
      }
    ], done);
  });

  it('emits an event when saving without a callback', function(done) {
    db.on('save', function() {
      done();
    });

    db.saveMilestoneSnapshot('books', undefined);
  });
});

module.exports = function(options) {
  var create = options.create;

  describe('Milestone Database', function() {
    describe('default options', function() {
      var db;
      var backend;

      beforeEach(function(done) {
        create(function(error, createdDb) {
          if (error) return done(error);
          db = createdDb;
          backend = new Backend({milestoneDb: db});
          done();
        });
      });

      afterEach(function(done) {
        backend.close(done);
      });

      it('can call close() without a callback', function(done) {
        create(function(error, db) {
          if (error) return done(error);
          db.close();
          done();
        });
      });

      it('stores and fetches a milestone snapshot', function(done) {
        var snapshot = new Snapshot(
          'catcher-in-the-rye',
          2,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        async.waterfall([
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot),
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 2),
          function(retrievedSnapshot, next) {
            expect(retrievedSnapshot).to.eql(snapshot);
            next();
          }
        ], done);
      });

      it('fetches the most recent snapshot before the requested version', function(done) {
        var snapshot1 = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        var snapshot2 = new Snapshot(
          'catcher-in-the-rye',
          2,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye', author: 'J.D. Salinger'},
          null
        );

        var snapshot10 = new Snapshot(
          'catcher-in-the-rye',
          10,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye', author: 'J.D. Salinger', publicationDate: '1951-07-16'},
          null
        );

        async.waterfall([
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot1),
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot2),
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot10),
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 4),
          function(snapshot, next) {
            expect(snapshot).to.eql(snapshot2);
            next();
          }
        ], done);
      });

      it('fetches the most recent snapshot even if they are inserted in the wrong order', function(done) {
        var snapshot1 = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        var snapshot2 = new Snapshot(
          'catcher-in-the-rye',
          2,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye', author: 'J.D. Salinger'},
          null
        );

        async.waterfall([
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot2),
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot1),
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 4),
          function(snapshot, next) {
            expect(snapshot).to.eql(snapshot2);
            next();
          }
        ], done);
      });

      it('fetches the most recent snapshot when the version is null', function(done) {
        var snapshot1 = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        var snapshot2 = new Snapshot(
          'catcher-in-the-rye',
          2,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye', author: 'J.D. Salinger'},
          null
        );

        async.waterfall([
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot1),
          db.saveMilestoneSnapshot.bind(db, 'books', snapshot2),
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', null),
          function(snapshot, next) {
            expect(snapshot).to.eql(snapshot2);
            next();
          }
        ], done);
      });

      it('errors when fetching an undefined version', function(done) {
        db.getMilestoneSnapshot('books', 'catcher-in-the-rye', undefined, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('errors when fetching version -1', function(done) {
        db.getMilestoneSnapshot('books', 'catcher-in-the-rye', -1, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('errors when fetching version "foo"', function(done) {
        db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 'foo', function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('errors when fetching a null collection', function(done) {
        db.getMilestoneSnapshot(null, 'catcher-in-the-rye', 1, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('errors when fetching a null ID', function(done) {
        db.getMilestoneSnapshot('books', null, 1, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('errors when saving a null collection', function(done) {
        var snapshot = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        db.saveMilestoneSnapshot(null, snapshot, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      it('returns undefined if no snapshot exists', function(done) {
        async.waterfall([
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 1),
          function(snapshot, next) {
            expect(snapshot).to.equal(undefined);
            next();
          }
        ], done);
      });

      it('does not store a milestone snapshot on commit', function(done) {
        var doc = backend.connect().get('books', 'catcher-in-the-rye');
        async.waterfall([
          doc.create.bind(doc, {title: 'Catcher in the Rye'}),
          db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', null),
          function(snapshot, next) {
            expect(snapshot).to.equal(undefined);
            next();
          }
        ], done);
      });

      it('can save without a callback', function(done) {
        var snapshot = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {title: 'Catcher in the Rye'},
          null
        );

        db.on('save', function(collection, snapshot) {
          expect(collection).to.equal('books');
          expect(snapshot).to.eql(snapshot);
          done();
        });

        db.saveMilestoneSnapshot('books', snapshot);
      });

      it('errors when the snapshot is undefined', function(done) {
        db.saveMilestoneSnapshot('books', undefined, function(error) {
          expect(error).instanceOf(Error);
          done();
        });
      });

      describe('snapshots with timestamps', function() {
        var snapshot1 = new Snapshot(
          'catcher-in-the-rye',
          1,
          'http://sharejs.org/types/JSONv0',
          {
            title: 'Catcher in the Rye'
          },
          {
            ctime: 1000,
            mtime: 1000
          }
        );

        var snapshot2 = new Snapshot(
          'catcher-in-the-rye',
          2,
          'http://sharejs.org/types/JSONv0',
          {
            title: 'Catcher in the Rye',
            author: 'JD Salinger'
          },
          {
            ctime: 1000,
            mtime: 2000
          }
        );

        var snapshot3 = new Snapshot(
          'catcher-in-the-rye',
          3,
          'http://sharejs.org/types/JSONv0',
          {
            title: 'Catcher in the Rye',
            author: 'J.D. Salinger'
          },
          {
            ctime: 1000,
            mtime: 3000
          }
        );

        beforeEach(function(done) {
          async.series([
            db.saveMilestoneSnapshot.bind(db, 'books', snapshot1),
            db.saveMilestoneSnapshot.bind(db, 'books', snapshot2),
            db.saveMilestoneSnapshot.bind(db, 'books', snapshot3)
          ], done);
        });

        describe('fetching a snapshot before or at a time', function() {
          it('fetches a snapshot before a given time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrBeforeTime.bind(db, 'books', 'catcher-in-the-rye', 2500),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot2);
                next();
              }
            ], done);
          });

          it('fetches a snapshot at an exact time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrBeforeTime.bind(db, 'books', 'catcher-in-the-rye', 2000),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot2);
                next();
              }
            ], done);
          });

          it('fetches the first snapshot for a null timestamp', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrBeforeTime.bind(db, 'books', 'catcher-in-the-rye', null),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot1);
                next();
              }
            ], done);
          });

          it('returns an error for a string timestamp', function(done) {
            db.getMilestoneSnapshotAtOrBeforeTime('books', 'catcher-in-the-rye', 'not-a-timestamp', function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('returns an error for a negative timestamp', function(done) {
            db.getMilestoneSnapshotAtOrBeforeTime('books', 'catcher-in-the-rye', -1, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('returns undefined if there are no snapshots before a time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrBeforeTime.bind(db, 'books', 'catcher-in-the-rye', 0),
              function(snapshot, next) {
                expect(snapshot).to.equal(undefined);
                next();
              }
            ], done);
          });

          it('errors if no collection is provided', function(done) {
            db.getMilestoneSnapshotAtOrBeforeTime(undefined, 'catcher-in-the-rye', 0, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('errors if no ID is provided', function(done) {
            db.getMilestoneSnapshotAtOrBeforeTime('books', undefined, 0, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });
        });

        describe('fetching a snapshot after or at a time', function() {
          it('fetches a snapshot after a given time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrAfterTime.bind(db, 'books', 'catcher-in-the-rye', 2500),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot3);
                next();
              }
            ], done);
          });

          it('fetches a snapshot at an exact time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrAfterTime.bind(db, 'books', 'catcher-in-the-rye', 2000),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot2);
                next();
              }
            ], done);
          });

          it('fetches the last snapshot for a null timestamp', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrAfterTime.bind(db, 'books', 'catcher-in-the-rye', null),
              function(snapshot, next) {
                expect(snapshot).to.eql(snapshot3);
                next();
              }
            ], done);
          });

          it('returns an error for a string timestamp', function(done) {
            db.getMilestoneSnapshotAtOrAfterTime('books', 'catcher-in-the-rye', 'not-a-timestamp', function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('returns an error for a negative timestamp', function(done) {
            db.getMilestoneSnapshotAtOrAfterTime('books', 'catcher-in-the-rye', -1, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('returns undefined if there are no snapshots after a time', function(done) {
            async.waterfall([
              db.getMilestoneSnapshotAtOrAfterTime.bind(db, 'books', 'catcher-in-the-rye', 4000),
              function(snapshot, next) {
                expect(snapshot).to.equal(undefined);
                next();
              }
            ], done);
          });

          it('errors if no collection is provided', function(done) {
            db.getMilestoneSnapshotAtOrAfterTime(undefined, 'catcher-in-the-rye', 0, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });

          it('errors if no ID is provided', function(done) {
            db.getMilestoneSnapshotAtOrAfterTime('books', undefined, 0, function(error) {
              expect(error).instanceOf(Error);
              done();
            });
          });
        });
      });
    });

    describe('milestones enabled for every version', function() {
      var db;
      var backend;

      beforeEach(function(done) {
        var options = {interval: 1};

        create(options, function(error, createdDb) {
          if (error) return done(error);
          db = createdDb;
          backend = new Backend({milestoneDb: db});
          done();
        });
      });

      afterEach(function(done) {
        backend.close(done);
      });

      it('stores a milestone snapshot on commit', function(done) {
        db.on('save', function(collection, snapshot) {
          expect(collection).to.equal('books');
          expect(snapshot.data).to.eql({title: 'Catcher in the Rye'});
          done();
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');
        doc.create({title: 'Catcher in the Rye'});
      });
    });

    describe('milestones enabled for every other version', function() {
      var db;
      var backend;

      beforeEach(function(done) {
        var options = {interval: 2};

        create(options, function(error, createdDb) {
          if (error) return done(error);
          db = createdDb;
          backend = new Backend({milestoneDb: db});
          done();
        });
      });

      afterEach(function(done) {
        backend.close(done);
      });

      it('only stores even-numbered versions', function(done) {
        db.on('save', function(collection, snapshot) {
          if (snapshot.v !== 4) return;

          async.waterfall([
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 1),
            function(snapshot, next) {
              expect(snapshot).to.equal(undefined);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 2),
            function(snapshot, next) {
              expect(snapshot.v).to.equal(2);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 3),
            function(snapshot, next) {
              expect(snapshot.v).to.equal(2);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 4),
            function(snapshot, next) {
              expect(snapshot.v).to.equal(4);
              next();
            }
          ], done);
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');

        async.series([
          doc.create.bind(doc, {title: 'Catcher in the Rye'}),
          doc.submitOp.bind(doc, {p: ['author'], oi: 'J.F.Salinger'}),
          doc.submitOp.bind(doc, {p: ['author'], od: 'J.F.Salinger', oi: 'J.D.Salinger'}),
          doc.submitOp.bind(doc, {p: ['author'], od: 'J.D.Salinger', oi: 'J.D. Salinger'})
        ], errorHandler(done));
      });

      it('can have the saving logic overridden in middleware', function(done) {
        backend.use('commit', function(request, callback) {
          request.saveMilestoneSnapshot = request.snapshot.v >= 3;
          callback();
        });

        db.on('save', function(collection, snapshot) {
          if (snapshot.v !== 4) return;

          async.waterfall([
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 1),
            function(snapshot, next) {
              expect(snapshot).to.equal(undefined);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 2),
            function(snapshot, next) {
              expect(snapshot).to.equal(undefined);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 3),
            function(snapshot, next) {
              expect(snapshot.v).to.equal(3);
              next();
            },
            db.getMilestoneSnapshot.bind(db, 'books', 'catcher-in-the-rye', 4),
            function(snapshot, next) {
              expect(snapshot.v).to.equal(4);
              next();
            }
          ], done);
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');

        async.series([
          doc.create.bind(doc, {title: 'Catcher in the Rye'}),
          doc.submitOp.bind(doc, {p: ['author'], oi: 'J.F.Salinger'}),
          doc.submitOp.bind(doc, {p: ['author'], od: 'J.F.Salinger', oi: 'J.D.Salinger'}),
          doc.submitOp.bind(doc, {p: ['author'], od: 'J.D.Salinger', oi: 'J.D. Salinger'})
        ], errorHandler(done));
      });
    });
  });
};
