var livedb = require('../lib');
var assert = require('assert');
var normalizeType = require('../lib/ot').normalizeType;
var json0 = normalizeType('json0');
var util = require('./util');
var projections = require('../lib/projections');

var stripTs = util.stripTs;
var projectSnapshot = projections.projectSnapshot;
var projectOpData = projections.projectOpData;
var isSnapshotAllowed = projections.isSnapshotAllowed;
var isOpDataAllowed = projections.isOpDataAllowed;

function read(stream, callback) {
  var endListener;
  var d = stream.read();

  if (d != null) {
    return callback(null, d);
  }

  stream.once('end', endListener = function() {
    return callback('Stream ended before reading finished');
  });

  stream.once('readable', function() {
    stream.removeListener('end', endListener);

    d = stream.read();
    if (d != null) {
      callback(null, d);
    } else {
      callback('Stream ended before reading finished');
    }
  });
};

function readN(stream, n, callback) {
  var buffer = [];

  function more(err, data) {
    if (err) {
      return callback(err);
    }

    buffer.push(data);
    if (buffer.length === n) {
      return callback(null, buffer);
    }

    return read(stream, more);
  };

  if (n === 0) {
    return callback(null, []);
  } else {
    return read(stream, more);
  }
};

describe('stream utility methods', function() {
  var Readable = require('stream').Readable;

  beforeEach(function() {
    this.s = new Readable({
      objectMode: true
    });
    this.s._read = function() {};
  });

  it('works asyncronously', function(done) {
    this.s.push('hi');
    this.s.push('there');

    readN(this.s, 3, function(err, data) {
      if (err) {
        throw Error(err);
      }

      assert.deepEqual(data, ['hi', 'there', 'floof']);
      done();
    });

    var _this = this;
    setTimeout(function() {
      _this.s.push('floof');
      _this.s.push(null);
    });
  });
});

