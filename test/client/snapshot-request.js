var Backend = require('../../lib/backend');
var expect = require('expect.js');
var lolex = require("lolex");
var types = require('../../lib/types');

describe('SnapshotRequest', function () {
  var backend;
  var clock;
  var json0 = types.map['json0'];

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
    var emptySnapshot = {
      id: 'don-quixote',
      collection: 'books',
      version: 0,
      timestamp: 0,
      type: null,
      data: undefined
    };

    var v0 = {
      id: 'don-quixote',
      collection: 'books',
      version: 1,
      timestamp: DAY1.getTime(),
      type: json0,
      data: {
        title: 'Don Quixote'
      }
    };

    var v1 = {
      id: 'don-quixote',
      collection: 'books',
      version: 2,
      timestamp: DAY2.getTime(),
      type: json0,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervante'
      }
    };

    var v2 = {
      id: 'don-quixote',
      collection: 'books',
      version: 3,
      timestamp: DAY3.getTime(),
      type: json0,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervantes'
      }
    };

    beforeEach(function (done) {
      var doc = backend.connect().get('books', 'don-quixote');
      doc.create({ title: 'Don Quixote' }, function (error) {
        if (error) return done(error);
        clock.tick(ONE_DAY);
        doc.submitOp({ p: ['author'], oi: 'Miguel de Cervante' }, function (error) {
          if (error) return done(error);
          clock.tick(ONE_DAY);
          doc.submitOp({ p: ['author'], od: 'Miguel de Cervante', oi: 'Miguel de Cervantes' }, done);
        });
      });
    });

    describe('getSnapshot', () => {
      it('fetches v1', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 1, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v0);
          done();
        });
      });

      it('fetches v2', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 2, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v1);
          done();
        });
      });

      it('fetches v3', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 3, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('returns an empty snapshot if the version is 0', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(emptySnapshot);
          done();
        });
      });

      it('fetches the latest version if the version is undefined', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', undefined, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('fetches the latest version when the optional version is not provided', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('can call without a callback', function () {
        backend.connect().getSnapshot('books', 'don-quixote');
      });

      it('returns an empty snapshot if the version is -1', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', -1, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(emptySnapshot);
          done();
        });
      });

      it('errors if the version is a string', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 'foo', function (error, snapshot) {
          expect(error.code).to.be(4024);
          expect(snapshot).to.be(undefined);
          done();
        });
      });

      it('errors if asking for a version that does not exist', function (done) {
        backend.connect().getSnapshot('books', 'don-quixote', 4, function (error, snapshot) {
          expect(error.code).to.be(4024);
          expect(snapshot).to.be(undefined);
          done();
        });
      });

      it('returns an empty snapshot if trying to fetch a non-existent document', function (done) {
        backend.connect().getSnapshot('books', 'does-not-exist', 0, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql({
            id: 'does-not-exist',
            collection: 'books',
            version: 0,
            timestamp: 0,
            type: null,
            data: undefined
          });
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

      it('deletes the request from the connection', function (done) {
        var connection = backend.connect();

        connection.getSnapshot('books', 'don-quixote', function (error) {
          if (error) return done(error);
          expect(connection.snapshotRequests).to.eql({});
          done();
        });

        expect(connection.snapshotRequests).to.not.eql({});
      });
    });

    describe('getSnapshotByTimestamp', () => {
      it('fetches the version from Day 1', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', DAY1.getTime(), function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v0);
          done();
        });
      });

      it('fetches the version from Day 2', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', DAY2.getTime(), function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v1);
          done();
        });
      });

      it('fetches the version from Day 3', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', DAY3.getTime(), function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('fetches the latest version if the timestamp is undefined', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', undefined, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('fetches the latest version when the optional timestamp is not provided', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('can call without a callback', function () {
        backend.connect().getSnapshotAtTime('books', 'don-quixote');
      });

      it('returns an empty snapshot when trying to fetch a snapshot before the document existed', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', DAY0.getTime(), function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(emptySnapshot);
          done();
        });
      });

      it('returns an empty snapshot when trying to fetch a snapshot at the epoch', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', 0, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(emptySnapshot);
          done();
        });
      });

      it('errors if asking for a time after now', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', DAY4.getTime(), function (error, snapshot) {
          expect(error.code).to.be(4025);
          expect(snapshot).to.be(undefined);
          done();
        });
      });

      it('errors if the timestamp is a string', function (done) {
        backend.connect().getSnapshotAtTime('books', 'don-quixote', 'foo', function (error, snapshot) {
          expect(error.code).to.be(4025);
          expect(snapshot).to.be(undefined);
          done();
        });
      });
    });

    describe('readSnapshots middleware', function () {
      it('triggers the middleware', function (done) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots,
          function (request) {
            expect(request.collection).to.be('books');
            expect(request.id).to.be('don-quixote');
            expect(request.version).to.be(3);
            expect(request.timestamp).to.be(DAY3.getTime());
            expect(request.snapshots).to.eql([v2.data]);
            expect(request.type).to.be('http://sharejs.org/types/JSONv0');

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

        backend.connect().getSnapshot('books', 'don-quixote', function (error, snapshot) {
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

    it('returns a null type', function (done) {
      backend.connect().getSnapshot('books', 'catch-22', null, function (error, snapshot) {
        expect(snapshot).to.eql({
          id: 'catch-22',
          collection: 'books',
          version: 2,
          timestamp: DAY2.getTime(),
          type: null,
          data: undefined
        });

        done();
      });
    });

    it('fetches v1', function (done) {
      backend.connect().getSnapshot('books', 'catch-22', 1, function (error, snapshot) {
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'catch-22',
          collection: 'books',
          version: 1,
          timestamp: DAY1.getTime(),
          type: json0,
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
        if (error) return done(error);
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
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'hitchhikers-guide',
          collection: 'books',
          version: 3,
          timestamp: DAY3.getTime(),
          type: json0,
          data: {
            title: 'The Restaurant at the End of the Universe',
          }
        });

        done();
      });
    });
  });
});
