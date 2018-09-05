var expect = require('expect.js');
var Backend = require('../lib/backend');
var MilestoneDB = require('../lib/milestone-db');
var NoOpMilestoneDB = require('../lib/milestone-db/no-op');
var Snapshot = require('../lib/snapshot');
var util = require('./util');

describe('Base class', function () {
  var db;

  beforeEach(function () {
    db = new MilestoneDB();
  });

  it('calls back with an error when trying to get a snapshot', function (done) {
    db.getMilestoneSnapshot('books', '123', 1, function (error) {
      expect(error.code).to.be(5019);
      done();
    });
  });

  it('emits an error when trying to get a snapshot', function (done) {
    db.on('error', function (error) {
      expect(error.code).to.be(5019);
      done();
    });

    db.getMilestoneSnapshot('books', '123', 1);
  });

  it('calls back with an error when trying to save a snapshot', function (done) {
    db.saveMilestoneSnapshot('books', {}, function (error) {
      expect(error.code).to.be(5020);
      done();
    });
  });

  it('emits an error when trying to save a snapshot', function (done) {
    db.on('error', function (error) {
      expect(error.code).to.be(5020);
      done();
    });

    db.saveMilestoneSnapshot('books', {});
  });
});

describe('NoOpMilestoneDB', function () {
  var db;

  beforeEach(function () {
    db = new NoOpMilestoneDB();
  });

  it('does not error when trying to save and fetch a snapshot', function (done) {
    var snapshot = new Snapshot(
      'catcher-in-the-rye',
      2,
      'http://sharejs.org/types/JSONv0',
      { title: 'Catcher in the Rye' },
      null
    );

    util.callInSeries([
      function (next) {
        db.saveMilestoneSnapshot('books', snapshot, next);
      },
      function (next) {
        db.getMilestoneSnapshot('books', 'catcher-in-the-rye', null, next);
      },
      function (snapshot, next) {
        expect(snapshot).to.be(undefined);
        next();
      },
      done
    ]);
  });

  it('emits an event when saving without a callback', function (done) {
    db.on('save', function () {
      done();
    });

    db.saveMilestoneSnapshot('books', undefined);
  });
});