describe('projection utility methods', function() {
  describe('projectSnapshot', function() {
    it('filters properties', function() {
      assert.deepEqual({}, projectSnapshot(json0, {}, {}));

      assert.deepEqual({}, projectSnapshot(json0, {
        x: true
      }, {}));

      assert.deepEqual({}, projectSnapshot(json0, {
        x: true
      }, {
        a: 2
      }));

      assert.deepEqual({
        x: 2
      }, projectSnapshot(json0, {
        x: true
      }, {
        x: 2
      }));

      assert.deepEqual({
        x: [1, 2, 3]
      }, projectSnapshot(json0, {
        x: true
      }, {
        x: [1, 2, 3]
      }));

      assert.deepEqual({
        x: 5
      }, projectSnapshot(json0, {
        x: true
      }, {
        a: 2,
        x: 5
      }));

      assert.deepEqual(null, projectSnapshot(json0, {
        x: true
      }, []));

      assert.deepEqual(null, projectSnapshot(json0, {
        x: true
      }, 4));

      assert.deepEqual(null, projectSnapshot(json0, {
        x: true
      }, "hi"));
    });
  });

  describe('projectOpData', function() {
    it('passes src/seq into the projected op', function() {
      var op = {
        src: 'src',
        seq: 123,
        op: []
      };

      assert.deepEqual(op, projectOpData(json0, {}, op));
    });

    describe('op', function() {
      beforeEach(function() {
        this.op = function(fields, input, expected) {
          if (expected == null) {
            expected = input;
          }

          assert.deepEqual({
            op: expected
          }, projectOpData(json0, fields, {
            op: input
          }));
        };
      });

      it('filters components on the same level', function() {
        this.op({}, []);

        this.op({}, [
          {
            p: ['x'],
            na: 1
          }
        ], []);

        this.op({
          x: true
        }, [
          {
            p: ['x'],
            na: 1
          }
        ]);

        this.op({
          y: true
        }, [
          {
            p: ['x'],
            na: 1
          }
        ], []);

        this.op({
          x: true,
          y: true
        }, [
          {
            p: ['x'],
            od: 2,
            oi: 3
          }, {
            p: ['y'],
            na: 1
          }
        ]);
      });

      it('filters root ops', function() {
        this.op({}, [
          {
            p: [],
            od: {
              a: 1,
              x: 2
            },
            oi: {
              x: 3
            }
          }
        ], [
          {
            p: [],
            od: {},
            oi: {}
          }
        ]);

        this.op({
          x: true
        }, [
          {
            p: [],
            od: {
              a: 1,
              x: 2
            },
            oi: {
              x: 3
            }
          }
        ], [
          {
            p: [],
            od: {
              x: 2
            },
            oi: {
              x: 3
            }
          }
        ]);

        this.op({
          x: true
        }, [
          {
            p: [],
            od: {
              a: 1,
              x: 2
            },
            oi: {
              z: 3
            }
          }
        ], [
          {
            p: [],
            od: {
              x: 2
            },
            oi: {}
          }
        ]);

        this.op({
          x: true,
          a: true,
          z: true
        }, [
          {
            p: [],
            od: {
              a: 1,
              x: 2
            },
            oi: {
              z: 3
            }
          }
        ]);

        // If you make the document something other than an object, it just looks like null.
        this.op({
          x: true
        }, [
          {
            p: [],
            od: {
              a: 2,
              x: 5
            },
            oi: []
          }
        ], [
          {
            p: [],
            od: {
              x: 5
            },
            oi: null
          }
        ]);

        this.op({
          x: true
        }, [
          {
            p: [],
            na: 5
          }
        ], []);
      });

      it('allows editing in-property fields', function() {
        this.op({}, [
          {
            p: ['x', 'y'],
            na: 1
          }
        ], []);

        this.op({
          x: true
        }, [
          {
            p: ['x', 'y'],
            na: 1
          }
        ]);

        this.op({
          x: true
        }, [
          {
            p: ['x'],
            na: 1
          }
        ]);

        this.op({
          y: true
        }, [
          {
            p: ['x', 'y'],
            na: 1
          }
        ], []);
      });
    });

    describe('create', function() {
      it('does not tell projections about operations that create the doc with the wrong type', function() {
        assert.deepEqual({}, projectOpData(json0, {
          x: true
        }, {
          create: {
            type: 'other'
          }
        }));

        assert.deepEqual({}, projectOpData(json0, {
          x: true
        }, {
          create: {
            type: 'other',
            data: 123
          }
        }));
      });

      it('strips data in creates', function() {
        assert.deepEqual({
          create: {
            type: json0,
            data: {
              x: 10
            }
          }
        }, projectOpData(json0, {
          x: true
        }, {
          create: {
            type: json0,
            data: {
              x: 10
            }
          }
        }));

        assert.deepEqual({
          create: {
            type: json0,
            data: {}
          }
        }, projectOpData(json0, {
          x: true
        }, {
          create: {
            type: json0,
            data: {
              y: 10
            }
          }
        }));
      });
    });

    describe('isSnapshotAllowed', function() {
      it('returns true iff projectSnapshot returns the original object', function() {
        function t(fields, data) {
          if (isSnapshotAllowed(json0, fields, data)) {
            assert.deepEqual(data, projectSnapshot(json0, fields, data));
          } else {
            assert.notDeepEqual(data, projectSnapshot(json0, fields, data));
          }
        };

        t({
          x: true
        }, {
          x: 5
        });

        t({}, {
          x: 5
        });

        t({
          x: true
        }, {
          x: {
            y: true
          }
        });

        t({
          y: true
        }, {
          x: {
            y: true
          }
        });

        t({
          x: true
        }, {
          x: 4,
          y: 6
        });
      });

      it('returns false for any non-object thing', function() {
        assert.strictEqual(false, isSnapshotAllowed(json0, {}, null));
        assert.strictEqual(false, isSnapshotAllowed(json0, {}, 3));
        assert.strictEqual(false, isSnapshotAllowed(json0, {}, []));
        assert.strictEqual(false, isSnapshotAllowed(json0, {}, "hi"));
      });
    });

    describe('isOpDataAllowed', function() {
      it('works with create ops', function() {
        assert.equal(true, isOpDataAllowed(null, {}, {
          create: {
            type: json0
          }
        }));

        assert.equal(true, isOpDataAllowed(null, {
          x: true
        }, {
          create: {
            type: json0
          }
        }));

        assert.equal(false, isOpDataAllowed(null, {
          x: true
        }, {
          create: {
            type: "something else"
          }
        }));

        assert.equal(true, isOpDataAllowed(null, {
          x: true
        }, {
          create: {
            type: json0,
            data: {}
          }
        }));

        assert.equal(true, isOpDataAllowed(null, {
          x: true
        }, {
          create: {
            type: json0,
            data: {
              x: 5
            }
          }
        }));

        assert.equal(false, isOpDataAllowed(null, {
          x: true
        }, {
          create: {
            type: json0,
            data: {
              y: 5
            }
          }
        }));
      });

      it('works with del ops', function() {
        // Del should always be allowed
        assert.equal(true, isOpDataAllowed(null, {}, {
          del: true
        }));
      });

      it('works with ops', function() {
        function t(expected, fields, op, type) {
          if (type == null) {
            type = json0;
          }
          assert.equal(expected, isOpDataAllowed(type, fields, {
            op: op
          }));
        };

        t(true, {
          x: true
        }, [
          {
            p: ['x'],
            na: 1
          }
        ]);

        t(false, {
          y: true
        }, [
          {
            p: ['x'],
            na: 1
          }
        ]);

        t(false, {}, [
          {
            p: ['x'],
            na: 1
          }
        ]);

        t(false, {
          x: true
        }, [
          {
            p: ['x'],
            na: 1
          }, {
            p: ['y'],
            na: 1
          }
        ]);

        t(false, {
          x: true
        }, [
          {
            p: [],
            oi: {}
          }
        ]);
      });
    });
  });
});

