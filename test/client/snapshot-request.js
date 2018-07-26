var Backend = require('../../lib/backend');
var expect = require('expect.js');
var types = require('../../lib/types');

describe('SnapshotRequest', function () {
  var backend;
  var json0 = types.map['json0'];

  beforeEach(function () {
    backend = new Backend();
  });

  afterEach(function (done) {
    backend.close(done);
  });

  describe('a document with some simple versions a day apart', function () {
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
      type: json0,
      data: {
        title: 'Don Quixote'
      },
      m: null
    };

    var v2 = {
      id: 'don-quixote',
      v: 2,
      type: json0,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervante'
      },
      m: null
    };

    var v3 = {
      id: 'don-quixote',
      v: 3,
      type: json0,
      data: {
        title: 'Don Quixote',
        author: 'Miguel de Cervantes'
      },
      m: null
    };

    beforeEach(function (done) {
      var doc = backend.connect().get('books', 'don-quixote');
      doc.create({ title: 'Don Quixote' }, function (error) {
        if (error) return done(error);
        doc.submitOp({ p: ['author'], oi: 'Miguel de Cervante' }, function (error) {
          if (error) return done(error);
          doc.submitOp({ p: ['author'], od: 'Miguel de Cervante', oi: 'Miguel de Cervantes' }, done);
        });
      });
    });

    describe('fetchSnapshot', () => {
      it('fetches v1', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 1, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v1);
          done();
        });
      });

      it('fetches v2', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 2, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v2);
          done();
        });
      });

      it('fetches v3', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 3, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v3);
          done();
        });
      });

      it('returns an empty snapshot if the version is 0', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v0);
          done();
        });
      });

      it('fetches the latest version if the version is undefined', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', undefined, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v3);
          done();
        });
      });

      it('fetches the latest version when the optional version is not provided', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v3);
          done();
        });
      });

      it('can call without a callback', function () {
        backend.connect().fetchSnapshot('books', 'don-quixote');
      });

      it('returns an empty snapshot if the version is -1', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', -1, function (error, snapshot) {
          if (error) return done(error);
          expect(snapshot).to.eql(v0);
          done();
        });
      });

      it('errors if the version is a string', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 'foo', function (error, snapshot) {
          expect(error.code).to.be(4024);
          expect(snapshot).to.be(undefined);
          done();
        });
      });

      it('errors if asking for a version that does not exist', function (done) {
        backend.connect().fetchSnapshot('books', 'don-quixote', 4, function (error, snapshot) {
          expect(error.code).to.be(4024);
          expect(snapshot).to.be(undefined);
          done();
        });
      });

      it('returns an empty snapshot if trying to fetch a non-existent document', function (done) {
        backend.connect().fetchSnapshot('books', 'does-not-exist', 0, function (error, snapshot) {
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

      it('starts pending, and finishes not pending', function (done) {
        var connection = backend.connect();

        connection.fetchSnapshot('books', 'don-quixote', null, function (error, snapshot) {
          expect(connection.hasPending()).to.be(false);
          done();
        });

        expect(connection.hasPending()).to.be(true);
      });

      it('deletes the request from the connection', function (done) {
        var connection = backend.connect();

        connection.fetchSnapshot('books', 'don-quixote', function (error) {
          if (error) return done(error);
          expect(connection.snapshotRequests).to.eql({});
          done();
        });

        expect(connection.snapshotRequests).to.not.eql({});
      });
    });

    describe('readSnapshots middleware', function () {
      it('triggers the middleware', function (done) {
        backend.use(backend.MIDDLEWARE_ACTIONS.readSnapshots,
          function (request) {
            expect(request.collection).to.be('books');
            expect(request.id).to.be('don-quixote');
            expect(request.v).to.be(3);
            expect(request.snapshots).to.eql([v3.data]);
            expect(request.type).to.be('http://sharejs.org/types/JSONv0');

            done();
          }
        );

        backend.connect().fetchSnapshot('books', 'don-quixote');
      });

      it('can have its snapshot manipulated in the middleware', function (done) {
        backend.middleware[backend.MIDDLEWARE_ACTIONS.readSnapshots] = [
          function (request, callback) {
            request.snapshots[0].title = 'Alice in Wonderland';
            callback();
          },
        ];

        backend.connect().fetchSnapshot('books', 'don-quixote', function (error, snapshot) {
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

        backend.connect().fetchSnapshot('books', 'don-quixote', 0, function (error, snapshot) {
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
        backend.connect().fetchSnapshot('bookTitles', 'don-quixote', 2, function (error, snapshot) {
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
        doc.del(function (error) {
          done(error);
        });
      });
    });

    it('returns a null type', function (done) {
      backend.connect().fetchSnapshot('books', 'catch-22', null, function (error, snapshot) {
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

    it('fetches v1', function (done) {
      backend.connect().fetchSnapshot('books', 'catch-22', 1, function (error, snapshot) {
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'catch-22',
          v: 1,
          type: json0,
          data: {
            title: 'Catch 22',
          },
          m: null
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
        doc.del(function (error) {
          if (error) return done (error);
          doc.create({ title: 'The Restaurant at the End of the Universe' }, function (error) {
            done(error);
          });
        });
      });
    });

    it('fetches the latest version of the document', function (done) {
      backend.connect().fetchSnapshot('books', 'hitchhikers-guide', null, function (error, snapshot) {
        if (error) return done(error);

        expect(snapshot).to.eql({
          id: 'hitchhikers-guide',
          v: 3,
          type: json0,
          data: {
            title: 'The Restaurant at the End of the Universe',
          },
          m: null
        });

        done();
      });
    });
  });
});
