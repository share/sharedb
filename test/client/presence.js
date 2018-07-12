var async = require('async');
var util = require('../util');
var errorHandler = util.errorHandler;
var Backend = require('../../lib/backend');
var ShareDBError = require('../../lib/error');
var expect = require('expect.js');
var types = require('../../lib/types');
var presenceType = require('./presence-type');
types.register(presenceType.type);
types.register(presenceType.type2);
types.register(presenceType.type3);

[
  'wrapped-presence-no-compare',
  'wrapped-presence-with-compare',
  'unwrapped-presence'
].forEach(function(typeName) {
  function p(index) {
    return typeName === 'unwrapped-presence' ? index : { index: index };
  }

  describe('client presence (' + typeName + ')', function() {
    beforeEach(function() {
      this.backend = new Backend();
      this.connection = this.backend.connect();
      this.connection2 = this.backend.connect();
      this.doc = this.connection.get('dogs', 'fido');
      this.doc2 = this.connection2.get('dogs', 'fido');
    });

    afterEach(function(done) {
      this.backend.close(done);
    });

    it('sends presence immediately', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc2.once('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('sends presence after pending ops', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc.submitOp({ index: 0, value: 'a' }, errorHandler(done));
          this.doc.submitOp({ index: 1, value: 'b' }, errorHandler(done));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc2.once('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('waits for pending ops before processing future presence', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
          // A hack to send presence for a future version.
          this.doc.version += 2;
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), function(err) {
            if (err) return done(err);
            this.doc.version -= 2;
            this.doc.submitOp({ index: 0, value: 'a' }, errorHandler(done));
            this.doc.submitOp({ index: 1, value: 'b' }, errorHandler(done));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (own ops, presence.index < op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitOp.bind(this.doc, { index: 1, value: 'b' }),
        this.doc.submitOp.bind(this.doc, { index: 2, value: 'c' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'a' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (own ops, presence.index === op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitOp.bind(this.doc, { index: 1, value: 'c' }),
        this.doc.submitOp.bind(this.doc, { index: 1, value: 'b' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(3));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'a' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (own ops, presence.index > op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitOp.bind(this.doc, { index: 0, value: 'b' }),
        this.doc.submitOp.bind(this.doc, { index: 0, value: 'a' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(3));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'c' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (non-own ops, presence.index < op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc2.submitOp.bind(this.doc2, { index: 1, value: 'b' }),
        this.doc2.submitOp.bind(this.doc2, { index: 2, value: 'c' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'a' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (non-own ops, presence.index === op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc2.submitOp.bind(this.doc2, { index: 1, value: 'c' }),
        this.doc2.submitOp.bind(this.doc2, { index: 1, value: 'b' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'a' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (non-own ops, presence.index > op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc2.submitOp.bind(this.doc2, { index: 0, value: 'b' }),
        this.doc2.submitOp.bind(this.doc2, { index: 0, value: 'a' }),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(3));
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'c' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (transform against non-op)', function(allDone) {
      async.series([
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.submitOp.bind(this.doc, { index: 0, value: 'a' }),
        this.doc.del.bind(this.doc),
        this.doc.create.bind(this.doc, [ 'b' ], typeName),
        function(done) {
          this.doc2.once('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'b' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
        }.bind(this),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'b' ]);
            expect(this.doc2.presence).to.not.have.key(this.connection.id);
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 2;
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('handles presence sent for earlier revisions (no cached ops)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitOp.bind(this.doc, { index: 1, value: 'b' }),
        this.doc.submitOp.bind(this.doc, { index: 2, value: 'c' }),
        function(done) {
          this.doc2.once('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
        }.bind(this),
        function(done) {
          this.doc2.cachedOps = [];
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.data).to.eql([ 'a', 'b', 'c' ]);
            expect(this.doc2.presence).to.not.have.key(this.connection.id);
            done();
          }.bind(this));
          // A hack to send presence for an older version.
          this.doc.version = 1;
          this.doc.data = [ 'a' ];
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against local delete', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList.sort()).to.eql([ '', this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence).to.not.have.key('');
            expect(this.doc.presence).to.not.have.key(this.connection2.id);
            done();
          }.bind(this));
          this.doc.del(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against non-local delete', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList.sort()).to.eql([ '', this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence).to.not.have.key('');
            expect(this.doc.presence).to.not.have.key(this.connection2.id);
            done();
          }.bind(this));
          this.doc2.del(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against local op (presence.index != op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(2)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence['']).to.eql(p(0));
            expect(this.doc.presence[this.connection2.id]).to.eql(p(3));
            done();
          }.bind(this));
          this.doc.submitOp({ index: 1, value: 'b' }, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against non-local op (presence.index != op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(2)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence['']).to.eql(p(0));
            expect(this.doc.presence[this.connection2.id]).to.eql(p(3));
            done();
          }.bind(this));
          this.doc2.submitOp({ index: 1, value: 'b' }, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against local op (presence.index == op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(1)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ '' ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence['']).to.eql(p(2));
            expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
            done();
          }.bind(this));
          this.doc.submitOp({ index: 1, value: 'b' }, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms presence against non-local op (presence.index == op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(1)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence['']).to.eql(p(1));
            expect(this.doc.presence[this.connection2.id]).to.eql(p(2));
            done();
          }.bind(this));
          this.doc2.submitOp({ index: 1, value: 'b' }, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('caches local ops', function(allDone) {
      var op = { index: 1, value: 'b' };
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.submitOp.bind(this.doc, op),
        this.doc.del.bind(this.doc),
        function(done) {
          expect(this.doc.cachedOps.length).to.equal(3);
          expect(this.doc.cachedOps[0].create).to.equal(true);
          expect(this.doc.cachedOps[1].op).to.equal(op);
          expect(this.doc.cachedOps[2].del).to.equal(true);
          done();
        }.bind(this)
      ], allDone);
    });

    it('caches non-local ops', function(allDone) {
      var op = { index: 1, value: 'b' };
      async.series([
        this.doc2.subscribe.bind(this.doc2),
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.submitOp.bind(this.doc, op),
        this.doc.del.bind(this.doc),
        setTimeout,
        function(done) {
          expect(this.doc2.cachedOps.length).to.equal(3);
          expect(this.doc2.cachedOps[0].create).to.equal(true);
          expect(this.doc2.cachedOps[1].op).to.eql(op);
          expect(this.doc2.cachedOps[2].del).to.equal(true);
          done();
        }.bind(this)
      ], allDone);
    });

    it('removes cached ops', function(allDone) {
      var op = { index: 1, value: 'b' };
      this.doc.cachedOpsTimeout = 0;
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.submitOp.bind(this.doc, op),
        this.doc.del.bind(this.doc),
        function(done) {
          expect(this.doc.cachedOps.length).to.equal(3);
          expect(this.doc.cachedOps[0].create).to.equal(true);
          expect(this.doc.cachedOps[1].op).to.equal(op);
          expect(this.doc.cachedOps[2].del).to.equal(true);
          done();
        }.bind(this),
        setTimeout,
        function(done) {
          expect(this.doc.cachedOps.length).to.equal(0);
          done();
        }.bind(this)
      ], allDone);
    });

    it('removes correct cached ops', function(allDone) {
      var op = { index: 1, value: 'b' };
      this.doc.cachedOpsTimeout = 0;
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.submitOp.bind(this.doc, op),
        this.doc.del.bind(this.doc),
        function(done) {
          expect(this.doc.cachedOps.length).to.equal(3);
          expect(this.doc.cachedOps[0].create).to.equal(true);
          expect(this.doc.cachedOps[1].op).to.equal(op);
          expect(this.doc.cachedOps[2].del).to.equal(true);
          this.doc.cachedOps.shift();
          this.doc.cachedOps.push({ op: true });
          done();
        }.bind(this),
        setTimeout,
        function(done) {
          expect(this.doc.cachedOps.length).to.equal(1);
          expect(this.doc.cachedOps[0].op).to.equal(true);
          done();
        }.bind(this)
      ], allDone);
    });

    it('requests reply presence when sending presence for the first time', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            if (srcList[0] === '') {
              expect(srcList).to.eql([ '' ]);
              expect(submitted).to.equal(true);
              expect(this.doc2.presence['']).to.eql(p(1));
              expect(this.doc2.presence).to.not.have.key(this.connection.id);
            } else {
              expect(srcList).to.eql([ this.connection.id ]);
              expect(this.doc2.presence['']).to.eql(p(1));
              expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
              expect(this.doc2.requestReplyPresence).to.equal(false);
              done();
            }
          }.bind(this));
          this.doc2.submitPresence(p(1), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('fails to submit presence for uncreated document: callback(err)', function(allDone) {
      async.series([
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.doc.submitPresence(p(0), function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4015);
            done();
          });
        }.bind(this)
      ], allDone);
    });

    it('fails to submit presence for uncreated document: emit(err)', function(allDone) {
      async.series([
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.doc.on('error', function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4015);
            done();
          });
          this.doc.submitPresence(p(0));
        }.bind(this)
      ], allDone);
    });

    it('fails to submit presence, if type does not support presence: callback(err)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, {}),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.doc.submitPresence(p(0), function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4024);
            done();
          });
        }.bind(this)
      ], allDone);
    });

    it('fails to submit presence, if type does not support presence: emit(err)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, {}),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.doc.on('error', function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4024);
            done();
          });
          this.doc.submitPresence(p(0));
        }.bind(this)
      ], allDone);
    });

    it('submits null presence', function(allDone) {
      async.series([
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, null)
      ], allDone);
    });

    it('sends presence once, if submitted multiple times synchronously', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(2));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc.submitPresence(p(2), errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('buffers presence until subscribed', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          setTimeout(function() {
            this.doc.subscribe(function(err) {
              if (err) return done(err);
              expect(this.doc2.presence).to.eql({});
            }.bind(this));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('buffers presence when disconnected', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
          this.connection.close();
          this.doc.submitPresence(p(1), errorHandler(done));
          process.nextTick(function() {
            this.backend.connect(this.connection);
            this.doc.requestReplyPresence = false;
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('submits presence without a callback', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0));
        }.bind(this)
      ], allDone);
    });

    it.skip('cancels pending presence on destroy', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        function(done) {
          this.doc.submitPresence(p(0), done);
          console.log(!!this.doc.inflightPresence, !!this.doc.pendingPresence);
          this.doc.destroy(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it.skip('cancels inflight presence on destroy', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.doc.submitPresence(p(0), done);
          process.nextTick(function() {
            this.doc.destroy(errorHandler(done));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('receives presence after doc is deleted', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        setTimeout,
        function(done) {
          expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            // The call to `del` transforms the presence and fires the event.
            // The call to `submitPresence` does not fire the event because presence is already null.
            expect(submitted).to.equal(false);
            expect(this.doc2.presence).to.not.have.key(this.connection.id);
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc2.del(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('clears peer presence on peer disconnection', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
          expect(this.doc2.presence['']).to.eql(p(1));

          var connectionId = this.connection.id;
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ connectionId ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence).to.not.have.key(connectionId);
            expect(this.doc2.presence['']).to.eql(p(1));
            done();
          }.bind(this));
          this.connection.close();
        }.bind(this)
      ], allDone);
    });

    it('clears peer presence on own disconnection', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
          expect(this.doc2.presence['']).to.eql(p(1));

          var connectionId = this.connection.id;
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ connectionId ]);
            expect(submitted).to.equal(false);
            expect(this.doc2.presence).to.not.have.key(connectionId);
            expect(this.doc2.presence['']).to.eql(p(1));
            done();
          }.bind(this));
          this.connection2.close();
        }.bind(this)
      ], allDone);
    });

    it('clears peer presence on peer unsubscribe', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
          expect(this.doc2.presence['']).to.eql(p(1));

          var connectionId = this.connection.id;
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ connectionId ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence).to.not.have.key(connectionId);
            expect(this.doc2.presence['']).to.eql(p(1));
            done();
          }.bind(this));
          this.doc.unsubscribe(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('clears peer presence on own unsubscribe', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
          expect(this.doc2.presence['']).to.eql(p(1));

          var connectionId = this.connection.id;
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ connectionId ]);
            expect(submitted).to.equal(false);
            expect(this.doc2.presence).to.not.have.key(connectionId);
            expect(this.doc2.presence['']).to.eql(p(1));
            done();
          }.bind(this));
          this.doc2.unsubscribe(errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('pauses inflight and pending presence on disconnect', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          var called = 0;
          function callback(err) {
            if (err) return done(err);
            if (++called === 2) done();
          }
          this.doc.submitPresence(p(0), callback);
          process.nextTick(function() {
            this.doc.submitPresence(p(1), callback);
            this.connection.close();
            process.nextTick(function() {
              this.backend.connect(this.connection);
            }.bind(this));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('pauses inflight and pending presence on unsubscribe', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          var called = 0;
          function callback(err) {
            if (err) return done(err);
            if (++called === 2) done();
          }
          this.doc.submitPresence(p(0), callback);
          process.nextTick(function() {
            this.doc.submitPresence(p(1), callback);
            this.doc.unsubscribe(errorHandler(done));
            process.nextTick(function() {
              this.doc.subscribe(errorHandler(done));
            }.bind(this));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('re-synchronizes presence after reconnecting', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          this.connection.close();
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence).to.not.have.key(this.connection2.id);
          this.backend.connect(this.connection);
          process.nextTick(done);
        }.bind(this),
        setTimeout, // wait for re-sync
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          process.nextTick(done);
        }.bind(this)
      ], allDone);
    });

    it('re-synchronizes presence after resubscribing', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(1)),
        setTimeout,
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          this.doc.unsubscribe(errorHandler(done));
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence).to.not.have.key(this.connection2.id);
          this.doc.subscribe(done);
        }.bind(this),
        setTimeout, // wait for re-sync
        function(done) {
          expect(this.doc.presence['']).to.eql(p(0));
          expect(this.doc.presence[this.connection2.id]).to.eql(p(1));
          process.nextTick(done);
        }.bind(this)
      ], allDone);
    });

    it('transforms received presence against inflight and pending ops (presence.index < op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(0));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(0), errorHandler(done));
          this.doc2.submitOp({ index: 1, value: 'b' }, errorHandler(done))
          this.doc2.submitOp({ index: 2, value: 'c' }, errorHandler(done))
        }.bind(this)
      ], allDone);
    });

    it('transforms received presence against inflight and pending ops (presence.index === op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc2.submitOp({ index: 1, value: 'c' }, errorHandler(done))
          this.doc2.submitOp({ index: 1, value: 'b' }, errorHandler(done))
        }.bind(this)
      ], allDone);
    });

    it('transforms received presence against inflight and pending ops (presence.index > op.index)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            expect(submitted).to.equal(true);
            expect(this.doc2.presence[this.connection.id]).to.eql(p(3));
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(1), errorHandler(done));
          this.doc2.submitOp({ index: 0, value: 'b' }, errorHandler(done))
          this.doc2.submitOp({ index: 0, value: 'a' }, errorHandler(done))
        }.bind(this)
      ], allDone);
    });

    it('transforms received presence against inflight delete', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(1)),
        setTimeout,
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            expect(srcList).to.eql([ this.connection.id ]);
            // The call to `del` transforms the presence and fires the event.
            // The call to `submitPresence` does not fire the event because presence is already null.
            expect(submitted).to.equal(false);
            expect(this.doc2.presence).to.not.have.key(this.connection.id);
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(2), errorHandler(done));
          this.doc2.del(errorHandler(done));
          this.doc2.create([ 'c' ], typeName, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('transforms received presence against a pending delete', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(1)),
        setTimeout,
        function(done) {
          var firstCall = true;
          this.doc2.on('presence', function(srcList, submitted) {
            if (firstCall) return firstCall = false;
            expect(srcList).to.eql([ this.connection.id ]);
            // The call to `del` transforms the presence and fires the event.
            // The call to `submitPresence` does not fire the event because presence is already null.
            expect(submitted).to.equal(false);
            expect(this.doc2.presence).to.not.have.key(this.connection.id);
            done();
          }.bind(this));
          this.doc.requestReplyPresence = false;
          this.doc.submitPresence(p(2), errorHandler(done));
          this.doc2.submitOp({ index: 0, value: 'b' }, errorHandler(done));
          this.doc2.del(errorHandler(done));
          this.doc2.create([ 'c' ], typeName, errorHandler(done));
        }.bind(this)
      ], allDone);
    });

    it('emits the same presence only if comparePresence is not implemented (local presence)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(1)),
        function(done) {
          this.doc.on('presence', function(srcList, submitted) {
            if (typeName === 'wrapped-presence-no-compare') {
              expect(srcList).to.eql([ '' ]);
              expect(submitted).to.equal(true);
              expect(this.doc.presence['']).to.eql(p(1));
              done();
            } else {
              done(new Error('Unexpected presence event'));
            }
          }.bind(this));
          this.doc.submitPresence(p(1), typeName === 'wrapped-presence-no-compare' ? errorHandler(done) : done);
        }.bind(this)
      ], allDone);
    });

    it('emits the same presence only if comparePresence is not implemented (non-local presence)', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(1)),
        setTimeout,
        function(done) {
          this.doc2.on('presence', function(srcList, submitted) {
            if (typeName === 'wrapped-presence-no-compare') {
              expect(srcList).to.eql([ this.connection.id ]);
              expect(submitted).to.equal(true);
              expect(this.doc2.presence[this.connection.id]).to.eql(p(1));
              done();
            } else {
              done(new Error('Unexpected presence event'));
            }
          }.bind(this));
          this.doc.submitPresence(p(1), typeName === 'wrapped-presence-no-compare' ? errorHandler(done) : done);
        }.bind(this)
      ], allDone);
    });

    it('returns an error when not subscribed on the server', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.connection.sendUnsubscribe(this.doc);
          process.nextTick(done);
        }.bind(this),
        function(done) {
          this.doc.on('error', done);
          this.doc.submitPresence(p(0), function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4025);
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('emits an error when not subscribed on the server and no callback is provided', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        function(done) {
          this.connection.sendUnsubscribe(this.doc);
          process.nextTick(done);
        }.bind(this),
        function(done) {
          this.doc.on('error', function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4025);
            done();
          }.bind(this));
          this.doc.submitPresence(p(0));
        }.bind(this)
      ], allDone);
    });

    it('returns an error when the server gets an old sequence number', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('error', done);
          this.connection.seq--;
          this.doc.submitPresence(p(1), function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4026);
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('emits an error when the server gets an old sequence number and no callback is provided', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('error', function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4026);
            done();
          }.bind(this));
          this.connection.seq--;
          this.doc.submitPresence(p(1));
        }.bind(this)
      ], allDone);
    });

    it('does not publish presence unnecessarily', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('error', done);
          // Decremented sequence number would cause the server to return an error, however,
          // the message won't be sent to the server at all because the presence data has not changed.
          this.connection.seq--;
          this.doc.submitPresence(p(0), function(err) {
            if (typeName === 'wrapped-presence-no-compare') {
              // The OT type does not support comparing presence.
              expect(err).to.be.an(Error);
              expect(err.code).to.equal(4026);
            } else {
              expect(err).to.not.be.ok();
            }
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('does not publish presence unnecessarily when no callback is provided', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc.submitPresence.bind(this.doc, p(0)),
        setTimeout,
        function(done) {
          this.doc.on('error', function(err) {
            if (typeName === 'wrapped-presence-no-compare') {
              // The OT type does not support comparing presence.
              expect(err).to.be.an(Error);
              expect(err.code).to.equal(4026);
              done();
            } else {
              done(err);
            }
          }.bind(this));
          // Decremented sequence number would cause the server to return an error, however,
          // the message won't be sent to the server at all because the presence data has not changed.
          this.connection.seq--;
          this.doc.submitPresence(p(0));
          if (typeName !== 'wrapped-presence-no-compare') {
            process.nextTick(done);
          }
        }.bind(this)
      ], allDone);
    });

    it('returns an error when publishing presence fails', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        setTimeout,
        function(done) {
          var sendPresence = this.backend.sendPresence;
          this.backend.sendPresence = function(presence, callback) {
            if (presence.a === 'p' && presence.v != null) {
              return callback(new ShareDBError(-1, 'Test publishing error'));
            }
            sendPresence.apply(this, arguments);
          };
          this.doc.on('error', done);
          this.doc.submitPresence(p(0), function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(-1);
            done();
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    it('emits an error when publishing presence fails and no callback is provided', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        setTimeout,
        function(done) {
          var sendPresence = this.backend.sendPresence;
          this.backend.sendPresence = function(presence, callback) {
            if (presence.a === 'p' && presence.v != null) {
              return callback(new ShareDBError(-1, 'Test publishing error'));
            }
            sendPresence.apply(this, arguments);
          };
          this.doc.on('error', function(err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(-1);
            done();
          }.bind(this));
          this.doc.submitPresence(p(0));
        }.bind(this)
      ], allDone);
    });

    it('clears presence on hard rollback and emits an error', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'b', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(0)),
        setTimeout,
        function(done) {
          // A hack to allow testing of hard rollback of both inflight and pending presence.
          var doc = this.doc;
          var _handlePresence = this.doc._handlePresence;
          this.doc._handlePresence = function(err, presence) {
            setTimeout(function() {
              _handlePresence.call(doc, err, presence);
            });
          };
          process.nextTick(done);
        }.bind(this),
        this.doc.submitPresence.bind(this.doc, p(1)), // inflightPresence
        process.nextTick, // wait for "presence" event
        this.doc.submitPresence.bind(this.doc, p(2)), // pendingPresence
        process.nextTick, // wait for "presence" event
        function(done) {
          var presenceEmitted = false;
          this.doc.on('presence', function(srcList, submitted) {
            expect(presenceEmitted).to.equal(false);
            presenceEmitted = true;
            expect(srcList.sort()).to.eql([ '', this.connection2.id ]);
            expect(submitted).to.equal(false);
            expect(this.doc.presence).to.not.have.key('');
            expect(this.doc.presence).to.not.have.key(this.connection2.id);
          }.bind(this));

          this.doc.on('error', function(err) {
            expect(presenceEmitted).to.equal(true);
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4000);
            done();
          }.bind(this));

          // send an invalid op
          this.doc._submit({}, null);
        }.bind(this)
      ], allDone);
    });

    it('clears presence on hard rollback and executes all callbacks', function(allDone) {
      async.series([
        this.doc.create.bind(this.doc, [ 'a', 'b', 'c' ], typeName),
        this.doc.subscribe.bind(this.doc),
        this.doc2.subscribe.bind(this.doc2),
        this.doc.submitPresence.bind(this.doc, p(0)),
        this.doc2.submitPresence.bind(this.doc2, p(0)),
        setTimeout,
        function(done) {
          // A hack to allow testing of hard rollback of both inflight and pending presence.
          var doc = this.doc;
          var _handlePresence = this.doc._handlePresence;
          this.doc._handlePresence = function(err, presence) {
            setTimeout(function() {
              _handlePresence.call(doc, err, presence);
            });
          };
          process.nextTick(done);
        }.bind(this),
        function(done) {
          var presenceEmitted = false;
          var called = 0;
          function callback(err) {
            expect(presenceEmitted).to.equal(true);
            expect(err).to.be.an(Error);
            expect(err.code).to.equal(4000);
            if (++called < 3) return;
            done();
          }
          this.doc.submitPresence(p(1), callback); // inflightPresence
          process.nextTick(function() { // wait for presence event
            this.doc.submitPresence(p(2), callback); // pendingPresence
            process.nextTick(function() { // wait for presence event
              this.doc.on('presence', function(srcList, submitted) {
                expect(presenceEmitted).to.equal(false);
                presenceEmitted = true;
                expect(srcList.sort()).to.eql([ '', this.connection2.id ]);
                expect(submitted).to.equal(false);
                expect(this.doc.presence).to.not.have.key('');
                expect(this.doc.presence).to.not.have.key(this.connection2.id);
              }.bind(this));
              this.doc.on('error', done);

              // send an invalid op
              this.doc._submit({ index: 3, value: 'b' }, null, callback);
            }.bind(this));
          }.bind(this));
        }.bind(this)
      ], allDone);
    });

    function testReceivedMessageExpiry(expireCache, reduceSequence) {
      return function(allDone) {
        var lastPresence = null;
        var handleMessage = this.connection.handleMessage;
        this.connection.handleMessage = function(message) {
          if (message.a === 'p' && message.src) {
            lastPresence = JSON.parse(JSON.stringify(message));
          }
          return handleMessage.apply(this, arguments);
        };
        if (expireCache) {
          this.doc.receivedPresenceTimeout = 0;
        }
        async.series([
          this.doc.create.bind(this.doc, [ 'a' ], typeName),
          this.doc.subscribe.bind(this.doc),
          this.doc2.subscribe.bind(this.doc2),
          function(done) {
            this.doc2.requestReplyPresence = false;
            this.doc2.submitPresence(p(0), done);
          }.bind(this),
          setTimeout,
          this.doc2.submitOp.bind(this.doc2, { index: 1, value: 'b' }), // forces processing of all received presence
          setTimeout,
          function(done) {
            expect(this.doc.data).to.eql([ 'a', 'b' ]);
            expect(this.doc.presence[this.connection2.id]).to.eql(p(0));
            // Replay the `lastPresence` with modified payload.
            lastPresence.p = p(1);
            lastPresence.v++; // +1 to account for the op above
            if (reduceSequence) {
              lastPresence.seq--;
            }
            this.connection.handleMessage(lastPresence);
            process.nextTick(done);
          }.bind(this),
          function(done) {
            expect(this.doc.presence[this.connection2.id]).to.eql(expireCache ? p(1) : p(0));
            process.nextTick(done);
          }.bind(this)
        ], allDone);
      };
    }

    it('ignores an old message (cache not expired, presence.seq === cachedPresence.seq)', testReceivedMessageExpiry(false, false));
    it('ignores an old message (cache not expired, presence.seq < cachedPresence.seq)', testReceivedMessageExpiry(false, true));
    it('processes an old message (cache expired, presence.seq === cachedPresence.seq)', testReceivedMessageExpiry(true, false));
    it('processes an old message (cache expired, presence.seq < cachedPresence.seq)', testReceivedMessageExpiry(true, true));
  });
});
