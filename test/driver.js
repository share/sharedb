var assert = require('assert');
var async = require('async');
var MemoryStore = require('../lib/memory');

var nextDocId = 0;

function createOp(v) {
  if (v == null) {
    v = 0;
  }

  if (v === 0) {
    return {
      v: v,
      create: {
        type: 'text',
        data: 'hi'
      },
      m: {}
    };
  } else {
    return {
      v: v,
      op: ['x'],
      m: {}
    };
  }
};

module.exports = function(createDriver, destroyDriver, distributed) {
  if (distributed == null) {
    distributed = false;
  }

  beforeEach(function() {
    this.docName = "id" + (nextDocId++);
    this.create = function(cb) {
      this.driver.atomicSubmit('users', this.docName, createOp(), null, function(err) {
        if (err) {
          throw new Error(err);
        }

        return typeof cb === "function" ? cb() : void 0;
      });
    };

    var _this = this;
    this.getOps = function(cName, docName, from, to, callback) {
      async.parallel([
        function(cb) {
          _this.oplog.getOps(cName, docName, from, to, function(err, ops) {
            cb(err, ops);
          });
        }, function(cb) {
          _this.driver.getOps(cName, docName, from, to, function(err, ops) {
            cb(err, ops);
          });
        }
      ], function(err, results) {
        if (err) {
          return callback(err);
        }

        assert.deepEqual(results[0], results[1]);
        callback(null, results[0]);
      });
    };

    this.oplog = MemoryStore();
    this.driver = createDriver(this.oplog);
  });

  afterEach(function(done) {
    var _this = this;
    this.driver._checkForLeaks(true, function() {
      destroyDriver(_this.driver);
      done();
    });
  });

  describe('atomicSubmit', function() {
    it('writes the op to the oplog', function(done) {
      var _this = this;
      this.driver.atomicSubmit('users', 'seph', createOp(), {}, function(err) {
        if (err) {
          throw Error(err);
        }

        _this.oplog.getVersion('users', 'seph', function(err, v) {
          if (err) {
            throw Error(err);
          }

          assert.strictEqual(v, 1);
          done();
        });
      });
    });

    it('allows exactly one write at a given version to succeed', function(done) {
      var num = 100;
      var written = false;
      var count = 0;
      var _this = this;

      function cb(err) {
        count++;
        assert(count <= num);
        if (err == null) {
          if (written) {
            throw 'Multiple writes accepted';
          }
          written = true;
        } else if (err !== 'Transform needed') {
          throw Error(err);
        }

        if (count === num) {
          if (!written) {
            throw 'No writes accepted';
          }
          _this.oplog.getVersion('users', 'seph', function(err, v) {
            if (err) {
              throw Error(err);
            }

            assert.strictEqual(v, 1);
            done();
          });
        }
      };

      for (var i = 0; i < num; ++i) {
        this.driver.atomicSubmit('users', 'seph', createOp(), {}, cb)
      }
    });

    it('forwards submitted ops to the oplog', function(done) {
      var _this = this;
      this.driver.atomicSubmit('users', 'seph', createOp(0), {}, function(err) {
        if (err) {
          throw Error(err);
        }

        _this.driver.atomicSubmit('users', 'seph', createOp(1), {}, function(err) {
          if (err) {
            throw Error(err);
          }

          _this.driver.atomicSubmit('users', 'seph', createOp(2), {}, function(err) {
            if (err) {
              throw Error(err);
            }

            _this.getOps('users', 'seph', 0, null, function(err, ops) {
              if (err) {
                throw Error(err);
              }

              var expectedOps = [];
              for (var v = 0; v < 3; ++v) {
                expectedOps.push(createOp(v));
              }
              assert.deepEqual(ops, expectedOps);

              done();
            });
          });
        });
      });
    });
  });

  describe('dirty lists', function() {
    beforeEach(function() {
      var _this = this;

      this.v = 0;
      this.append = function(dirtyData, callback) {
        _this.driver.atomicSubmit('users', 'seph', createOp(_this.v++), {
          dirtyData: dirtyData
        }, function(err) {
          if (err) {
            throw Error(err);
          }

          return typeof callback === "function" ? callback() : void 0;
        });
      };

      this.checkConsume = function(list, expected, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }

        var called = false;
        function consume(data, callback) {
          assert(!called);
          called = true;
          assert.deepEqual(data, expected);
          callback();
        };

        this.driver.consumeDirtyData(list, options, consume, function(err) {
          if (err) {
            throw Error(err);
          }

          assert.equal(called, expected !== null);
          callback();
        });
      };
    });

    it('returns dirty data through consume', function(done) {
      var _this = this;
      this.append({
        x: {
          complex: 'data'
        }
      }, function() {
        _this.checkConsume('x', [
          {
            complex: 'data'
          }
        ], done);
      });
    });

    it('does not give you consumed data again', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        _this.checkConsume('x', [1], function() {
          _this.append({
            x: 2
          }, function() {
            _this.checkConsume('x', [2], done);
          });
        });
      });
    });

    it('lets your list grow', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        _this.append({
          x: 2
        }, function() {
          _this.append({
            x: 3
          }, function() {
            _this.checkConsume('x', [1, 2, 3], done);
          });
        });
      });
    });

    it('does not consume data if your consume function errors', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        function consume(data, callback) {
          callback('ermagherd');
        };
        _this.driver.consumeDirtyData('x', {}, consume, function(err) {
          assert.deepEqual(err, 'ermagherd');
          _this.checkConsume('x', [1], done);
        });
      });
    });

    it('does not call consume if there is no data', function(done) {
      function consume(data, callback) {
        throw Error('Consume called with no data');
      };

      this.driver.consumeDirtyData('x', {}, consume, function(err) {
        if (err) {
          throw Error(err);
        }

        done();
      });
    });

    it('does not call consume if all the data has been consumed', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        _this.append({
          x: 2
        }, function() {
          _this.append({
            x: 3
          }, function() {
            _this.checkConsume('x', [1, 2, 3], function() {
              function consume(data, callback) {
                throw Error('Consume called after all data consumed');
              };

              _this.driver.consumeDirtyData('x', {}, consume, function(err) {
                if (err) {
                  throw Error(err);
                }

                done();
              });
            });
          });
        });
      });
    });

    it('only consumes the data sent to checkConsume', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        function consume(data, callback) {
          _this.append({
            x: 2
          }, callback);
        };
        _this.driver.consumeDirtyData('x', {}, consume, function(err) {
          if (err) {
            throw Error(err);
          }
          _this.checkConsume('x', [2], done);
        });
      });
    });

    it('handles lists independently', function(done) {
      var _this = this;
      this.append({
        x: 'x1',
        y: 'y1',
        z: 'z1'
      }, function() {
        _this.checkConsume('x', ['x1'], function() {
          _this.append({
            x: 'x2',
            y: 'y2',
            z: 'z2'
          }, function() {
            _this.checkConsume('y', ['y1', 'y2'], function() {
              _this.append({
                x: 'x3',
                y: 'y3',
                z: 'z3'
              }, function() {
                _this.checkConsume('x', ['x2', 'x3'], function() {
                  _this.checkConsume('y', ['y3'], function() {
                    _this.checkConsume('z', ['z1', 'z2', 'z3'], function() {
                      done();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('limit only returns as many as you ask for', function(done) {
      var _this = this;
      this.append({
        x: 1
      }, function() {
        _this.append({
          x: 2
        }, function() {
          _this.append({
            x: 3
          }, function() {
            _this.checkConsume('x', [1, 2], {
              limit: 2
            }, function() {
              _this.checkConsume('x', [3], {
                limit: 2
              }, function() {
                _this.checkConsume('x', null, {
                  limit: 2
                }, function() {
                  _this.append({
                    x: 4
                  }, function() {
                    _this.checkConsume('x', [4], {
                      limit: 2
                    }, done);
                  });
                });
              });
            });
          });
        });
      });
    });

    describe('wait stress test', function() {
      for (var delay = 0; delay < 11; ++delay) {
        it('delaying ' + delay, function(done) {
          this.checkConsume('x', [1], {
            wait: true
          }, done);

          var _this = this;
          setTimeout(function() {
            _this.append({
              x: 1
            });
          }, delay);
        });
      }
    });
  });

  describe('bulkGetOpsSince', function() {
    it('handles multiple gets which are missing from the oplog', function(done) {
      var _this = this;
      this.oplog.writeOp('test', 'one', createOp(0), function() {
        _this.oplog.writeOp('test', 'two', createOp(0), function() {
          _this.driver.bulkGetOpsSince({
            test: {
              one: 0,
              two: 0
            }
          }, function(err, result) {
            if (err) {
              throw Error(err);
            }

            assert.deepEqual(result, {
              test: {
                one: [createOp(0)],
                two: [createOp(0)]
              }
            });
            done();
          });
        });
      });
    });
  });

  describe('subscribe', function() {
    function subscribeTests(subType) {
      describe(subType, function() {
        beforeEach(function() {
          var _this = this;
          this.subscribe = subType === 'single' ? this.driver.subscribe.bind(this.driver) : function(cName, docName, v, options, callback) {
            var request = {};
            request[cName] = {};
            request[cName][docName] = v;
            _this.driver.bulkSubscribe(request, function(err, streams) {
              var streamsArg;
              if (streams && streams[cName]) {
                streamsArg = streams[cName][docName];
              }
              callback(err, streamsArg);
            });
          };
        });

        it('observes local changes', function(done) {
          var _this = this;
          this.create(function() {
            _this.subscribe('users', _this.docName, 1, {}, function(err, stream) {
              if (err) {
                throw new Error(err);
              }

              stream.once('data', function(op) {
                assert.deepEqual(op, createOp(1));
                stream.destroy();
                done();
              });
              _this.driver.atomicSubmit('users', _this.docName, createOp(1), {}, function() {});
            });
          });
        });

        it('sees ops when you observe an old version', function(done) {
          var _this = this;
          this.create(function() {
            _this.subscribe('users', _this.docName, 0, {}, function(err, stream) {
              stream.once('data', function(data) {
                assert.deepEqual(data, createOp());
                done();
              });
            });
          });
        });

        it('still works when you observe an old version', function(done) {
          var _this = this;
          this.create(function() {
            _this.subscribe('users', _this.docName, 0, {}, function(err, stream) {
              _this.driver.atomicSubmit('users', _this.docName, createOp(1), {}, function() {});
              stream.on('data', function(data) {
                if (data.v === 0) {
                  return;
                }

                assert.deepEqual(data, createOp(1));
                stream.destroy();
                done();
              });
            });
          });
        });

        it('can observe a document that doesnt exist yet', function(done) {
          var _this = this;
          this.subscribe('users', this.docName, 0, {}, function(err, stream) {
            stream.on('readable', function() {
              assert.deepEqual(stream.read(), createOp());
              stream.destroy();
              done();
            });
            _this.create();
          });
        });

        it('does not throw when you double stream.destroy', function(done) {
          var _this = this;
          this.subscribe('users', this.docName, 1, {}, function(err, stream) {
            stream.destroy();
            stream.destroy();
            done();
          });
        });

        // TODO Test skipped.
        it.skip('does not let you subscribe with a future version', function(done) {
          this.subscribe('users', this.docName, 100, {}, function(err, stream) {
            assert.strictEqual(err, 'Cannot subscribe to future version');
            assert.equal(stream, null);
            done();
          });
        });

        if (subType === 'bulk') {
          it('can handle bulkSubscribe on multiple docs with no ops', function(done) {
            var _this = this;
            this.create(function() {
              var req = {
                users: {}
              };
              req.users[_this.docName] = 0;
              req.users['does not exist'] = 0;
              _this.driver.bulkSubscribe(req, function(err, result) {
                if (err) {
                  throw Error(err);
                }

                assert.equal(Object.keys(result.users).length, 2);
                assert(result.users[_this.docName]);
                assert(result.users['does not exist']);

                for (var propertyName in result.users) {
                  result.users[propertyName].destroy();
                }

                done();
              });
            });
          });
        }
      });
    };

    subscribeTests('single');
    subscribeTests('bulk');
  });

  describe('distributed load', function() {
    if (distributed) {
      it('allows exactly one write across many clients to succeed', function(done) {
        this.timeout(5000);
        var numClients = 50;
        var _this = this;
        this.oplog.writeOp('users', 'seph', createOp(0), function(err) {
          if (err) {
            throw Error(err);
          }

          drivers = (function drivers() {
            var _i, _results;
            _results = [];
            for (_i = 0; 0 <= numClients ? _i < numClients : _i > numClients; 0 <= numClients ? _i++ : _i--) {
              _results.push(createDriver(this.oplog));
            }
            return _results;
          }).call(_this);

          var written = false;
          for (var i = 0; i < drivers.length; ++i) {
            var d = drivers[i];
            var submitCount = 0;
            var observeCount = 0;
            function doneWork(isSubmit) {
              if (submitCount === numClients && !written) {
                throw Error('Op not accepted anywhere');
              }

              if (submitCount === numClients && observeCount === numClients) {
                for (var j = 0; j < drivers.length; ++j) {
                  d = drivers[j];
                  destroyDriver(d);
                }
                _this.getOps('users', 'seph', 1, null, function(err, ops) {
                  if (err) {
                    throw Error(err);
                  }

                  assert.equal(ops.length, 1);
                  done();
                });
              }
            };

            (function(d, i) {
              setTimeout(function() {
                d.atomicSubmit('users', 'seph', {
                  v: 1,
                  op: ["driver " + i + " "]
                }, {}, function(err) {
                  if (err == null) {
                    if (written) {
                      throw Error('Multiple writes accepted');
                    }
                    written = true;
                  } else if (err !== 'Transform needed') {
                    throw Error(err);
                  }
                  submitCount++;
                  doneWork();
                });
              }, (100 * Math.random()) | 0);

              d.subscribe('users', 'seph', 1, {}, function(err, stream) {
                var read = null;
                stream.on('data', function(data) {
                  if (read) {
                    console.error(data, read);
                    throw Error("Duplicate reads");
                  }

                  read = data;
                  assert.strictEqual(data.v, 1);
                  assert.ok(data.op);
                  observeCount++;
                  doneWork();
                });
              });
            })(d, i);
          }
        });
      });
    }

    describe('memory leaks', function() {
      it('cleans up internal state after a subscription ends', function(done) {
        var _this = this;
        this.driver.subscribe('users', this.docName, 0, {}, function(err, stream1) {
          if (err) {
            throw Error(err);
          }

          _this.driver.atomicSubmit('users', _this.docName, createOp(0), {}, function(err) {
            if (err) {
              throw Error(err);
            }

            _this.driver.subscribe('users', _this.docName, 1, {}, function(err, stream2) {
              if (err) {
                throw Error(err);
              }

              stream1.destroy();
              stream2.destroy();
              _this.driver._checkForLeaks(false, done);
            });
          });
        });
      });

      it('cleans up after a bulkSubscribe', function(done) {
        var _this = this;
        this.create(function() {
            var req = {
              users: {}
            };
            req.users[_this.docName] = 0;
            req.users['does not exist'] = 0;

            _this.driver.bulkSubscribe(req, function(err, result) {
              if (err) {
                throw Error(err);
              }

              var propertyName;
              for (propertyName in result.users) {
                result.users[propertyName].destroy();
              }

              _this.driver._checkForLeaks(false, done);
            });
          });
      });
    });
  });
};
