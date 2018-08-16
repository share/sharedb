var expect = require('expect.js');
var Backend = require('../lib/backend');
var MilestoneDB = require('../lib/milestone-db');
var Snapshot = require('../lib/snapshot');
var util = require('./util');

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

    describe('base class', function () {
      beforeEach(function () {
        db = new MilestoneDB();
        backend = new Backend({ milestoneDb: db });
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
          function (wasSaved, next) {
            expect(wasSaved).to.be(false);
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
        db.on('save', function (saved) {
          expect(saved).to.be(false);
          done();
        });

        db.saveMilestoneSnapshot('books', undefined);
      });
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
        function (wasSaved, next) {
          expect(wasSaved).to.be(true);
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
        function (wasSaved, next) {
          db.saveMilestoneSnapshot('books', snapshot2, next);
        },
        function (wasSaved, next) {
          db.saveMilestoneSnapshot('books', snapshot10, next);
        },
        function (wasSaved, next) {
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
        function (wasSaved, next) {
          db.saveMilestoneSnapshot('books', snapshot1, next);
        },
        function (wasSaved, next) {
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
        function (wasSaved, next) {
          db.saveMilestoneSnapshot('books', snapshot2, next);
        },
        function (wasSaved, next) {
          db.getMilestoneSnapshot('books', 'catcher-in-the-rye', null, next);
        },
        function (snapshot, next) {
          expect(snapshot).to.eql(snapshot2);
          next();
        },
        done
      ]);
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

      db.on('save', function (saved, collection, snapshot) {
        expect(saved).to.be(true);
        expect(collection).to.be('books');
        expect(snapshot).to.eql(snapshot);
        done();
      });

      db.saveMilestoneSnapshot('books', snapshot);
    });

    it('does not error when the snapshot is undefined', function (done) {
      db.saveMilestoneSnapshot('books', undefined, done);
    });

    it('emits an event when a snapshot does not save', function (done) {
      db.on('save', function (saved) {
        expect(saved).to.be(false);
        done();
      });

      db.saveMilestoneSnapshot('books', undefined);
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
        db.on('save', function (saved, collection, snapshot) {
          expect(saved).to.be(true);
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
        db.on('save', function (saved, collection, snapshot) {
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
    });
  });
};
