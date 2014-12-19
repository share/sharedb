RedisDriver = require '../lib/redisdriver'
assert = require 'assert'

redisAtomicSubmit = RedisDriver.prototype.atomicSubmit
redisSubmitScript = RedisDriver.prototype._redisSubmitScript

RedisDriver.prototype.atomicSubmit = (cName, docName, opData, options, callback) ->
  @opList ||= []
  @opList.push {cName, docName, opData}

  redisAtomicSubmit.call this, cName, docName, opData, options, callback

RedisDriver.prototype._redisSubmitScript = (cName, docName, opData, dirtyData, docVersion, callback) ->
  if opData.redisSubmitDelay?
    setTimeout =>
      redisSubmitScript.call this, cName, docName, opData, dirtyData, docVersion, callback
    , opData.redisSubmitDelay
    return

  redisSubmitScript.call this, cName, docName, opData, dirtyData, docVersion, callback

module.exports = RedisDriver
