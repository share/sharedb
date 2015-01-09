// This used to be the whole set of tests - now some of the ancillary parts of
// livedb have been pulled out. These tests should probably be split out into
// multiple files.

var livedb = require('../lib');
var assert = require('assert');
var textType = require('ot-text').type;

var util = require('./util');
var stripTs = util.stripTs;

var before = Date.now();
var after = before + 10 * 1000;

// Snapshots we get back from livedb will have a timestamp with a
// m:{ctime:, mtime:} with the current time. We'll check the time is sometime
// between when the module is loaded and 10 seconds later. This is a bit
// brittle. It also copies functionality in ot.coffee.
var checkAndStripMetadata = function(snapshot) {
  assert.ok(snapshot.m);
  if (snapshot.m.ctime) {
    assert.ok(before <= snapshot.m.ctime && snapshot.m.ctime < after);
  }
  assert.ok(before <= snapshot.m.mtime && snapshot.m.mtime < after);

  delete snapshot.m.ctime;
  delete snapshot.m.mtime;

  return snapshot;
};

describe('livedb', function() {
  beforeEach(util.setup);

  beforeEach(function() {
    this.cName = '_test';
    this.cName2 = '_test2';
    return this.cName3 = '_test3';
  });

  afterEach(util.teardown);

  describe('submit', function() {
    it('creates a doc', function(done) {
      this.collection.submit(this.docName, {
        v: 0,
        create: {
          type: 'text'
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }
        done();
      });
    });

    it('allows create ops with a null version', function(done) {
      this.collection.submit(this.docName, {
        v: null,
        create: {
          type: 'text'
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }
        done();
      });
    });

    it('errors if you dont specify a type', function(done) {
      this.collection.submit(this.docName, {
        v: 0,
        create: {}
      }, function(err) {
        assert.ok(err);
        done();
      });
    });

    it('can create a document with metadata', function(done) {
      var _this = this;
      this.collection.submit(this.docName, {
        v: 0,
        create: {
          type: 'text',
          m: {
            language: 'en'
          }
        }
      }, function(err, v) {
        if (err) {
          throw new Error(err);
        }

        _this.collection.fetch(_this.docName, function(err, data) {
          if (err) {
            throw new Error(err);
          }

          assert.equal(data.m.language, 'en');
          done();
        });
      });
    });

    it('removes metadata when documents are recreated', function(done) {
      var _this = this;
      this.collection.submit(this.docName, {
        create: {
          type: 'text',
          m: {
            language: 'en'
          }
        }
      }, function(err, v) {
        if (err) {
          throw new Error(err);
        }

        _this.collection.submit(_this.docName, {
          del: true
        }, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.submit(_this.docName, {
            create: {
              type: 'text'
            }
          }, function(err, v) {
            if (err) {
              throw new Error(err);
            }

            _this.collection.fetch(_this.docName, function(err, data) {
              if (err) {
                throw new Error(err);
              }

              assert.equal(data.m.language, null);
              done();
            });
          });
        });
      });
    });

    it('can modify a document', function(done) {
      var _this = this;
      this.create(function() {
        _this.collection.submit(_this.docName, {
          v: 1,
          op: ['hi']
        }, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.fetch(_this.docName, function(err, data) {
            if (err) {
              throw new Error(err);
            }

            assert.deepEqual(data.data, 'hi');
            done();
          });
        });
      });
    });

    it('transforms operations', function(done) {
      var _this = this;
      this.create(function() {
          _this.collection.submit(_this.docName, {
            v: 1,
            op: ['a'],
            src: 'abc',
            seq: 123
          }, function(err, v, ops) {
            if (err) {
              throw new Error(err);
            }

            assert.deepEqual(ops, []);
            _this.collection.submit(_this.docName, {
              v: 1,
              op: ['b']
            }, function(err, v, ops) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(stripTs(ops), [
                {
                  v: 1,
                  op: ['a'],
                  src: 'abc',
                  seq: 123,
                  m: {}
                }
              ]);

              done();
            });
          });
        });
    });

    it('allows ops with a null version', function(done) {
      var _this = this;
      this.create(function() {
        _this.collection.submit(_this.docName, {
          v: null,
          op: ['hi']
        }, function(err, v) {
          if (err) {
            throw new Error(err);
          }

           _this.collection.fetch(_this.docName, function(err, data) {
            if (err) {
              throw new Error(err);
            }

            assert.deepEqual(data.data, 'hi');
            done();
          });
        });
      });
    });

    it('removes a doc', function(done) {
      var _this = this;
      this.create(function() {
        _this.collection.submit(_this.docName, {
          v: 1,
          del: true
        }, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.fetch(_this.docName, function(err, data) {
            if (err) {
              throw new Error(err);
            }

            assert.equal(data.data, null);
            assert.equal(data.type, null);
            done();
          });
        });
      });
    });

    it('removes a doc and allows creation of a new one', function(done) {
      var _this = this;
      this.collection.submit(this.docName, {
        create: {
          type: 'text',
          data: 'world'
        }
      },  function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.collection.submit(_this.docName, {
          v: 1,
          del: true
        }, function(err, v) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.fetch(_this.docName, function(err, data) {
            if (err) {
              throw new Error(err);
            }

            assert.equal(data.data, null);
            assert.equal(data.type, null);
            _this.collection.submit(_this.docName, {
              create: {
                type: 'text',
                data: 'hello'
              }
            }, function(err) {
              if (err) {
                throw new Error(err);
              }

              _this.collection.fetch(_this.docName, function(err, data) {
                if (err) {
                  throw new Error(err);
                }

                assert.equal(data.data, 'hello');
                assert.equal(data.type, 'http://sharejs.org/types/textv1');
                done();
              });
            });
          });
        });
      });
    });

    // TODO: Not implemented.
    it('passes an error back to fetch if fetching returns a document with no version');

    it('will execute concurrent operations', function(done) {
      var _this = this;
      this.create(function() {
        var callback, count;
        count = 0;
        callback = function(err, v) {
          assert.equal(err, null);
          count++;
          if (count === 2) {
            return done();
          }
        };

        _this.collection.submit(_this.docName, {
          v: 1,
          src: 'abc',
          seq: 1,
          op: ['client 1']
        }, callback);

        _this.collection.submit(_this.docName, {
          v: 1,
          src: 'def',
          seq: 1,
          op: ['client 2']
        }, callback);
      });
    });

    it('sends operations to the persistant oplog', function(done) {
      var _this = this;
      this.create(function() {
        _this.db.getVersion(_this.cName, _this.docName, function(err, v) {
          if (err) {
            throw Error(err);
          }

          assert.strictEqual(v, 1);
          _this.db.getOps(_this.cName, _this.docName, 0, null, function(err, ops) {
            if (err) {
              throw Error(err);
            }

            assert.strictEqual(ops.length, 1);
            done();
          });
        });
      });
    });

    it('sends operations to any extra db backends', function(done) {
      var _this = this;
      this.testWrapper.submit = function(cName, docName, opData, options, snapshot, callback) {
        assert.equal(cName, _this.cName);
        assert.equal(docName, _this.docName);
        assert.deepEqual(stripTs(opData), {
          v: 0,
          create: {
            type: textType.uri,
            data: ''
          },
          m: {},
          src: ''
        });
        checkAndStripMetadata(snapshot);
        assert.deepEqual(snapshot, {
          v: 1,
          data: '',
          type: textType.uri,
          m: {}
        });
        done();
      };

      this.create();
    });

    describe('pre validate', function() {
      it('runs a supplied pre validate function on the data', function(done) {
        var validationRun = false;
        var preValidate = function(opData, snapshot) {
          assert.deepEqual(snapshot, {
            v: 0
          });
          validationRun = true;
        };

        this.collection.submit(this.docName, {
          v: 0,
          create: {
            type: 'text'
          },
          preValidate: preValidate
        }, function(err) {
          assert.ok(validationRun);
          done();
        });
      });

      it('does not submit if pre validation fails', function(done) {
        var _this = this;
        this.create(function() {
          var preValidate = function(opData, snapshot) {
            assert.deepEqual(opData.op, ['hi']);
            return 'no you!';
          };

          _this.collection.submit(_this.docName, {
            v: 1,
            op: ['hi'],
            preValidate: preValidate
          }, function(err) {
            assert.equal(err, 'no you!');
            _this.collection.fetch(_this.docName, function(err, data) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(data.data, '');
              done();
            });
          });
        });
      });

      // TODO: Not implemented.
      it('calls prevalidate on each component in turn, and applies them incrementally');
    });

    describe('validate', function() {
      it('runs a supplied validation function on the data', function(done) {
        var validationRun = false;
        var validate = function(opData, snapshot, callback) {
          checkAndStripMetadata(snapshot);
          assert.deepEqual(snapshot, {
            v: 1,
            data: '',
            type: textType.uri,
            m: {}
          });
          validationRun = true;
        };

        this.collection.submit(this.docName, {
          v: 0,
          create: {
            type: 'text'
          },
          validate: validate
        }, function(err) {
          assert.ok(validationRun);
          done();
        });
      });

      it('does not submit if validation fails', function(done) {
        var _this = this;
        this.create(function() {
          var validate = function(opData, snapshot, callback) {
            assert.deepEqual(opData.op, ['hi']);
            return 'no you!';
          };

          _this.collection.submit(_this.docName, {
            v: 1,
            op: ['hi'],
            validate: validate
          }, function(err) {
            assert.equal(err, 'no you!');
            _this.collection.fetch(_this.docName, function(err, data) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(data.data, '');
              done();
            });
          });
        });
      });

      // TODO: Not implemented.
      it('calls validate on each component in turn, and applies them incrementally');
    });

    describe('dirty data', function() {
      beforeEach(function() {
        var _this = this;
        this.checkConsume = function(list, expected, options, callback) {
          if (typeof options === 'function') {
            callback = options;
            options = {};
          }

          var called = false;
          var consume = function(data, callback) {
            assert(!called);
            called = true;
            assert.deepEqual(data, expected);
            callback();
          };

          _this.client.consumeDirtyData(list, options, consume, function(err) {
            if (err) {
              throw Error(err);
            }

            assert.equal(called, expected !== null);
            callback();
          });
        };
      });

      it('calls getDirtyDataPre and getDirtyData', function(done) {
        var _this = this;

        this.create(function() {
            var op = {
              v: 1,
              op: ['hi']
            };

            _this.client.getDirtyDataPre = function(c, d, op_, snapshot) {
              assert.equal(c, _this.cName);
              assert.equal(d, _this.docName);
              assert.deepEqual(op_, op);
              checkAndStripMetadata(snapshot);
              assert.deepEqual(snapshot, {
                v: 1,
                data: '',
                type: textType.uri,
                m: {}
              });

              return {
                a: 5
              };
            };

            _this.client.getDirtyData = function(c, d, op_, snapshot) {
              assert.equal(c, _this.cName);
              assert.equal(d, _this.docName);
              assert.deepEqual(op_, op);
              checkAndStripMetadata(snapshot);
              assert.deepEqual(snapshot, {
                v: 2,
                data: 'hi',
                type: textType.uri,
                m: {}
              });

              return {
                b: 6
              };
            };

            _this.collection.submit(_this.docName, op, function(err) {
              if (err) {
                throw Error(err);
              }

              _this.checkConsume('a', [5], function() {
                _this.checkConsume('b', [6], done);
              });
            });
          });
      });
    });
  });

  describe('fetch', function() {
    it('can fetch created documents', function(done) {
      var _this = this;
      this.create('hi', function() {
        _this.collection.fetch(_this.docName, function(err, data) {
          if (err) {
            throw new Error(err);
          }

          assert.deepEqual(data.data, 'hi');
          assert.strictEqual(data.v, 1);
          done();
        });
      });
    });
  });

  describe('bulk fetch', function() {
    it('can fetch created documents', function(done) {
      var _this = this;

      this.create('hi', function() {
        var request;
        request = {};
        request[_this.cName] = [_this.docName];
        _this.client.bulkFetch(request, function(err, data) {
          var cName, docName, docs, snapshot;
          if (err) {
            throw new Error(err);
          }

          var expected = {};
          expected[_this.cName] = {};
          expected[_this.cName][_this.docName] = {
            data: 'hi',
            v: 1,
            type: textType.uri,
            m: {}
          };

          for (cName in data) {
            docs = data[cName];
            for (docName in docs) {
              snapshot = docs[docName];
              checkAndStripMetadata(snapshot);
            }
          }

          assert.deepEqual(data, expected);
          done();
        });
      });
    });

    // TODO: Not implemented.
    it('can bulk fetch a projected document and actual document at the same time');


    it('doesnt return anything for missing documents', function(done) {
      var _this = this;
      this.create('hi', function() {
        var request;
        request = {};
        request[_this.cName] = ['doesNotExist'];
        _this.client.bulkFetch(request, function(err, data) {
          if (err) {
            throw new Error(err);
          }

          var expected = {};
          expected[_this.cName] = {
            doesNotExist: {
              v: 0
            }
          };
          assert.deepEqual(data, expected);
          done();
        });
      });
    });

    it('works with multiple collections', function(done) {
      // This test fetches a bunch of documents that don't exist, but whatever.
      var _this = this;
      this.create('hi', function() {
        var request = {
          aaaaa: [],
          bbbbb: ['a', 'b', 'c']
        };
        request[_this.cName] = [_this.docName];
        // Adding this afterwards to make sure @cName doesn't come last in native iteration order
        request.zzzzz = ['d', 'e', 'f'];

        _this.client.bulkFetch(request, function(err, data) {
          if (err) {
            throw new Error(err);
          }

          var expected = {
            aaaaa: {},
            bbbbb: {
              a: {
                v: 0
              },
              b: {
                v: 0
              },
              c: {
                v: 0
              }
            },
            zzzzz: {
              d: {
                v: 0
              },
              e: {
                v: 0
              },
              f: {
                v: 0
              }
            }
          };
          expected[_this.cName] = {};
          expected[_this.cName][_this.docName] = {
            data: 'hi',
            v: 1,
            type: textType.uri,
            m: {}
          };
          checkAndStripMetadata(data[_this.cName][_this.docName]);
          assert.deepEqual(data, expected);
          done();
        });
      });
    });
  });

  describe('getOps', function() {
    it('returns an empty list for nonexistant documents', function(done) {
      this.collection.getOps(this.docName, 0, -1, function(err, ops) {
        if (err) {
          throw new Error(err);
        }

        assert.deepEqual(ops, []);
        done();
      });
    });

    it('returns ops that have been submitted to a document', function(done) {
      var _this = this;
      this.create(function() {
        _this.collection.submit(_this.docName, {
          v: 1,
          op: ['hi']
        }, function(err, v) {
          _this.collection.getOps(_this.docName, 0, 1, function(err, ops) {
            if (err) {
              throw new Error(err);
            }

            assert.deepEqual(stripTs(ops), [
              {
                create: {
                  type: textType.uri,
                  data: ''
                },
                v: 0,
                m: {},
                src: ''
              }
            ]);

            _this.collection.getOps(_this.docName, 1, 2, function(err, ops) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(stripTs(ops), [
                {
                  op: ['hi'],
                  v: 1,
                  m: {},
                  src: ''
                }
              ]);
              done();
            });
          });
        });
      });
    });

    it('puts a decent timestamp in ops', function(done) {
      var start = Date.now();
      var _this = this;

      this.create(function() {
        var end = Date.now();
        _this.collection.getOps(_this.docName, 0, function(err, ops) {
          if (err) {
            throw Error(err);
          }

          assert.equal(ops.length, 1);
          assert(ops[0].m.ts >= start);
          assert(ops[0].m.ts <= end);
          done();
        });
      });
    });

    it('puts a decent timestamp in ops which already have a m:{} field', function(done) {
      var start = Date.now();
      var _this = this;

      this.collection.submit(this.docName, {
        v: 0,
        create: {
          type: 'text'
        },
        m: {}
      }, function(err) {
        if (err) {
          throw Error(err);
        }

        _this.collection.submit(_this.docName, {
          v: 1,
          op: ['hi there'],
          m: {
            ts: 123
          }
        }, function(err) {
          if (err) {
            throw Error(err);
          }

          var end = Date.now();
          _this.collection.getOps(_this.docName, 0, function(err, ops) {
            var op;
            if (err) {
              throw Error(err);
            }

            assert.equal(ops.length, 2);
            for (var i = 0, len = ops.length; i < len; i++) {
              op = ops[i];
              assert(op.m.ts >= start);
              assert(op.m.ts <= end);
            }
            done();
          });
        });
      });
    });

    it('returns all ops if to is not defined', function(done) {
      var _this = this;
      this.create(function() {
        _this.collection.getOps(_this.docName, 0, function(err, ops) {
          if (err) {
            throw new Error(err);
          }
          assert.deepEqual(stripTs(ops), [
            {
              create: {
                type: textType.uri,
                data: ''
              },
              v: 0,
              m: {},
              src: ''
            }
          ]);
          _this.collection.submit(_this.docName, {
            v: 1,
            op: ['hi']
          }, function(err, v) {
            _this.collection.getOps(_this.docName, 0, function(err, ops) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(stripTs(ops), [
                {
                  create: {
                    type: textType.uri,
                    data: ''
                  },
                  v: 0,
                  m: {},
                  src: ''
                }, {
                  op: ['hi'],
                  v: 1,
                  m: {},
                  src: ''
                }
              ]);

              done();
            });
          });
        });
      });
    });

    // TODO: Not implemented.
    it('errors if ops are missing from the snapshotdb and oplogs');

    it('works with separate clients', function(done) {
      var _this = this;

      this.create(function() {
        if (!_this.driver.distributed) {
          return done();
        }

        var numClients = 10;
        var clients = [];

        // We have to share the database here because these tests are written
        // against the memory API, which doesn't share data between instances.
        for (var i = 0; 0 <= numClients ? i < numClients : i > numClients; 0 <= numClients ? i++ : i--) {
          clients.push(util.createClient(this.db));
        }

        for (var i = 0, len = clients.length; i < len; ++i) {
          var c = clients[i];
          c.client.submit(_this.cName, _this.docName, {
            v: 1,
            op: ["client " + i + " "]
          }, function(err) {
            if (err) {
              throw new Error(err);
            }
          });
        }

        _this.collection.subscribe(_this.docName, 1, function(err, stream) {
          // We should get numClients ops on the stream, in order.
          var seq, tryRead;
          if (err) {
            throw new Error(err);
          }

          seq = 1;
          stream.on('readable', tryRead = function() {
            var data = stream.read();

            if (!data) {
              return;
            }

            delete data.op;
            assert.deepEqual(stripTs(data), {
              v: seq,
              m: {}
            });

            if (seq === numClients) {
              stream.destroy();
              var c;
              for (var i = 0, len = clients.length; i < len; ++i) {
                c = clients[i];
                c.redis.quit();
                c.db.close();
              }
              done();
            } else {
              seq++;
            }

            tryRead();
          });
        });
      });
    });
  });

  // TODO: Not implemented.
  it('Fails to apply an operation to a document that was deleted and recreated');
});
