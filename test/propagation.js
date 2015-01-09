var assert = require('assert');
var sinon = require('sinon');
var json0 = require('ot-json0').type;
var util = require('./util');

describe('operation propagation granularity', function() {
  beforeEach(util.setup);

  beforeEach(function() {
    this.cName = '_test';
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

  function throttlesOperationsWhenSuppressed(poll) {
    describe("poll:" + poll, function() {
      beforeEach(function() {
        this.client.suppressCollectionPublish = true;
      });

      it('throttles publishing operations when suppressCollectionPublish === true', function(done) {
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
        }, {
          poll: poll,
          pollDelay: 0
        }, function(err, emitter) {
          emitter.on('diff', function(diff) {
            throw new Error('should not propagate operation to query');
          });

          sinon.stub(_this.db, 'query', function(db, index, query, options, cb) {
            cb(null, [result]);
          });

          sinon.stub(_this.db, 'queryDoc', function(db, index, cName, docName, query, cb) {
            cb(null, result);
          });
          _this.create({
            x: 5
          }, function() {
             done();
          });
        });
      });
    });
  };

  throttlesOperationsWhenSuppressed(false);
  throttlesOperationsWhenSuppressed(true);

  function doesntThrottlesOperationsWhenNotSuppressed(poll) {
    describe("poll:" + poll, function() {
      beforeEach(function() {
        this.client.suppressCollectionPublish = false;
      });

      it('does not throttle publishing operations with suppressCollectionPublish === false', function(done) {
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
        }, {
          poll: poll,
          pollDelay: 0
        }, function(err, emitter) {
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
    });
  }

  doesntThrottlesOperationsWhenNotSuppressed(false);
  doesntThrottlesOperationsWhenNotSuppressed(true);
});
