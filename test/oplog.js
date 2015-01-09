var assert = require('assert');
var textType = require('ot-text').type;

var counter = 1;

// Wait for the returned function to be called a given number of times, then call the
// callback.
function makePassPart(n, callback) {
  var remaining = n;

  return function() {
    remaining--;
    if (remaining === 0) {
      return callback();
    } else if (remaining < 0) {
      throw new Error("expectCalls called more than " + n + " times");
    }
  };
};

module.exports = function(create) {
  describe('oplog', function() {
    beforeEach(function(done) {
      this.cName = 'testcollection';
      this.docName = "optest " + (counter++);

      // Work with syncronous and asyncronous create() methods using their arity.
      if (create.length === 0) {
        this.db = create();
        done();
      } else {
        var _this = this;
        create(function(db) {
          _this.db = db;
          done();
        });
      }
    });

    afterEach(function() {
      this.db.close();
    });

    it('returns 0 when getVersion is called on a new document', function(done) {
      this.db.getVersion(this.cName, this.docName, function(err, v) {
        if (err) {
          throw new Error(err);
        }

        assert.strictEqual(v, 0);
        done();
      });
    });

    it('writing an operation bumps the version', function(done) {
      var _this = this;
      this.db.writeOp(this.cName, this.docName, {
        v: 0,
        create: {
          type: textType.uri
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          assert.strictEqual(v, 1);
          _this.db.writeOp(_this.cName, _this.docName, {
            v: 1,
            op: ['hi']
          }, function(err) {
            _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
              if (err) {
                throw new Error(err);
              }

              assert.strictEqual(v, 2);
              done();
            });
          });
        });
      });
    });

    it('ignores subsequent attempts to write the same operation', function(done) {
      var _this = this;
      this.db.writeOp(this.cName, this.docName, {
        v: 0,
        create: {
          type: textType.uri
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.db.writeOp(_this.cName, _this.docName, {
          v: 0,
          create: {
            type: textType.uri
          }
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
            if (err) {
              throw new Error(err);
            }

            assert.strictEqual(v, 1);
            _this.db.getOps(_this.cName, _this.docName, 0, null, function(err, ops) {
              assert.strictEqual(ops.length, 1);
              done();
            });
          });
        });
      });
    });

    it('does not decrement the version when receiving old ops', function(done) {
      var _this = this;
      this.db.writeOp(this.cName, this.docName, {
        v: 0,
        create: {
          type: textType.uri
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.db.writeOp(_this.cName, _this.docName, {
          v: 1,
          op: ['hi']
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.db.writeOp(_this.cName, _this.docName, {
            v: 0,
            create: {
              type: textType.uri
            }
          }, function(err) {
            if (err) {
              throw new Error(err);
            }
            _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
              if (err) {
                throw new Error(err);
              }

              assert.strictEqual(v, 2);
              done();
            });
          });
        });
      });
    });

    it('ignores concurrent attempts to write the same operation', function(done) {
      var _this = this;
      this.db.writeOp(this.cName, this.docName, {
        v: 0,
        create: {
          type: textType.uri
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }
      });

      this.db.writeOp(this.cName, this.docName, {
        v: 0,
        create: {
          type: textType.uri
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          assert.strictEqual(v, 1);
          _this.db.getOps(_this.cName, _this.docName, 0, null, function(err, ops) {
            assert.strictEqual(ops.length, 1);
            done();
          });
        });
      });
    });

    describe('getOps', function() {
      it('returns [] for a nonexistant document, with any arguments', function(done) {
        var num = 0;

        function check(error, ops) {
          if (error) {
            throw new Error(error);
          }
          assert.deepEqual(ops, []);
          if (++num === 7) {
            done();
          }
        };

        this.db.getOps(this.cName, this.docName, 0, 0, check);
        this.db.getOps(this.cName, this.docName, 0, 1, check);
        this.db.getOps(this.cName, this.docName, 0, 10, check);
        this.db.getOps(this.cName, this.docName, 0, null, check);
        this.db.getOps(this.cName, this.docName, 10, 10, check);
        this.db.getOps(this.cName, this.docName, 10, 11, check);
        this.db.getOps(this.cName, this.docName, 10, null, check);
      });

      it('returns ops', function(done) {
        var num = 0;

        function check(expected) {
          return function(error, ops) {
            if (error) {
              throw new Error(error);
            }
            if (ops) {
              for (var i = 0; i < ops.length; ++i) {
                delete ops[i].v;
              }
            }
            assert.deepEqual(ops, expected);
            if (++num === 5) {
              done();
            }
          };
        };

        var opData = {
          v: 0,
          op: [
            {
              p: 0,
              i: 'hi'
            }
          ],
          meta: {},
          src: 'abc',
          seq: 123
        };

        var _this = this;
        this.db.writeOp(this.cName, this.docName, opData, function() {
          delete opData.v;
          _this.db.getOps(_this.cName, _this.docName, 0, 0, check([]));
          _this.db.getOps(_this.cName, _this.docName, 0, 1, check([opData]));
          _this.db.getOps(_this.cName, _this.docName, 0, null, check([opData]));
          _this.db.getOps(_this.cName, _this.docName, 1, 1, check([]));
          _this.db.getOps(_this.cName, _this.docName, 1, null, check([]));
        });
      });
    });
  });
};
