var Backend = require('../../lib/backend');
var SnapshotRequest = require('../../lib/client/snapshot-request');
var expect = require('expect.js');
var lolex = require("lolex");

describe('SnapshotRequest', function () {
  var backend;
  var clock;

  var DAY0 = new Date("2018-05-30");
  var DAY1 = new Date("2018-06-01");
  var DAY2 = new Date("2018-06-02");
  var DAY3 = new Date("2018-06-03");
  var DAY4 = new Date("2018-06-04");
  var ONE_DAY = 1000 * 60 * 60 * 24;

  beforeEach(function () {
    clock = lolex.install({
      now: DAY1,
    });

    backend = new Backend();
  });

  afterEach(function (done) {
    clock.uninstall();

    backend.close(done);
  });

  describe('a document with some simple versions a day apart', function () {
    var v0 = {
      id: 'don-quixote',
      collection: 'books',
      version: 0,
      timestamp: DAY1.getTime(),
      deleted: false,
      data: {
        title: 'Don Quixote'
      }
    };

    var v1 = {
      id: 'don-quixote',
      collection: 'books',
      version: 1,
      timestamp: DAY2.getTime(),
      deleted: false,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervante'
      }
    };

    var v2 = {
      id: 'don-quixote',
      collection: 'books',
      version: 2,
      timestamp: DAY3.getTime(),
      deleted: false,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervantes'
      }
    };

    beforeEach(function (done) {
      var doc = backend.connect().get('books', 'don-quixote');
      doc.create({ title: 'Don Quixote' }, function (error) {
        if (error) done(error);
        clock.tick(ONE_DAY);
        doc.submitOp({ p: ['author'], oi: 'Miguel de Cervante' }, function (error) {
          if (error) done(error);
          clock.tick(ONE_DAY);
          doc.submitOp({ p: ['author'], od: 'Miguel de Cervante', oi: 'Miguel de Cervantes' }, done);
        });
      });
    });

    it('fetches v0', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v0);
        done();
      });
    });

    it('fetches v1', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', 1, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v1);
        done();
      });
    });

    it('fetches v2', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', 2, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('fetches the version from Day 1', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', DAY1, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v0);
        done();
      });
    });

    it('fetches the version from Day 2', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', DAY2, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v1);
        done();
      });
    });

    it('fetches the version from Day 3', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', DAY3, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('fetches the latest version if the version is undefined', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', undefined, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('errors if the version is -1', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', -1, function (error, snapshot) {
        expect(error.code).to.be(4015);
        expect(snapshot).to.be(undefined);
        done();
      });
    });

    it('returns the latest version of the document if asking for a later version', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', 3, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('errors if trying to fetch a snapshot before the document existed', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', DAY0, function (error, snapshot) {
        expect(error.code).to.be(4015);
        expect(snapshot).to.be(undefined);
        done();
      });
    });

    it('errors if trying to fetch a snapshot at the epoch', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', new Date(0), function (error, snapshot) {
        expect(error.code).to.be(4015);
        expect(snapshot).to.be(undefined);
        done();
      });
    });

    it('fetches the latest version if asking for a time after the last op', function (done) {
      backend.connect().getSnapshot('books', 'don-quixote', DAY4, function (error, snapshot) {
        if (error) done(error);
        expect(snapshot).to.eql(v2);
        done();
      });
    });

    it('errors if trying to fetch a non-existent document', function (done) {
      backend.connect().getSnapshot('books', 'does-not-exist', 0, function (error, snapshot) {
        expect(error.code).to.be(4015);
        expect(snapshot).to.be(undefined);
        done();
      });
    });

    it('starts pending, and finishes not pending', function (done) {
      var connection = backend.connect();

      connection.getSnapshot('books', 'don-quixote', null, function (error, snapshot) {
        expect(connection.hasPending()).to.be(false);
        done();
      });

      expect(connection.hasPending()).to.be(true);
    });

    describe('readSnapshots middleware', function (done) {
      it('triggers the middleware', function (done) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots,
          function (request) {
            expect(request.collection).to.be('books');
            expect(request.id).to.be('don-quixote');
            expect(request.version).to.be(2);
            expect(request.timestamp).to.be(DAY3.getTime());
            expect(request.snapshots).to.eql([v2.data]);
            expect(request.deleted).to.be(false);

            done();
          }
        );

        backend.connect().getSnapshot('books', 'don-quixote');
      });

      it('can have its snapshot manipulated in the middleware', function (done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function (request, callback) {
            request.snapshots[0].title = 'Alice in Wonderland';
            callback();
          },
        ];

        backend.connect().getSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot.data.title).to.be('Alice in Wonderland');
          done();
        });
      });

      it('respects errors thrown in the middleware', function (done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function (request, callback) {
            callback({ message: 'foo' });
          },
        ];

        backend.connect().getSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
          expect(error.message).to.be('foo');
          done();
        });
      });
    });

    describe('with a registered projection', function () {
      beforeEach(function () {
        backend.addProjection('bookTitles', 'books', { title: true });
      });

      it('applies the projection to a snapshot', function (done) {
        backend.connect().getSnapshot('bookTitles', 'don-quixote', 2, function (error, snapshot) {
          if (error) return done(error);

          expect(snapshot.data.title).to.be('Don Quixote');
          expect(snapshot.data.author).to.be(undefined);
          done();
        });
      });
    });
  });

  describe('a document that is currently deleted', function () {
    beforeEach(function (done) {
      var doc = backend.connect().get('books', 'catch-22');
      doc.create({ title: 'Catch 22' }, function (error) {
        if (error) return done(error);
        clock.tick(ONE_DAY);
        doc.del(function (error) {
          done(error);
        });
      });
    });

    it('returns a deleted flag', function (done) {
      backend.connect().getSnapshot('books', 'catch-22', null, function (error, snapshot) {
        expect(snapshot).to.eql({
          id: 'catch-22',
          collection: 'books',
          version: 1,
          timestamp: DAY2.getTime(),
          deleted: true,
          data: undefined
        });

        done();
      });
    });

    it('fetches v0', function (done) {
      backend.connect().getSnapshot('books', 'catch-22', 0, function (error, snapshot) {
        if (error) done(error);

        expect(snapshot).to.eql({
          id: 'catch-22',
          collection: 'books',
          version: 0,
          timestamp: DAY1.getTime(),
          deleted: false,
          data: {
            title: 'Catch 22',
          }
        });

        done();
      });
    });
  });

  describe('a document that was deleted and then created again', function () {
    beforeEach(function (done) {
      var doc = backend.connect().get('books', 'hitchhikers-guide');
      doc.create({ title: 'Hitchhiker\'s Guide to the Galaxy' }, function (error) {
        if (error) done(error);
        clock.tick(ONE_DAY);
        doc.del(function (error) {
          if (error) return done (error);
          clock.tick(ONE_DAY);
          doc.create({ title: 'The Restaurant at the End of the Universe' }, function (error) {
            done(error);
          });
        });
      });
    });

    it('fetches the latest version of the document', function (done) {
      backend.connect().getSnapshot('books', 'hitchhikers-guide', null, function (error, snapshot) {
        if (error) done(error);

        expect(snapshot).to.eql({
          id: 'hitchhikers-guide',
          collection: 'books',
          version: 2,
          timestamp: DAY3.getTime(),
          deleted: false,
          data: {
            title: 'The Restaurant at the End of the Universe',
          }
        });

        done();
      });
    });
  });
});
