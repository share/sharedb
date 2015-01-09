var assert = require('assert');
var util = require('./util');

describe.skip('presence', function() {
  beforeEach(util.setup);

  afterEach(util.teardown);

  describe('fetch and set', function() {
    it('fetchPresence on a doc with no presence data returns {}', function(done) {
      this.client.fetchPresence(this.cName, this.docName, function(err, presence) {
        if (err) {
          throw new Error(err);
        }

        assert.deepEqual(presence, {});
        done();
      });
    });

    it('subscribe returns empty presence data for an empty doc', function(done) {
      var _this = this;
      this.client.subscribe(this.cName, this.docName, 0, {
        wantPresence: true
      }, function(err, stream, presence) {
          if (err) {
            throw new Error(err);
          }

          assert.deepEqual(presence, {});
           done();
        });
    });

    it('lets you set presence data for the whole document', function(done) {
      var _this = this;
      this.client.submitPresence(this.cName, this.docName, {
        v: 0,
        val: {
          id: {
            name: 'seph'
          }
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
          assert.deepEqual(presence, {
            id: {
              name: 'seph'
            }
          });

          done();
        });
      });
    });

    it("lets you set a user's presence data", function(done) {
      var _this = this;
      this.client.submitPresence(this.cName, this.docName, {
        v: 0,
        p: ['id'],
        val: {
          name: 'seph'
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
          assert.deepEqual(presence, {
            id: {
              name: 'seph'
            }
          });

          done();
        });
      });
    });

    it('lets you set a field', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.submitPresence(_this.cName, _this.docName, {
          v: 1,
          p: ['id', 'name'],
          val: 'ian'
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
            assert.deepEqual(presence, {
              id: {
                name: 'ian'
              }
            });

            done();
          });
        });
      });
    });

    it('lets you edit without a version specified', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.submitPresence(_this.cName, _this.docName, {
          p: ['id', 'name'],
          val: 'ian'
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
            assert.deepEqual(presence, {
              id: {
                name: 'ian'
              }
            });

            done();
          });
        });
      });
    });

    it('lets you change a field', function(done) {
      var _this = this;
      this.client.submitPresence(this.cName, this.docName, {
        v: 0,
        p: ['id'],
        val: {
          name: 'seph'
        }
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        _this.client.submitPresence(_this.cName, _this.docName, {
          v: 0,
          p: ['id', 'name'],
          val: 'nate'
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
            assert.deepEqual(presence, {
              id: {
                name: 'nate'
              }
            });

            done();
          });
        });
      });
    });

    it('does not let you set reserved (underscored) values other than cursor', function(done) {
      var _this = this;
      this.client.submitPresence(this.cName, this.docName, {
        v: 0,
        p: ['id'],
        val: {
          _name: 'seph'
        }
      }, function(err) {
        assert.strictEqual(err, 'Cannot set reserved value');
        done();
      });
    });

    // TODO: Not Implemented.
    it.skip('does not let you set _cursor for a nonexistant doc', function(done) {
      var _this = this;
      this.client.submitPresence(this.cName, this.docName, {
        v: 0,
        p: ['id'],
        val: {
          _cursor: 6
        }
      }, function(err) {
        assert.strictEqual(err, 'Cannot set reserved value');
        done();
      });
    });

    it('does let you set _cursor for a document', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.submitPresence(_this.cName, _this.docName, {
          v: 1,
          p: ['id'],
          val: {
            _cursor: 0
          }
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.client.submitPresence(_this.cName, _this.docName, {
            v: 1,
            p: ['id', '_cursor'],
            val: 1
          }, function(err) {
            if (err) {
              throw new Error(err);
            }

            done();
          });
        });
      });
    });
  });

  describe('edits from ops', function() {
    it('deletes the cursor when a document is deleted', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.submitPresence(_this.cName, _this.docName, {
          v: 1,
          p: ['id'],
          val: {
            x: 'y',
            _cursor: 0
          }
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.submit(_this.docName, {
            v: 1,
            del: true
          }, function(err) {
            if (err) {
              throw new Error(err);
            }

            _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(presence, {
                id: {
                  x: 'y'
                }
              });

              done();
            });
          });
        });
      });
    });

    it('moves the cursor when text is edited', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.submitPresence(_this.cName, _this.docName, {
          v: 1,
          p: ['id'],
          val: {
            _cursor: [1, 1]
          }
        }, function(err) {
          if (err) {
            throw new Error(err);
          }

          _this.collection.submit(_this.docName, {
            v: 1,
            op: ['hi']
          }, function(err) {
            if (err) {
              throw new Error(err);
            }

            _this.client.fetchPresence(_this.cName, _this.docName, function(err, presence) {
              if (err) {
                throw new Error(err);
              }

              assert.deepEqual(presence, {
                id: {
                  _cursor: [3, 3]
                }
              });

              done();
            });
          });
        });
      });
    });
  });

  describe('subscribe', function() {
    // TODO Test skipped.
    it.skip('propogates presence ops to subscribers', function(done) {
      var _this = this;
      this.create(function() {
        _this.client.subscribe(_this.cName, _this.docName, 0, {
          wantPresence: true
        }, function(err, stream, presence) {
          _this.client.submit(_this.cName, _this.docName, {
            v: 1,
            op: ['hi']
          });
          if (err) {
            throw new Error(err);
          }

          assert.deepEqual(presence, {});
          stream.on('data', function(data) {
            console.log('got data', data);
          });

          _this.client.submitPresence(_this.cName, _this.docName, {
            v: 0,
            id: 'id',
            value: {
              x: 'y'
            }
          }, function(err) {
            if (err) {
              throw new Error(err);
            }
          });
        });
      });
    });
  });
});
