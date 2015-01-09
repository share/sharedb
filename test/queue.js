var assert = require('assert');
var TestDriver = require('./testdriver');
var util = require('./util');

describe('queue', function() {
  beforeEach(util.setup);

  beforeEach(function() {
    this.cName = '_test';
    this.docName2 = 'id1';
    this.testClient = util.createClient(this.db, function(db) {
      return new TestDriver(db);
    });
    this.testClient.driver.redis.select(15);
    this.testClient.driver.redis.flushdb();
  });

  afterEach(util.teardown);

  it('queues consecutive operations when they are not commited', util.calls(3, function(done) {
    var _this = this;
    return this.create(function() {
      _this.createDoc(_this.docName2);
      var client = _this.testClient.client;

      // A submits 's1A' then 's2A', delay happens and it doesn't get sent to redis.
      // B submits 's1B' and is sent to redis immediately. 's2A' is sent to redis and
      // transformation is needed for 's1A' but per-useragent seq for A is wrong and
      // client is informed that 'Op already submitted'.

      _this.testClient.client.submit(_this.cName, _this.docName, {
        v: 1,
        op: ['s1A'],
        seq: 1,
        src: 'A',
        redisSubmitDelay: 50
      }, function(err) {
        if (err) {
          throw new Error(err);
        }
        done();
      });

      _this.testClient.client.submit(_this.cName, _this.docName2, {
        v: 1,
        op: ['s2A'],
        seq: 2,
        src: 'A',
        redisSubmitDelay: 10
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        // Assert that lock is cleaned once all operations are successfully submitted.
        process.nextTick(function() {
          assert.deepEqual(client.submitMap, {});
          return done();
        });
      });

      _this.testClient.client.submit(_this.cName, _this.docName, {
        v: 1,
        op: ['s1B'],
        seq: 1,
        src: 'B'
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        done();
      });
    });
  }));

  it('queues up operations per-client until the front of the queue is submitted to driver', util.calls(2, function(done) {
    var _this = this;
    this.create(function() {
      var driver = _this.testClient.driver;

      var op1 = {
        cName: _this.cName,
        docName: _this.docName,
        opData: {
          v: 1,
          op: ['op1'],
          seq: 1,
          src: 'A'
        }
      };

      var op2 = {
        cName: _this.cName,
        docName: _this.docName,
        opData: {
          v: 2,
          op: ['op2'],
          seq: 2,
          src: 'A'
        }
      };

      assert.equal(driver.opList, void 0);

      _this.testClient.client.submit(_this.cName, _this.docName, {
        v: 1,
        op: ['op1'],
        seq: 1,
        src: 'A',
        redisSubmitDelay: 50
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        done();
      });

      _this.testClient.client.submit(_this.cName, _this.docName, {
        v: 2,
        op: ['op2'],
        seq: 2,
        src: 'A',
        redisSubmitDelay: 0
      }, function(err) {
        if (err) {
          throw new Error(err);
        }

        operationAssert(driver.opList, [op1, op2]);
        done();
      });
    });
  }));
});

operationAssert = function(opList, expected) {
  assert.equal(expected.length, opList.length);

  var expectedOp, op;
  for (var i = 0, len = opList.length; i < len; ++i) {
    op = opList[i];
    expectedOp = expected[i];
    assert.equal(op.cName, expectedOp.cName);
    assert.equal(op.docName, expectedOp.docName);
    assert.equal(op.opData.v, expectedOp.opData.v);
    assert.deepEqual(op.opData.op, expectedOp.opData.op);
    assert.equal(op.opData.seq, expectedOp.opData.seq);
    assert.equal(op.opData.src, expectedOp.opData.src);
  }
};
