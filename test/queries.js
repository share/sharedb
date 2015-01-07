var assert = require('assert');
var sinon = require('sinon');
var json0 = require('ot-json0').type;
var text = require('ot-text').type;
var util = require('./util');

describe('queries', function() {
  beforeEach(util.setup);

  beforeEach(function() {
    this.cName = '_test';
    this.cName2 = '_test2';
    this.cName3 = '_test3';
  });

  beforeEach(function() {
    sinon.stub(this.db, 'queryNeedsPollMode', function() {
      return false;
    });
  });

  afterEach(util.teardown);

  afterEach(function() {
    if (this.db.query.restore) {
      this.db.query.restore();
    }

    if (this.db.queryDoc.restore) {
      this.db.queryDoc.restore();
    }

    if (this.db.queryNeedsPollMode.restore) {
      this.db.queryNeedsPollMode.restore();
    }
  });

  var pollDependentTests = function(poll) {
    describe("poll:" + poll, function() {
      var opts = null;

      beforeEach(function() {
        opts = {
          poll: poll,
          pollDelay: 0
        };
      });

      it('returns the error from the query', function(done) {
        sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
          cb('Something went wrong');
        });

        var _this = this;
        this.collection.queryPoll({}, opts, function(err, emitter) {
          assert.equal(err, 'Something went wrong');
          done();
        });
      });

      it('passes the right arguments to db.query', function(done) {
        var _this = this;

        sinon.spy(this.db, 'query');
        this.collection.queryPoll({
          'x': 5
        },
        opts,
        function(err, emitter) {
          assert(_this.db.query.calledWith(_this.client, _this.cName, {
            'x': 5
          }));
          done();
        });
      });

      it('returns a result it already applies to', function(done) {
        var expected = [
          {
            docName: this.docName,
            data: {
              x: 5
            },
            type: json0.uri,
            v: 1,
            c: this.cName
          }
        ];

        sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
          cb(null, expected);
        });

        var _this = this;
        this.collection.queryPoll({
          'x': 5
        }, opts, function(err, emitter) {
          assert.deepEqual(emitter.data, expected);
          emitter.destroy();
          done();
        });
      });

      it('gets an empty result set when you query something with no results', function(done) {
        sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
          cb(null, []);
        });

        this.collection.queryPoll({
          'xyz': 123
        }, opts, function(err, emitter) {
          assert.deepEqual(emitter.data, []);
          emitter.on('diff', function() {
            throw new Error('should not have added results');
          });
          process.nextTick(function() {
            emitter.destroy();
            done();
          });
        });
      });

      it('adds an element when it matches', function(done) {
        var result = {
          c: this.cName,
          docName: this.docName,
          v: 1,
          data: {
            x: 5
          },
          type: json0.uri
        };

        var _this = this;
        this.collection.queryPoll({
          'x': 5
        },
        opts,
        function(err, emitter) {
          emitter.on('diff', function(diff) {
            assert.deepEqual(diff, [
              {
                index: 0,
                values: [result],
                type: 'insert'
              }
            ]);
            emitter.destroy();
            done();
          });

          sinon.stub(_this.db, 'query', function(db, index, query, options, cb) {
            cb(null, [result]);
          });

          sinon.stub(_this.db, 'queryDoc', function(db, index, cName, docName, query, cb) {
            cb(null, result);
          });

          _this.create({
            x: 5
          });
        });
      });

      it('remove an element that no longer matches', function(done) {
        var _this = this;

        this.create({
          x: 5
        }, function() {
          _this.collection.queryPoll({
            'x': 5
          },
          opts,
          function(err, emitter) {
            emitter.on('diff', function(diff) {
              assert.deepEqual(diff, [
                {
                  type: 'remove',
                  index: 0,
                  howMany: 1
                }
              ]);
              process.nextTick(function() {
                assert.deepEqual(emitter.data, []);
                emitter.destroy();
                done();
              });
            });

            var op = {
              op: 'rm',
              p: []
            };

            sinon.stub(_this.db, 'query', function(db, index, query, options, cb) {
              cb(null, []);
            });

            sinon.stub(_this.db, 'queryDoc', function(db, index, cName, docName, query, cb) {
              cb(null, false);
            });

            _this.collection.submit(_this.docName, {
              v: 1,
              op: [
                {
                  p: ['x'],
                  od: 5,
                  oi: 6
                }
              ]
            },
            function(err, v) {});
          });
        });
      });

      it('removes deleted elements', function(done) {
        var _this = this;

        this.create({
          x: 5
        }, function() {
          _this.collection.queryPoll({
            'x': 5
          },
          opts,
          function(err, emitter) {
            assert.strictEqual(emitter.data.length, 1);
            emitter.on('diff', function(diff) {
              assert.deepEqual(diff, [
                {
                  type: 'remove',
                  index: 0,
                  howMany: 1
                }
              ]);

              process.nextTick(function() {
                assert.deepEqual(emitter.data, []);
                emitter.destroy();
                done();
              });
            });

            _this.collection.submit(_this.docName, {
              v: 1,
              del: true
            }, function(err, v) {
              if (err) {
                throw new Error(err);
              }
            });
          });
        });
      });

      it('does not emit receive events to a destroyed query', function(done) {
        var _this = this;
        this.collection.queryPoll({
          'x': 5
        },
        opts,
        function(err, emitter) {
          emitter.on('diff', function() {
            throw new Error('add called after destroy');
          });

          emitter.destroy();

          _this.create({
            x: 5
          }, function() {
            setTimeout((function() {
              done();
            }), 20);
          });
        });
      });

      // TODO: Not implemented.
      it('works if you remove then re-add a document from a query');

      it('does not poll if opts.shouldPoll returns false', function(done) {
        var _this = this;

        this.create({
          x: 5
        }, function() {
          var called = 0;
          opts.shouldPoll = function(cName, docName, data, index, query) {
            assert.equal(cName, _this.cName);
            assert.equal(docName, _this.docName);
            assert.deepEqual(query, {
              x: 5
            });
            called++;
            return false;
          };

          _this.collection.queryPoll({
            'x': 5
          },
          opts,
          function(err, emitter) {
            if (err) {
              throw Error(err);
            }

            _this.db.query = function() {
              throw Error('query should not be called');
            };

            _this.db.queryDoc = function() {
              throw Error('queryDoc should not be called');
            };

            _this.collection.submit(_this.docName, {
              v: 1,
              op: [
                {
                  p: ['x'],
                  na: 1
                }
              ]
            }, function(err, v) {
              assert.equal(called, 1);
              done();
            });
          });
        });
      });

      it('does not poll if db.shouldPoll returns false', function(done) {
        var _this = this;

        this.create({
          x: 5
        }, function() {
          var called = 0;

          _this.db.queryShouldPoll = function(livedb, cName, docName, data, index, query) {
            assert.equal(cName, _this.cName);
            assert.equal(docName, _this.docName);
            assert.deepEqual(query, {
              x: 5
            });
            called++;
            return false;
          };

          _this.collection.queryPoll({
            x: 5
          },
          opts,
          function(err, emitter) {
            if (err) {
              throw Error(err);
            }

            _this.db.query = function() {
              throw Error('query should not be called');
            };

            _this.db.queryDoc = function() {
              throw Error('queryDoc should not be called');
            };

            _this.collection.submit(_this.docName, {
              v: 1,
              op: [
                {
                  p: ['x'],
                  na: 1
                }
              ]
            }, function(err, v) {
              assert.equal(called, 1);
              done();
            });
          });
        });
      });
    });
  };

  // Run the above tests with different poll settings.
  pollDependentTests(false);
  pollDependentTests(true);

  describe('queryFetch', function() {
    it('query fetch with no results works', function(done) {
      sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
        cb(null, []);
      });

      this.collection.queryFetch({
        'somekeythatdoesnotexist': 1
      }, function(err, results) {
        if (err) {
          throw new Error(err);
        }

        assert.deepEqual(results, []);
        done();
      });
    });

    it('query with some results returns those results', function(done) {
      var result = {
        docName: this.docName,
        data: 'qwertyuiop',
        type: text.uri,
        v: 1
      };

      sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
        cb(null, [result]);
      });

      var _this = this;
      this.collection.queryFetch({
        '_data': 'qwertyuiop'
      }, function(err, results) {
        assert.deepEqual(results, [result]);
        done();
      });
    });

    it('does the right thing with a backend that returns extra data', function(done) {
      var result = {
        results: [
          {
            docName: this.docName,
            data: 'qwertyuiop',
            type: text.uri,
            v: 1
          }
        ],
        extra: 'Extra stuff'
      };

      sinon.stub(this.db, 'query', function(db, index, query, options, cb) {
        cb(null, result);
      });

      var _this = this;
      this.collection.queryFetch({
        '_data': 'qwertyuiop'
      }, function(err, results, extra) {
        assert.deepEqual(results, result.results);
        assert.deepEqual(extra, result.extra);
        done();
      });
    });
  });

  describe('selected collections', function() {
    // TODO: Not implemented.
    it('asks the db to pick the interesting collections');

    // TODO: This test is skipped.
    it.skip('gets operations submitted to any specified collection', function(done) {
      var _this = this;
      this.testWrapper.subscribedChannels = function(cName, query, opts) {
        assert.strictEqual(cName, 'internet');
        assert.deepEqual(query, {
          x: 5
        });
        assert.deepEqual(opts, {
          sexy: true,
          backend: 'test',
          pollDelay: 0
        });
        return [_this.cName, _this.cName2];
      };

      this.testWrapper.query = function(livedb, cName, query, options, callback) {
        assert.deepEqual(query, {
          x: 5
        });
        callback(null, []);
      };

      sinon.spy(this.testWrapper, 'query');
      sinon.spy(this.db, 'query');

      this.client.query('internet', {
        x: 5
      }, {
        sexy: true,
        backend: 'test',
        pollDelay: 0
      }, function(err) {
          if (err) {
            throw Error(err);
          }

          _this.client.submit(_this.cName, _this.docName, {
            v: 0,
            create: {
              type: text.uri
            }
          }, function(err) {
            if (err) {
              throw new Error(err);
            }

            _this.client.submit(_this.cName2, _this.docName, {
              v: 0,
              create: {
                type: text.uri
              }
            }, function(err) {
              if (err) {
                throw new Error(err);
              }

              _this.client.submit(_this.cName3, _this.docName, {
                v: 0,
                create: {
                  type: text.uri
                }
              }, function(err) {
                if (err) {
                  throw new Error(err);
                }

                assert.equal(_this.testWrapper.query.callCount, 3);
                assert.equal(_this.db.query.callCount, 0);
                done();
              });
            });
          });
        });
    });

    it('calls submit on the extra collections', function(done) {
      var _this = this;
      this.testWrapper.subscribedChannels = function(cName, query, opts) {
        return [_this.cName];
      };

      this.testWrapper.submit = function(cName, docName, opData, opts, snapshot, db, cb) {
        cb();
      };

      sinon.spy(this.testWrapper, 'submit');

      this.client.submit(this.cName, this.docName, {
        v: 0,
        create: {
          type: text.uri
        }
      }, {
        backend: 'test'
      }, function(err) {
        assert.equal(_this.testWrapper.submit.callCount, 1);
        return done();
      });
    });

    // TODO: Not implemented.
    it('can call publish');
  });

  describe('extra data', function() {
    it('gets extra data in the initial result set', function(done) {
      sinon.stub(this.db, 'query', function(client, cName, query, options, callback) {
        callback(null, {
          results: [],
          extra: {
            x: 5
          }
        });
      });

      var _this = this;
      this.client.queryPoll('internet', {
        x: 5
      }, function(err, stream) {
        assert.deepEqual(stream.extra, {
          x: 5
        });
        done();
      });
    });

    it('gets updated extra data when the result set changes', function(done) {
      var x = 1;
      sinon.stub(this.db, 'query', function(client, cName, query, options, callback) {
        callback(null, {
          results: [],
          extra: {
            x: x++
          }
        });
      });

      var _this = this;
      this.collection.queryPoll({
        x: 5
      }, {
        poll: true
      }, function(err, stream) {
          assert.deepEqual(stream.extra, {
            x: 1
          });

          stream.on('extra', function(extra) {
            assert.deepEqual(extra, {
              x: 2
            });
            done();
          });

          _this.create();
        });
    });
  });

  it('turns poll mode off automatically if opts.poll is undefined', function(done) {
    this.db.subscribedChannels = function(index, query, opts) {
      assert.deepEqual(opts, {
        poll: false
      });
      return [index];
    };

    var _this = this;
    this.collection.queryPoll({
      x: 5
    },
    {},
    function(err, stream) {
      done();
    });
  });

  it('turns poll mode on automatically if opts.poll is undefined', function(done) {
    this.db.queryNeedsPollMode = function() {
      return true;
    };

    this.db.subscribedChannels = function(index, query, opts) {
      assert.deepEqual(opts, {
        poll: true
      });
      return [index];
    };

    var _this = this;
    this.collection.queryPoll({
      x: 5
    },
    {},
    function(err, stream) {
      return done();
    });
  });
});
