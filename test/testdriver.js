var RedisDriver = require('../lib/redisdriver');
var assert = require('assert');

var redisAtomicSubmit = RedisDriver.prototype.atomicSubmit;
var redisSubmitScript = RedisDriver.prototype._redisSubmitScript;

RedisDriver.prototype.atomicSubmit = function(cName, docName, opData, options, callback) {
  this.opList || (this.opList = []);
  this.opList.push({
    cName: cName,
    docName: docName,
    opData: opData
  });
  return redisAtomicSubmit.call(this, cName, docName, opData, options, callback);
};

RedisDriver.prototype._redisSubmitScript = function(cName, docName, opData, dirtyData, docVersion, callback) {
  if (opData.redisSubmitDelay != null) {
    setTimeout((function(_this) {
      return function() {
        return redisSubmitScript.call(_this, cName, docName, opData, dirtyData, docVersion, callback);
      };
    })(this), opData.redisSubmitDelay);
    return;
  }
  return redisSubmitScript.call(this, cName, docName, opData, dirtyData, docVersion, callback);
};

module.exports = RedisDriver;
