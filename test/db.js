var async = require('async');
var expect = require('expect.js');
var ot = require('../lib/ot');

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

    // Simplified mock of how submit request applies operations. The
    // noteworthy dependency is that it always calls getSnapshot with
    // the 'submit' projection and applies the op to the returned
    // snapshot before committing. Thus, commit may rely on the behavior
    // of getSnapshot with this special projection
    function submit(db, collection, id, op, callback) {
      db.getSnapshot(collection, id, 'submit', function(err, snapshot) {
        if (err) return callback(err);
        var err = ot.apply(snapshot, op);
        if (err) return callback(err);
        db.commit(collection, id, op, snapshot, callback);
      });
    }

    describe('commit', function() {
      function commitConcurrent(db, ops, test, done) {
        var numSucceeded = 0;
        async.each(ops, function(op, eachCb) {
          submit(db, 'testcollection', 'foo', op, function(err, succeeded) {
            if (err) return eachCb(err);
            if (succeeded) numSucceeded++;
            eachCb();
          });
        }, function(err) {
          if (err) return done(err);
          expect(numSucceeded).equal(1);
          if (!test) return done();
          db.getOps('testcollection', 'foo', 0, null, function(err, opsOut) {
            if (err) return done(err);
            db.getSnapshot('testcollection', 'foo', null, function(err, snapshotOut) {
              if (err) return done(err);
              test(opsOut, snapshotOut);
              done();
            });
          });
        });
      }

      function testCreateCommit(ops, snapshot) {
        expect(snapshot.v).eql(1);
        expect(ops.length).equal(1);
        expect(ops[0].create).ok();
      }

      it('one commit succeeds from 2 simultaneous creates', function(done) {
        var ops = [
          {v: 0, create: {type: 'json0', data: {x: 3}}},
          {v: 0, create: {type: 'json0', data: {x: 5}}}
        ];
        commitConcurrent(this.db, ops, testCreateCommit, done);
      });

      it('one commit succeeds from 5 simultaneous creates', function(done) {
        var ops = [
          {v: 0, create: {type: 'json0', data: {x: 3}}},
          {v: 0, create: {type: 'json0', data: {x: 5}}},
          {v: 0, create: {type: 'json0', data: {x: 7}}},
          {v: 0, create: {type: 'json0', data: {x: 9}}},
          {v: 0, create: {type: 'json0', data: {x: 11}}}
        ];
        commitConcurrent(this.db, ops, testCreateCommit, done);
      });

      function createDoc(db, callback) {
        var ops = [{v: 0, create: {type: 'json0', data: {x: 3}}}];
        commitConcurrent(db, ops, null, callback);
      }

      function testOpCommit(ops, snapshot) {
        expect(snapshot.v).equal(2);
        expect(ops.length).equal(2);
        expect(ops[0].create).ok();
        expect(ops[1].op).ok();
      }

      it('one commit succeeds from 2 simultaneous ops', function(done) {
        var ops = [
          {v: 1, op: []},
          {v: 1, op: []}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testOpCommit, done);
        });
      });

      it('one commit succeeds from 5 simultaneous ops', function(done) {
        var ops = [
          {v: 1, op: []},
          {v: 1, op: []},
          {v: 1, op: []},
          {v: 1, op: []},
          {v: 1, op: []}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testOpCommit, done);
        });
      });

      function testDelCommit(ops, snapshot) {
        expect(snapshot.v).equal(2);
        expect(ops.length).equal(2);
        expect(snapshot.data).equal(null);
        expect(snapshot.type).equal(null);
        expect(ops[0].create).ok();
        expect(ops[1].del).equal(true);
      }

      it('one commit succeeds from 2 simultaneous deletes', function(done) {
        var ops = [
          {v: 1, del: true},
          {v: 1, del: true}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testDelCommit, done);
        });
      });

      it('one commit succeeds from 5 simultaneous deletes', function(done) {
        var ops = [
          {v: 1, del: true},
          {v: 1, del: true},
          {v: 1, del: true},
          {v: 1, del: true},
          {v: 1, del: true}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testDelCommit, done);
        });
      });

      it('one commit succeeds from delete simultaneous with op', function(done) {
        var ops = [
          {v: 1, del: true},
          {v: 1, op: []}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testDelCommit, done);
        });
      });

      it('one commit succeeds from op simultaneous with delete', function(done) {
        var ops = [
          {v: 1, op: []},
          {v: 1, del: true}
        ];
        var db = this.db;
        createDoc(db, function(err) {
          if (err) throw err;
          commitConcurrent(db, ops, testOpCommit, done);
        });
      });
    });

    describe('getSnapshot', function() {
      it('getSnapshot returns v0 snapshot', function(done) {
        this.db.getSnapshot('testcollection', 'test', null, function(err, result) {
          if (err) throw err;
          expect(result).eql({id: 'test', type: null, v: 0, data: null});
          done();
        });
      });

      it('getSnapshot returns committed data', function(done) {
        var data = {x: 5, y: 6};
        var op = {v: 0, create: {type: 'json0', data: data}};
        var db = this.db;
        submit(db, 'testcollection', 'test', op, function(err, succeeded) {
          if (err) throw err;
          db.getSnapshot('testcollection', 'test', null, function(err, result) {
            if (err) throw err;
            expect(result).eql({id: 'test', type: 'http://sharejs.org/types/JSONv0', v: 1, data: data});
            done();
          });
        });
      });
    });

    describe('getSnapshotBulk', function() {
      it('getSnapshotBulk returns committed and v0 snapshots', function(done) {
        var data = {x: 5, y: 6};
        var op = {v: 0, create: {type: 'json0', data: data}};
        var db = this.db;
        submit(db, 'testcollection', 'test', op, function(err, succeeded) {
          if (err) throw err;
          db.getSnapshotBulk('testcollection', ['test2', 'test'], null, function(err, resultMap) {
            if (err) throw err;
            expect(resultMap).eql({
              test: {id: 'test', type: 'http://sharejs.org/types/JSONv0', v: 1, data: data},
              test2: {id: 'test2', type: null, v: 0, data: null}
            });
            done();
          });
        });
      });
    });

    describe('getOps', function() {
      it('getOps returns 1 committed op', function(done) {
        var op = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var db = this.db;
        submit(db, 'testcollection', 'test', op, function(err, succeeded) {
          if (err) throw err;
          db.getOps('testcollection', 'test', 0, null, function(err, ops) {
            if (err) throw err;
            expect(ops).eql([op]);
            done();
          });
        });
      });

      it('getOps returns 2 committed ops', function(done) {
        var op0 = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var op1 = {v: 1, op: [{p: ['x'], na: 1}]};
        var db = this.db;
        submit(db, 'testcollection', 'test', op0, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test', op1, function(err, succeeded) {
            if (err) throw err;
            db.getOps('testcollection', 'test', 0, null, function(err, ops) {
              if (err) throw err;
              expect(ops).eql([op0, op1]);
              done();
            });
          });
        });
      });

      it('getOps returns from specific op number', function(done) {
        var op0 = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var op1 = {v: 1, op: [{p: ['x'], na: 1}]};
        var db = this.db;
        submit(db, 'testcollection', 'test', op0, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test', op1, function(err, succeeded) {
            if (err) throw err;
            db.getOps('testcollection', 'test', 1, null, function(err, ops) {
              if (err) throw err;
              expect(ops).eql([op1]);
              done();
            });
          });
        });
      });

      it('getOps returns to specific op number', function(done) {
        var op0 = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var op1 = {v: 1, op: [{p: ['x'], na: 1}]};
        var db = this.db;
        submit(db, 'testcollection', 'test', op0, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test', op1, function(err, succeeded) {
            if (err) throw err;
            db.getOps('testcollection', 'test', 0, 1, function(err, ops) {
              if (err) throw err;
              expect(ops).eql([op0]);
              done();
            });
          });
        });
      });
    });

    describe('getOpsBulk', function() {
      it('getOpsBulk returns committed ops', function(done) {
        var op = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var db = this.db;
        submit(db, 'testcollection', 'test', op, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test2', op, function(err, succeeded) {
            if (err) throw err;
            db.getOpsBulk('testcollection', {test: 0, test2: 0}, null, function(err, opsMap) {
              if (err) throw err;
              expect(opsMap).eql({
                test: [op],
                test2: [op]
              });
              done();
            });
          });
        });
      });

      it('getOpsBulk returns committed ops with specific froms', function(done) {
        var op0 = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var op1 = {v: 1, op: [{p: ['x'], na: 1}]};
        var db = this.db;
        submit(db, 'testcollection', 'test', op0, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test2', op0, function(err, succeeded) {
            if (err) throw err;
            submit(db, 'testcollection', 'test', op1, function(err, succeeded) {
              if (err) throw err;
              submit(db, 'testcollection', 'test2', op1, function(err, succeeded) {
                if (err) throw err;
                db.getOpsBulk('testcollection', {test: 0, test2: 1}, null, function(err, opsMap) {
                  if (err) throw err;
                  expect(opsMap).eql({
                    test: [op0, op1],
                    test2: [op1]
                  });
                  done();
                });
              });
            });
          });
        });
      });

      it('getOpsBulk returns committed ops with specific to', function(done) {
        var op0 = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var op1 = {v: 1, op: [{p: ['x'], na: 1}]};
        var db = this.db;
        submit(db, 'testcollection', 'test', op0, function(err, succeeded) {
          if (err) throw err;
          submit(db, 'testcollection', 'test2', op0, function(err, succeeded) {
            if (err) throw err;
            submit(db, 'testcollection', 'test', op1, function(err, succeeded) {
              if (err) throw err;
              submit(db, 'testcollection', 'test2', op1, function(err, succeeded) {
                if (err) throw err;
                db.getOpsBulk('testcollection', {test: 1, test2: 0}, {test2: 1}, function(err, opsMap) {
                  if (err) throw err;
                  expect(opsMap).eql({
                    test: [op1],
                    test2: [op0]
                  });
                  done();
                });
              });
            });
          });
        });
      });
    });

    describe('getOpsToSnapshot', function() {
      it('getOpsToSnapshot returns committed op', function(done) {
        var op = {v: 0, create: {type: 'json0', data: {x: 5, y: 6}}};
        var db = this.db;
        submit(db, 'testcollection', 'test', op, function(err, succeeded) {
          if (err) throw err;
          db.getSnapshot('testcollection', 'test', 'submit', function(err, snapshot) {
            if (err) throw err;
            db.getOpsToSnapshot('testcollection', 'test', 0, snapshot, function(err, ops) {
              if (err) throw err;
              expect(ops).eql([op]);
              done();
            });
          });
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

    describe('queryPoll', function() {
      it('returns data in the collection', function(done) {
        var snapshot = {v: 1, type: 'json0', data: {x: 5, y: 6}};
        var db = this.db;
        db.commit('testcollection', 'test', {v: 0, create: {}}, snapshot, function(err, succeeded) {
          if (err) throw err;
          db.queryPoll('testcollection', {x: 5}, null, function(err, ids) {
            if (err) throw err;
            expect(ids).eql(['test']);
            done();
          });
        });
      });

      it('returns nothing when there is no data', function(done) {
        this.db.queryPoll('testcollection', {x: 5}, null, function(err, ids) {
          if (err) throw err;
          expect(ids).eql([]);
          done();
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
