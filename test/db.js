var expect = require('expect.js');

module.exports = function(create) {
  describe('db', function() {
    beforeEach(function(done) {
      var self = this;
      create(function(err, db) {
        if (err) throw err;
        self.db = db;
        done();
      });
    });

    afterEach(function(done) {
      this.db.close(done);
    });

    describe('commit', function() {
      function testSimultaneousSucceeds(db, done, setup, test) {
        var wait = 2;
        var numSucceeded = 0;
        var finish = function() {
          if (--wait) return;
          expect(numSucceeded).equal(1);
          done();
        };
        var commit = function(op, snapshot) {
          db.commit('testcollection', 'foo', op, snapshot, function(err, succeeded) {
            if (err) throw err;
            if (!succeeded) return finish();
            numSucceeded++;
            db.getOps('testcollection', 'foo', 0, null, function(err, opsOut) {
              if (err) throw err;
              db.getSnapshot('testcollection', 'foo', null, function(err, snapshotOut) {
                if (err) throw err;
                test(op, snapshot, opsOut, snapshotOut);
                finish();
              });
            });
          });
        };
        setup(commit);
      }

      it('one commit succeeds from two simultaneous creates', function(done) {
        var db = this.db;
        var opA = {v: 0, create: {type: 'json0', data: {x: 3}}};
        var snapshotA = {v: 1, type: 'json0', data: {x: 3}};
        var opB = {v: 0, create: {type: 'json0', data: {x: 5}}};
        var snapshotB = {v: 1, type: 'json0', data: {x: 5}};
        testSimultaneousSucceeds(db, done, function(commit) {
          commit(opA, snapshotA);
          commit(opB, snapshotB);
        }, function(op, snapshot, opsOut, snapshotOut) {
          expect(snapshotOut.data).eql(snapshot.data);
          expect(opsOut.length).equal(1);
          expect(opsOut[0].create).eql(op.create);
        });
      });

      it('one commit succeeds from two simultaneous ops', function(done) {
        var db = this.db;
        var op0 = {v: 0, create: {type: 'json0', data: {x: 0}}};
        var snapshot0 = {v: 1, type: 'json0', data: {x: 0}};
        testSimultaneousSucceeds(db, done, function(commit) {
          db.commit('testcollection', 'foo', op0, snapshot0, function(err) {
            if (err) throw err;
            var opA = {v: 1, op: [{p: ['x'], na: 3}]};
            var snapshotA = {v: 2, type: 'json0', data: {x: 3}, _opLink: op0._id};
            var opB = {v: 1, op: [{p: ['x'], na: 5}]};
            var snapshotB = {v: 2, type: 'json0', data: {x: 5}, _opLink: op0._id};
            commit(opA, snapshotA);
            commit(opB, snapshotB);
          });
        }, function(op, snapshot, opsOut, snapshotOut) {
          expect(snapshotOut.data).eql(snapshot.data);
          expect(opsOut.length).equal(2);
          expect(opsOut[0].create).eql(op0.create);
          expect(opsOut[1].op).eql(op.op);
        });
      });

      it('one commit succeeds from two simultaneous deletes', function(done) {
        var db = this.db;
        var op0 = {v: 0, create: {type: 'json0', data: {x: 0}}};
        var snapshot0 = {v: 1, type: 'json0', data: {x: 0}};
        testSimultaneousSucceeds(db, done, function(commit) {
          db.commit('testcollection', 'foo', op0, snapshot0, function(err) {
            if (err) throw err;
            var opA = {v: 1, del: true};
            var snapshotA = {v: 2, type: null, _opLink: op0._id};
            var opB = {v: 1, del: true};
            var snapshotB = {v: 2, type: null, _opLink: op0._id};
            commit(opA, snapshotA);
            commit(opB, snapshotB);
          });
        }, function(op, snapshot, opsOut, snapshotOut) {
          expect(snapshotOut.data).equal(undefined);
          expect(opsOut.length).equal(2);
          expect(opsOut[0].create).eql(op0.create);
          expect(opsOut[1].del).eql(true);
        });
      });

      it('one commit succeeds from delete simultaneous with op', function(done) {
        var db = this.db;
        var op0 = {v: 0, create: {type: 'json0', data: {x: 0}}};
        var snapshot0 = {v: 1, type: 'json0', data: {x: 0}};
        testSimultaneousSucceeds(db, done, function(commit) {
          db.commit('testcollection', 'foo', op0, snapshot0, function(err) {
            if (err) throw err;
            var opA = {v: 1, del: true};
            var snapshotA = {v: 2, type: null, _opLink: op0._id};
            var opB = {v: 1, op: [{p: ['x'], na: 5}]};
            var snapshotB = {v: 2, type: 'json0', data: {x: 5}, _opLink: op0._id};
            commit(opA, snapshotA);
            commit(opB, snapshotB);
          });
        }, function(op, snapshot, opsOut, snapshotOut) {
          expect(snapshotOut.data).equal(undefined);
          expect(opsOut.length).equal(2);
          expect(opsOut[0].create).eql(op0.create);
          expect(opsOut[1].del).eql(true);
        });
      });

      it('one commit succeeds from op simultaneous with delete', function(done) {
        var db = this.db;
        var op0 = {v: 0, create: {type: 'json0', data: {x: 0}}};
        var snapshot0 = {v: 1, type: 'json0', data: {x: 0}};
        testSimultaneousSucceeds(db, done, function(commit) {
          db.commit('testcollection', 'foo', op0, snapshot0, function(err) {
            if (err) throw err;
            var opA = {v: 1, op: [{p: ['x'], na: 3}]};
            var snapshotA = {v: 2, type: 'json0', data: {x: 3}, _opLink: op0._id};
            var opB = {v: 1, del: true};
            var snapshotB = {v: 2, type: null, _opLink: op0._id};
            commit(opA, snapshotA);
            commit(opB, snapshotB);
          });
        }, function(op, snapshot, opsOut, snapshotOut) {
          expect(snapshotOut.data).eql(snapshot.data);
          expect(opsOut.length).equal(2);
          expect(opsOut[0].create).eql(op0.create);
          expect(opsOut[1].op).eql(op.op);
        });
      });
    });

    describe('query', function() {
      it('returns data in the collection', function(done) {
        var snapshot = {v: 1, type: 'json0', data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err, succeeded) {
          if (err) throw err;
          db.query('testcollection', {x: 5}, null, null, function(err, results) {
            if (err) throw err;
            delete results[0].id;
            expect(results).eql([snapshot]);
            done();
          });
        });
      });

      it('returns nothing when there is no data', function(done) {
        this.db.query('testcollection', {x: 5}, null, null, function(err, results) {
          if (err) throw err;
          expect(results).eql([]);
          done();
        });
      });
    });

    describe('projections', function() {
      it('query returns only projected fields', function(done) {
        if (!this.db.projectsSnapshot) return done();

        var snapshot = {type: 'json0', v: 1, data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err) {
          db.query('testcollection', {x: 5}, {y: true}, null, function(err, results) {
            if (err) throw err;
            expect(results).eql([{type: 'json0', v: 1, data: {y: 6}, id: 'test'}]);
            done();
          });
        });
      });

      it('query returns no data for matching documents if fields is empty', function(done) {
        if (!this.db.projectsSnapshot) return done();

        var snapshot = {type: 'json0', v: 1, data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err) {
          db.query('testcollection', {x: 5}, {}, null, function(err, results) {
            if (err) throw err;
            expect(results).eql([{type: 'json0', v: 1, data: {}, id: 'test'}]);
            done();
          });
        });
      });
    });

    describe('queryPollDoc', function() {
      it('returns false when the document does not exist', function(done) {
        var query = {}
        if (!this.db.canPollDoc('testcollection', query)) return done();

        var db = this.db;
        db.queryPollDoc('testcollection', 'doesnotexist', query, null, function(err, result) {
          if (err) throw err;
          expect(result).equal(false);
          done();
        });
      });

      it('returns true when the document matches', function(done) {
        var query = {x: 5};
        if (!this.db.canPollDoc('testcollection', query)) return done();

        var snapshot = {type: 'json0', v: 1, data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err) {
          db.queryPollDoc('testcollection', 'test', query, null, function(err, result) {
            if (err) throw err;
            expect(result).equal(true);
            done();
          });
        });
      });

      it('returns false when the document does not match', function(done) {
        var query = {x: 6};
        if (!this.db.canPollDoc('testcollection', query)) return done();

        var snapshot = {type: 'json0', v: 1, data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err) {
          db.queryPollDoc('testcollection', 'test', query, null, function(err, result) {
            if (err) throw err;
            expect(result).equal(false);
            done();
          });
        });
      });
    });

  });
};
