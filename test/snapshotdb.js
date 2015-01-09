var assert = require('assert');
var textType = require('ot-text').type;
var jsonType = require('ot-json0').type;

var counter = 1;

module.exports = function(create, noBulkGetSnapshot) {
  var innerCreate;

  if (create.length === 0) {
    innerCreate = create;
    create = function(callback) {
      callback(innerCreate());
    };
  }

  describe('snapshot db', function() {
    beforeEach(function(done) {
      this.cName = 'testcollection';
      this.docName = "snapshottest " + (counter++);

      var _this = this;
      create(function(db) {
        _this.db = db;
        done();
      });
    });

    afterEach(function() {
      this.db.close();
    });

    it('returns null when you getSnapshot on a nonexistant doc name', function(done) {
      this.db.getSnapshot(this.cName, this.docName, function(err, data) {
        if (err) {
          throw Error(err);
        }

        assert.equal(data, null);
        done();
      });
    });

    it('will store data', function(done) {
      var data = {
        v: 5,
        type: textType.uri,
        data: 'hi there',
        m: {
          ctime: 1,
          mtime: 2
        }
      };

      var _this = this;
      this.db.writeSnapshot(this.cName, this.docName, data, function(err) {
        if (err) {
          throw Error(err);
        }

        _this.db.getSnapshot(_this.cName, _this.docName, function(err, storedData) {
          delete storedData.docName;
          assert.deepEqual(data, storedData);
          done();
        });
      });
    });

    it('will remove data fields if the data has been deleted', function(done) {
      var data = {
        v: 5,
        type: textType.uri,
        data: 'hi there',
        m: {
          ctime: 1,
          mtime: 2
        }
      };

      var _this = this;
      this.db.writeSnapshot(this.cName, this.docName, data, function(err) {
          if (err) {
            throw Error(err);
          }

          _this.db.writeSnapshot(_this.cName, _this.docName, {
            v: 6
          }, function(err) {
            if (err) {
              throw Error(err);
            }

            _this.db.getSnapshot(_this.cName, _this.docName, function(err, storedData) {
              if (err) {
                throw Error(err);
              }

              assert.equal(storedData.data, null);
              assert.equal(storedData.type, null);
              assert.equal(storedData.m, null);
              assert.equal(storedData.v, 6);

              done();
            });
          });
        });
    });

    if (!noBulkGetSnapshot) {
      describe('bulk get snapshot', function() {
        it('does not return missing documents', function(done) {
          this.db.bulkGetSnapshot({
            testcollection: [this.docName]
          }, function(err, results) {
            if (err) {
              throw Error(err);
            }

            assert.deepEqual(results, {
              testcollection: []
            });

            done();
          });
        });

        it('returns results', function(done) {
          var data = {
            v: 5,
            type: textType.uri,
            data: 'hi there',
            m: {
              ctime: 1,
              mtime: 2
            }
          };

          var _this = this;
          this.db.writeSnapshot(this.cName, this.docName, data, function(err) {
            if (err) {
              throw Error(err);
            }

            _this.db.bulkGetSnapshot({
              testcollection: [_this.docName]
            }, function(err, results) {
              if (err) {
                throw Error(err);
              }

              var expected = {
                testcollection: {}
              };
              expected.testcollection[_this.docName] = data;
              delete results[_this.cName][_this.docName].docName;
              assert.deepEqual(results, expected);

              done();
            });
          });
        });

        it("works when some results exist and some don't", function(done) {
          var data = {
            v: 5,
            type: textType.uri,
            data: 'hi there',
            m: {
              ctime: 1,
              mtime: 2
            }
          };

          var _this = this;
          this.db.writeSnapshot(this.cName, this.docName, data, function(err) {
            if (err) {
              throw Error(err);
            }

            _this.db.bulkGetSnapshot({
              testcollection: ['does not exist', _this.docName, 'also does not exist']
            }, function(err, results) {
              if (err) {
                throw Error(err);
              }

              var expected = {
                testcollection: {}
              };
              expected.testcollection[_this.docName] = data;
              delete results[_this.cName][_this.docName].docName;
              assert.deepEqual(results, expected);

              done();
            });
          });
        });
      });
    } else {
      console.warn('Warning: db.bulkGetSnapshot not defined in snapshot db. Bulk subscribes will be slower.');
    }

    it('projects fields using getSnapshotProjected', function(done) {
      if (!this.db.getSnapshotProjected) {
        console.warn('No getSnapshotProjected implementation. Skipping tests. This is ok - it just means projections will be less efficient');
        return done();
      }

      var data = {
        v: 5,
        type: jsonType.uri,
        data: {
          x: 5,
          y: 6
        },
        m: {
          ctime: 1,
          mtime: 2
        }
      };

      var _this = this;
      this.db.writeSnapshot(this.cName, this.docName, data, function(err) {
        if (err) {
          throw Error(err);
        }

        _this.db.getSnapshotProjected(_this.cName, _this.docName, {
          x: true,
          z: true
        }, function(err, data) {
          if (err) {
            throw Error(err);
          }

          delete data.docName;
          var expected = {
            v: 5,
            type: jsonType.uri,
            data: {
              x: 5
            },
            m: {
              ctime: 1,
              mtime: 2
            }
          };
          assert.deepEqual(data, expected);
          done();
        });
      });
    });
  });
};
