var redisLib = require('redis');
var assert = require('assert');
var runTests = require('./driver');

describe('redis driver', function() {
  function create(oplog) {
    var createDriver = require('../lib/redisdriver');
    var redis = redisLib.createClient();
    redis.select(redis.selected_db = 15);
    return createDriver(oplog, redis);
  };

  function destroy(driver) {
    driver.destroy();
    return driver.redis.quit();
  };

  beforeEach(function(done) {
    var c = redisLib.createClient();
    c.select(15);
    c.flushdb(function(err) {
      if (err) {
        throw Error(err);
      }

      c.quit();
      done();
    });
  });

  runTests(create, destroy, true);

  describe('redis specific tests', function() {
    beforeEach(function() {
      this.redis = this.driver.redis;
      this.cName = 'users';
    });

    it('has no dangling listeners after subscribing and unsubscribing', function(done) {
      var _this = this;
      return this.driver.subscribe('users', this.docName, 0, {}, function(err, stream) {
        if (err) {
          throw Error(err);
        }

        assert.equal(_this.driver.numStreams, 1);
        stream.destroy();
        _this.driver.bulkSubscribe({
          users: {
            a: 0,
            b: 0
          }
        }, function(err, response) {
          if (err) {
            throw Error(err);
          }

          assert.equal(_this.driver.numStreams, 2);
          response.users.a.destroy();
          response.users.b.destroy();
          _this.redis.publish("15 " + _this.cName + "." + _this.docName, '{}', function(err, numSubscribers) {
            assert.equal(numSubscribers, 0);
            assert.equal(_this.driver.numStreams, 0);
            assert.deepEqual(Object.keys(_this.driver.streams), []);
            done();
          });
        });
      });
    });

    it('repopulates the persistant oplog if data is missing', function(done) {
      var _this = this;

      this.redis.set("users." + this.docName + " v", 2);

      this.redis.rpush("users." + this.docName + " ops", JSON.stringify({
        create: {
          type: 'text'
        }
      }), JSON.stringify({
        op: ['hi']
      }), function(err) {
        if (err) {
          throw Error(err);
        }

        _this.driver.atomicSubmit('users', _this.docName, {
          v: 2,
          op: ['yo']
        },
        {},
        function(err) {
          if (err) {
            throw Error(err);
          }

          _this.oplog.getVersion('users', _this.docName, function(err, v) {
            if (err) {
              throw Error(err);
            }

            assert.strictEqual(v, 3);
            _this.getOps('users', _this.docName, 0, null, function(err, ops) {
              if (err) {
                throw Error(err);
              }

              assert.strictEqual(ops.length, 3);
              done();
            });
          });
        });
      });
    });

    it('works if the data in redis is missing', function(done) {
      var _this = this;
      this.create(function() {
        _this.redis.flushdb(function() {
          _this.getOps('users', _this.docName, 0, null, function(err, ops) {
            if (err) {
              throw new Error(err);
            }

            assert.equal(ops.length, 1);
            _this.driver.atomicSubmit('users', _this.docName, {
              v: 1,
              op: ['hi']
            }, {}, function(err) {
              if (err) {
                throw new Error(err);
              }

              _this.getOps('users', _this.docName, 0, null, function(err, ops) {
                if (err) {
                  throw new Error(err);
                }

                assert.equal(ops.length, 2);
                done();
              });
            });
          });
        });
      });
    });

    it('ignores redis operations if the version isnt set', function(done) {
      var _this = this;

      this.create(function() {
        _this.redis.del("users." + _this.docName + " v", function(err, result) {
          if (err) {
            throw Error(err);
          }

          assert.equal(result, 1);
          _this.redis.lset("" + _this.cName + "." + _this.docName + " ops", 0, "junk that will crash livedb", function(err) {
            if (err) {
              throw Error(err);
            }

            _this.driver.atomicSubmit('users', _this.docName, {
              v: 1,
              op: ['hi']
            },
            {},
            function(err, v) {
              if (err) {
                throw new Error(err);
              }

              _this.getOps('users', _this.docName, 0, null, function(err, ops) {
                if (err) {
                  throw new Error(err);
                }

                assert.equal(ops.length, 2);
                done();
              });
            });
          });
        });
      });
    });

    it('works if data in the oplog is missing', function(done) {
      var _this = this;

      this.redis.set("" + this.cName + "." + this.docName + " v", 2);
      this.redis.rpush("" + this.cName + "." + this.docName + " ops", JSON.stringify({
        create: {
          type: 'text'
        }
      }), JSON.stringify({
        op: ['hi']
      }), function(err) {
        if (err) {
          throw Error(err);
        }

        _this.driver.getOps(_this.cName, _this.docName, 0, null, function(err, ops) {
          if (err) {
            throw Error(err);
          }

          assert.equal(ops.length, 2);
          done();
        });
      });
    });

    it('removes junk in the redis oplog on submit', function(done) {
      var _this = this;
      this.create(function() {
        _this.redis.del("" + _this.cName + "." + _this.docName + " v", function(err, result) {
          if (err) {
            throw Error(err);
          }

          assert.equal(result, 1);
          _this.redis.lset("" + _this.cName + "." + _this.docName + " ops", 0, "junk that will crash livedb", function(err) {
            _this.driver.atomicSubmit('users', _this.docName, {
              v: 1,
              op: ['hi']
            },
            {},
            function(err, v) {
              if (err) {
                throw new Error(err);
              }

              _this.getOps('users', _this.docName, 0, null, function(err, ops) {
                if (err) {
                  throw new Error(err);
                }

                assert.equal(ops.length, 2);
                done();
              });
            });
          });
        });
      });
    });

    describe('does not hit the database if the version is current in redis', function() {
      beforeEach(function(done) {
        var _this = this;

        this.create(function() {
          _this.oplog.getVersion = function() {
            throw Error('getVersion should not be called');
          };
          _this.oplog.getOps = function() {
            throw Error('getOps should not be called');
          };
          done();
        });
      });

      it('from previous version', function(done) {
        var _this = this;
        this.driver.getOps('users', this.docName, 0, null, function(err, ops) {
          if (err) {
            throw new Error(err);
          }

          assert.strictEqual(ops.length, 1);
          done();
        });
      });

      it('from current version', function(done) {
        this.driver.getOps('users', this.docName, 1, null, function(err, ops) {
          if (err) {
            throw new Error(err);
          }

          assert.deepEqual(ops, []);
          done();
        });
      });
    });

    // TODO: Not implemented.
    it('correctly namespaces pubsub operations so other collections dont get confused');
  });
});