module.exports = function (options) {
  var create = options.create;

  describe('Milestone Database', function () {
    var db;
    var backend;

    beforeEach(function (done) {
      create(function (error, createdDb) {
        if (error) return done(error);
        db = createdDb;
        backend = new Backend({ milestoneDb: db });
        done();
      });
    });

    afterEach(function (done) {
      db.close(done);
    });

    it('can call close() without a callback', function (done) {
      create(function (error, db) {
        if (error) return done(error);
        db.close();
        done();
      });
    });

    it('stores and fetches a milestone snapshot', function (done) {
      var snapshot = new Snapshot(
        'catcher-in-the-rye',
        2,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      util.callInSeries([
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot, next);
        },
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 2, next);
        },
        function (retrievedSnapshot, next) {
          expect(retrievedSnapshot).to.eql(snapshot);
          next();
        },
        done
      ]);
    });

    it('fetches the most recent snapshot before the requested version', function (done) {
      var snapshot1 = new Snapshot(
        'catcher-in-the-rye',
        1,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      var snapshot2 = new Snapshot(
        'catcher-in-the-rye',
        2,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye', author: 'J.D. Salinger' },
        null
      );

      var snapshot10 = new Snapshot(
        'catcher-in-the-rye',
        10,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye', author: 'J.D. Salinger', publicationDate: '1951-07-16' },
        null
      );

      util.callInSeries([
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot1, next);
        },
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot2, next);
        },
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot10, next);
        },
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 4, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.eql(snapshot2);
          next();
        },
        done
      ]);
    });

    it('fetches the most recent snapshot even if they are inserted in the wrong order', function (done) {
      var snapshot1 = new Snapshot(
        'catcher-in-the-rye',
        1,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      var snapshot2 = new Snapshot(
        'catcher-in-the-rye',
        2,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye', author: 'J.D. Salinger' },
        null
      );

      util.callInSeries([
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot2, next);
        },
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot1, next);
        },
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 4, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.eql(snapshot2);
          next();
        },
        done
      ]);
    });

    it('fetches the most recent snapshot when the version is null', function (done) {
      var snapshot1 = new Snapshot(
        'catcher-in-the-rye',
        1,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      var snapshot2 = new Snapshot(
        'catcher-in-the-rye',
        2,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye', author: 'J.D. Salinger' },
        null
      );

      util.callInSeries([
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot1, next);
        },
        function (next) {
          db.saveMilestoneSnapshot('books', snapshot2, next);
        },
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', null, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.eql(snapshot2);
          next();
        },
        done
      ]);
    });

    it('errors when fetching an undefined version', function (done) {
      db.getMilestoneSnapshot('books', 'catcher-in-the-rye', undefined, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('errors when fetching version -1', function (done) {
      db.getMilestoneSnapshot('books', 'catcher-in-the-rye', -1, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('errors when fetching version "foo"', function (done) {
      db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 'foo', function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('errors when fetching a null collection', function (done) {
      db.getMilestoneSnapshot(null, 'catcher-in-the-rye', 1, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('errors when fetching a null ID', function (done) {
      db.getMilestoneSnapshot('books', null, 1, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('errors when saving a null collection', function (done) {
      var snapshot = new Snapshot(
        'catcher-in-the-rye',
        1,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      db.saveMilestoneSnapshot(null, snapshot, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    it('returns undefined if no snapshot exists', function (done) {
      util.callInSeries([
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 1, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.be(undefined);
          next();
        },
        done
      ]);
    });

    it('does not store a milestone snapshot on commit', function (done) {
      util.callInSeries([
        function (next) {
          var doc = backend.connect().get('books', 'catcher-in-the-rye');
          doc.create({ title: 'Catcher in the Rye' }, next);
        },
        function (next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', null, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.be(undefined);
          next();
        },
        done
      ]);
    });

    it('can save without a callback', function (done) {
      var snapshot = new Snapshot(
        'catcher-in-the-rye',
        1,
        'http://sharejs.org/types/JSONv0',
        { title: 'Catcher in the Rye' },
        null
      );

      db.on('save', function (collection, snapshot) {
        expect(collection).to.be('books');
        expect(snapshot).to.eql(snapshot);
        done();
      });

      db.saveMilestoneSnapshot('books', snapshot);
    });

    it('errors when the snapshot is undefined', function (done) {
      db.saveMilestoneSnapshot('books', undefined, function (error) {
        expect(error).to.be.ok();
        done();
      });
    });

    describe('milestones enabled for every version', function () {
      beforeEach(function (done) {
        var options = { interval: 1 };

        create(options, function (error, createdDb) {
          if (error) return done(error);
          db = createdDb;
          backend = new Backend({ milestoneDb: db });
          done();
        });
      });

      it('stores a milestone snapshot on commit', function (done) {
        db.on('save', function (collection, snapshot) {
          expect(collection).to.be('books');
          expect(snapshot.data).to.eql({ title: 'Catcher in the Rye' });
          done();
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');
        doc.create({ title: 'Catcher in the Rye' });
      });
    });

    describe('milestones enabled for every other version', function () {
      beforeEach(function (done) {
        var options = { interval: 2 };

        create(options, function (error, createdDb) {
          if (error) return done(error);
          db = createdDb;
          backend = new Backend({ milestoneDb: db });
          done();
        });
      });

      it('only stores even-numbered versions', function (done) {
        db.on('save', function (collection, snapshot) {
          if (snapshot.v !== 4) return;

          util.callInSeries([
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 1, next);
            },
            function (snapshot, next) {
              expect(snapshot).to.be(undefined);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 2, next);
            },
            function (snapshot, next) {
              expect(snapshot.v).to.be(2);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 3, next);
            },
            function (snapshot, next) {
              expect(snapshot.v).to.be(2);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 4, next);
            },
            function (snapshot, next) {
              expect(snapshot.v).to.be(4);
              next();
            },
            done
          ]);
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');

        util.callInSeries([
          function (next) {
            doc.create({ title: 'Catcher in the Rye' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], oi: 'J.F.Salinger' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], od: 'J.F.Salinger', oi: 'J.D.Salinger' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], od: 'J.D.Salinger', oi: 'J.D. Salinger' }, next);
          }
        ]);
      });

      it('can have the saving logic overridden in middleware', function (done) {
        backend.use('commit', function (request, callback) {
          request.saveMilestoneSnapshot = request.snapshot.v >= 3;
          callback();
        });

        db.on('save', function (collection, snapshot) {
          if (snapshot.v !== 4) return;

          util.callInSeries([
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 1, next);
            },
            function (snapshot, next) {
              expect(snapshot).to.be(undefined);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 2, next);
            },
            function (snapshot, next) {
              expect(snapshot).to.be(undefined);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 3, next);
            },
            function (snapshot, next) {
              expect(snapshot.v).to.be(3);
              next();
            },
            function (next) {
              db.getMilestoneSnapshot('books', 'catcher-in-the-rye', 4, next);
            },
            function (snapshot, next) {
              expect(snapshot.v).to.be(4);
              next();
            },
            done
          ]);
        });

        var doc = backend.connect().get('books', 'catcher-in-the-rye');

        util.callInSeries([
          function (next) {
            doc.create({ title: 'Catcher in the Rye' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], oi: 'J.F.Salinger' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], od: 'J.F.Salinger', oi: 'J.D.Salinger' }, next);
          },
          function (next) {
            doc.submitOp({ p: ['author'], od: 'J.D.Salinger', oi: 'J.D. Salinger' }, next);
          }
        ]);
      });
    });
  });
};