describe('projections', function() {
  beforeEach(util.setup);

  beforeEach(function() {
    this.proj = '_proj';

    this.client.addProjection(this.proj, this.cName, 'json0', {
      x: true,
      y: true,
      z: true
    });

    this.create = function(data, cb) {
      if (typeof data === 'function') {
        data = {};
        cb = data;
      }

      return this.createDoc(this.docName, data, cb);
    };
  });

  afterEach(util.teardown);

  describe('fetch', function() {
    it('returns projected data through fetch()', function(done) {
      var _this = this;
      this.create({
        a: 1,
        b: false,
        x: 5,
        y: false
      }, function() {
        _this.client.fetch(_this.proj, _this.docName, function(err, snapshot) {
          assert.deepEqual(snapshot.data, {
            x: 5,
            y: false
          });

          done();
        });
      });
    });

    it('Uses getSnapshotProjected if it exists', function(done) {
      this.db.getSnapshot = function() {
        throw Error('db.getSnapshot should not be called');
      };

      var _this = this;
      this.db.getSnapshotProjected = (function(cName, docName, fields, callback) {
        assert.equal(cName, _this.cName);
        assert.equal(docName, _this.docName);
        assert.deepEqual(fields, {
          x: true,
          y: true,
          z: true
        });
        return callback(null, {
          v: 1,
          type: normalizeType('json0'),
          data: {
            x: 5
          }
        });
      });

      this.client.fetch(this.proj, this.docName, function(err, snapshot) {
        assert.deepEqual(snapshot.data, {
          x: 5
        });

        done();
      });
    });
  });

  describe('ops', function() {
    it('filters ops from getOps', function(done) {
      // This op should be a nice interesting mix of things, but this is not exhaustive. There are
      // other tests to make sure that projected ops work correctly.
      var _this = this;
      this.create({
        a: 1,
        x: {},
        y: 2
      }, function() {
        var op = [
          {
            p: ['b'],
            oi: 3
          }, {
            p: ['y'],
            na: 1
          }, {
            p: ['z'],
            oi: 4
          }, {
            p: ['x', 'seph'],
            oi: 'super'
          }
        ];

        _this.client.submit(_this.cName, _this.docName, {
          v: 1,
          op: op
        }, function(err, v) {
          if (err) {
            throw Error(err);
          }

          _this.client.getOps(_this.proj, _this.docName, 0, 2, function(err, ops) {
            if (err) {
              throw Error(err);
            }

            stripTs(ops);
            assert.equal(ops.length, 2);
            assert.deepEqual(ops[0], {
              v: 0,
              create: {
                type: json0,
                data: {
                  x: {},
                  y: 2
                }
              },
              m: {},
              src: ''
            });

            assert.deepEqual(ops[1], {
              v: 1,
              op: [
                {
                  p: ['y'],
                  na: 1
                }, {
                  p: ['z'],
                  oi: 4
                }, {
                  p: ['x', 'seph'],
                  oi: 'super'
                }
              ],
              m: {},
              src: ''
            });

            done();
          });
        });
      });
    });

    it('filters ops through subscriptions', function(done) {
      var _this = this;
      this.create({
        a: 1,
        x: 2,
        y: 2
      }, function() {
        _this.client.submit(_this.cName, _this.docName, {
          v: 1,
          op: [
            {
              p: ['x'],
              na: 1
            }, {
              p: ['a'],
              na: 1
            }
          ]
        }, function(err) {
          if (err) {
            throw Error(err);
          }
          _this.client.subscribe(_this.proj, _this.docName, 0, function(err, stream) {
            if (err) {
              throw Error(err);
            }

            _this.client.submit(_this.cName, _this.docName, {
              v: 2,
              op: [
                {
                  p: ['y'],
                  na: 1
                }, {
                  p: ['a'],
                  na: 1
                }
              ]
            }, function(err) {
              var expected = [
                {
                  v: 0,
                  m: {},
                  create: {
                    type: json0,
                    data: {
                      x: 2,
                      y: 2
                    }
                  },
                  src: ''
                }, {
                  v: 1,
                  m: {},
                  op: [
                    {
                      p: ['x'],
                      na: 1
                    }
                  ],
                  src: ''
                }, {
                  v: 2,
                  m: {},
                  op: [
                    {
                      p: ['y'],
                      na: 1
                    }
                  ],
                  src: ''
                }
              ];

              readN(stream, 3, function(err, data) {
                stripTs(data);
                assert.deepEqual(data, expected);
                stream.destroy();
                _this.client.driver._checkForLeaks(false, done);
              });
            });
          });
        });
      });
    });

    it('filters ops through bulk subscriptions', function(done) {
      var _this = this;
      this.createDoc('one', {
        a: 1,
        x: 2,
        y: 3
      }, function() {
         _this.createDoc('two', {
          a: 1,
          x: 2,
          y: 3
        }, function() {
          var req = {};
          req[_this.cName] = {
            one: 0,
            two: 1
          };
          req[_this.proj] = {
            one: 0,
            two: 1
          };

          _this.client.bulkSubscribe(req, function(err, result) {
            if (err) {
              throw Error(err);
            }

            var n = 4;

            function passPart() {
              if (--n === 0) {
                return done();
              }
            };

            function expectOp(stream, expected) {
              return read(stream, function(err, op) {
                op = stripTs(op);
                assert.deepEqual(op, expected);
                return passPart();
              });
            };

            expectOp(result[_this.cName].one, {
              v: 0,
              create: {
                type: json0,
                data: {
                  a: 1,
                  x: 2,
                  y: 3
                }
              },
              m: {},
              src: ''
            });

            expectOp(result[_this.proj].one, {
              v: 0,
              create: {
                type: json0,
                data: {
                  x: 2,
                  y: 3
                }
              },
              m: {},
              src: ''
            });

            expectOp(result[_this.cName].two, {
              v: 1,
              op: [
                {
                  p: ['a'],
                  na: 1
                }
              ],
              m: {},
              src: ''
            });

            expectOp(result[_this.proj].two, {
              v: 1,
              op: [],
              m: {},
              src: ''
            });

            _this.client.submit(_this.cName, 'two', {
              op: [
                {
                  p: ['a'],
                  na: 1
                }
              ]
            });
          });
        });
      });
    });

    it('does not modify the request in a bulkSubscribe when there are projections', function(done) {
      var _this = this;
      this.createDoc('one', {
        a: 1,
        x: 2,
        y: 3
      }, function() {
          _this.createDoc('two', {
            a: 1,
            x: 2,
            y: 3
          }, function() {
            var req = {};
            req[_this.cName] = {
              one: 0,
              two: 1
            };
            req[_this.proj] = {
              one: 0,
              two: 1
            };

            var reqAfter = JSON.parse(JSON.stringify(req));

            _this.client.bulkSubscribe(req, function(err, result) {
              assert.deepEqual(req, reqAfter);
              done();
            });
          });
        });
    });

    it('does not leak memory when bulk subscribing', function(done) {
      var _this = this;
      this.createDoc('one', {
        a: 1,
        x: 2,
        y: 3
      }, function() {
        _this.createDoc('two', {
          a: 1,
          x: 2,
          y: 3
        }, function() {
          var req = {};
          req[_this.cName] = {
            one: 0,
            two: 1
          };
          req[_this.proj] = {
            one: 0,
            two: 1
          };

          _this.client.bulkSubscribe(req, function(err, result) {
            if (err) {
              throw Error(err);
            }

            var stream, propertyName;
            for (propertyName in result[_this.cName]) {
              stream = result[_this.cName][propertyName];
              stream.destroy();
            }

            for (propertyName in result[_this.proj]) {
              stream = result[_this.proj][propertyName];
              stream.destroy();
            }

            _this.client.driver._checkForLeaks(false, done);
          });
        });
      });
    });
  });

  describe('submit', function() {
    it('rewrites submit on a projected query to apply to the original collection', function(done) {
      var realOps = [
        {
          create: {
            type: json0,
            data: {
              x: 1
            }
          },
          v: 0,
          m: {},
          src: 'src',
          seq: 1
        }, {
          v: 1,
          op: [
            {
              p: ['x'],
              na: 1
            }
          ],
          v: 1,
          m: {},
          src: 'src',
          seq: 2
        }, {
          del: true,
          v: 2,
          m: {},
          src: 'src2',
          seq: 1
        }
      ];

      var _this = this;
      this.client.subscribe(this.proj, this.docName, 0, function(err, projStream) {
        if (err) {
          throw Error(err);
        }

        _this.client.subscribe(_this.cName, _this.docName, 0, function(err, origStream) {
          if (err) {
            throw Error(err);
          }

          _this.client.submit(_this.proj, _this.docName, realOps[0], function(err) {
            if (err) {
              throw Error(err);
            }

            _this.client.submit(_this.proj, _this.docName, realOps[1], function(err) {
              if (err) {
                throw Error(err);
              }

              _this.client.submit(_this.proj, _this.docName, realOps[2], function(err) {
                if (err) {
                  throw Error(err);
                }

                readN(projStream, 3, function(err, ops) {
                  if (err) {
                    throw Error(err);
                  }

                  stripTs(ops);
                  assert.deepEqual(ops, realOps);
                  readN(origStream, 3, function(err, ops) {
                    if (err) {
                      throw Error(err);
                    }

                    stripTs(ops);
                    assert.deepEqual(ops, realOps);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    it('does not allow op submit outside of the projection', function(done) {
      var _this = this;
      function checkSubmitFails(op, cb) {
        var v = op.v;
        _this.client.submit(_this.proj, _this.docName, op, function(err) {
          assert.ok(err);
          _this.client.getOps(_this.proj, _this.docName, v, null, function(err, ops) {
            if (err) {
              throw Error(err);
            }

            assert.equal(ops.length, 0);
            _this.client.getOps(_this.cName, _this.docName, v, null, function(err, ops) {
              if (err) {
                throw Error(err);
              }

              assert.equal(ops.length, 0);
              cb();
            });
          });
        });
      };

      checkSubmitFails({
        create: {
          type: json0,
          data: {
            a: 1
          }
        },
        v: 0,
        m: {}
      }, function() {
        _this.create({
          a: 1
        }, function() {
          checkSubmitFails({
            v: 1,
            op: [
              {
                p: ['a'],
                na: 1
              }
            ],
            v: 1,
            m: {}
          }, function() {
            done();
          });
        });
      });
    });
  });

  describe('queries', function() {

    it('does not return any results in the projected collection if its empty', function(done) {
      this.client.queryFetch(this.proj, null, {}, function(err, results) {
        if (err) {
          throw Error(err);
        }

        assert.deepEqual(results, []);
        done();
      });
    });

    it('projects data returned by queryFetch', function(done) {
      var _this = this;
      this.createDoc('aaa', {
        a: 5,
        x: 3
      }, function() {
        _this.createDoc('bbb', {
          x: 3
        }, function() {
          _this.createDoc('ccc', {}, function() {
            _this.client.queryFetch(_this.proj, null, {}, function(err, results) {
              if (err) {
                throw Error(err);
              }

              results.sort(function(a, b) {
                if (b.docName > a.docName) {
                  return -1;
                } else {
                  return 1;
                }
              });

              assert.deepEqual(results, [
                {
                  v: 1,
                  type: json0,
                  docName: 'aaa',
                  data: {
                    x: 3
                  }
                }, {
                  v: 1,
                  type: json0,
                  docName: 'bbb',
                  data: {
                    x: 3
                  }
                }, {
                  v: 1,
                  type: json0,
                  docName: 'ccc',
                  data: {}
                }
              ]);

              done();
            });
          });
        });
      });
    });

    it('projects data returned my queryFetch when extra data is emitted', function(done) {
      var _this = this;
      this.db.query = function(liveDb, index, query, options, callback) {
        assert.deepEqual(index, _this.cName);
        callback(null, {
          results: [
            {
              docName: _this.docName,
              data: {
                a: 6,
                x: 5
              },
              type: json0,
              v: 1
            }
          ],
          extra: 'Extra stuff'
        });
      };

      this.client.queryFetch(this.proj, null, {}, function(err, results) {
        if (err) {
          throw Error(err);
        }

        assert.deepEqual(results, [
          {
            docName: _this.docName,
            data: {
              x: 5
            },
            type: json0,
            v: 1
          }
        ]);

        done();
      });
    });

    it('uses the database projection function for queries if it exists', function(done) {
      this.db.query = function(a, b, c, d, e) {
        throw Error('db.query should not be called');
      };

      var _this = this;
      this.db.queryProjected = function(liveDb, index, fields, query, options, callback) {
        assert.equal(liveDb, _this.client);

        assert.equal(index, _this.cName);

        assert.deepEqual(fields, {
          x: true,
          y: true,
          z: true
        });

        assert.equal(query, "cool cats");

        assert.deepEqual(options, {
          mode: 'fetch'
        });

        callback(null, [
          {
            docName: _this.docName,
            data: {
              x: 5
            },
            type: json0,
            v: 1
          }
        ]);
      };

      this.client.queryFetch(this.proj, 'cool cats', {}, function(err, results) {
        if (err) {
          throw Error(err);
        }

        assert.deepEqual(results, [
          {
            docName: _this.docName,
            data: {
              x: 5
            },
            type: json0,
            v: 1
          }
        ]);

        done();
      });
    });

    function queryPollTests(poll) {
      describe("poll:" + poll, function() {
        var opts = {
          poll: poll,
          pollDelay: 0
        };

        it('projects data returned by queryPoll', function(done) {
          var _this = this;
          this.createDoc('aaa', {
            a: 5,
            x: 3
          }, function() {
            _this.createDoc('bbb', {
              x: 3
            }, function() {
              _this.createDoc('ccc', {}, function() {
                _this.client.queryPoll(_this.proj, null, opts, function(err, emitter) {
                  if (err) {
                    throw Error(err);
                  }

                  var results = emitter.data;
                  results.sort(function(a, b) {
                    if (b.docName > a.docName) {
                      return -1;
                    } else {
                      return 1;
                    }
                  });

                  assert.deepEqual(results, [
                    {
                      v: 1,
                      type: json0,
                      c: _this.proj,
                      docName: 'aaa',
                      data: {
                        x: 3
                      }
                    }, {
                      v: 1,
                      type: json0,
                      c: _this.proj,
                      docName: 'bbb',
                      data: {
                        x: 3
                      }
                    }, {
                      v: 1,
                      type: json0,
                      c: _this.proj,
                      docName: 'ccc',
                      data: {}
                    }
                  ]);

                  done();
                });
              });
            });
          });
        });

        it('projects data returned by queryPoll in a diff', function(done) {
          var _this = this;
          this.client.queryPoll(this.proj, 'unused', opts, function(err, emitter) {
            if (err) {
              throw Error(err);
            }

            assert.deepEqual(emitter.data, []);
            emitter.on('diff', function(stuff) {
              delete stuff[0].values[0].m;
              assert.deepEqual(stuff, [
                {
                  type: 'insert',
                  index: 0,
                  values: [
                    {
                      v: 1,
                      data: {
                        x: 5
                      },
                      type: json0,
                      docName: _this.docName,
                      c: _this.proj
                    }
                  ]
                }
              ]);

              done();
            });

            _this.create({
              x: 5,
              a: 1
            });
          });
        });
      });
    };

    queryPollTests(false);
    queryPollTests(true);

    it('calls db.queryDocProjected if it exists', function(done) {
      var called = false;
      this.db.queryDoc = function() {
        throw Error('db.queryDoc should not be called');
      };

      var _this = this;
      this.db.queryDocProjected = function(liveDb, index, cName, docName, fields, query, callback) {
        called = true;

        callback(null, {
          v: 1,
          data: {
            x: 5
          },
          type: json0,
          docName: _this.docName,
          c: _this.proj
        });
      };

      this.client.queryPoll(this.proj, 'unused', {
        poll: false
      }, function(err, emitter) {
        if (err) {
          throw Error(err);
        }

        assert.deepEqual(emitter.data, []);
        emitter.on('diff', function(stuff) {
          assert(called);
          done();
        });

        _this.create({
          x: 5,
          a: 1
        });
      });
    });
  });
});
