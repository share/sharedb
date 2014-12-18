RedisDriver = require '../lib/redisdriver'
assert = require 'assert'

redisAtomicSubmit = RedisDriver.prototype.atomicSubmit

RedisDriver.prototype.operationAssert = (expected) ->
  # TODO noansknv explain
  (expected[i].opData.m.ts = op.opData.m.ts for op, i in @opList) if expected
  # this.opList[0].opData.m.ts
  assert.deepEqual @opList, expected

RedisDriver.prototype.atomicSubmit = (cName, docName, opData, options, callback) ->
  if !@opList then @opList = []
  @opList.push {cName, docName, opData}

  redisAtomicSubmit.call this, cName, docName, opData, options, callback

module.exports = RedisDriver
