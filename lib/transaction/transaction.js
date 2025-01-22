var util = require('../util');

function Transaction(agent, id, ops) {
  this.id = id;

  this._agent = agent;
  this._backend = agent.backend;

  this._ops = ops;
  this._readyRequests = [];
  this._callbacks = [];
}
module.exports = Transaction;

Transaction.prototype.submit = function(callback) {
  var finished = false;
  var finish = function(error) {
    if (finished) return;
    finished = true;
    callback(error);
  }

  var ops = this._ops;
  var finishedCount = 0;
  var opHandler = function(error) {
    finishedCount++;
    if (error) return finish(error);
    console.log('op callback', finishedCount, error);
    if (finishedCount !== ops.length) return;
    finish();
  };

  for (var op of ops) this._agent._submit(op, opHandler);
};

Transaction.prototype.ready = function(request, callback) {
  // TODO: Clear these on retry
  this._readyRequests.push(request);
  this._callbacks.push(callback);

  if (!this._isReady()) return;

  var commits = Object.values(this._readyRequests).map(function(req) {
    return {
      collection: req.collection,
      id: req.id,
      op: req.op,
      snapshot: req.snapshot,
      options: req.options,
    };
  });

  var transaction = this;
  var options = null;
  this._backend.db.commitTransaction(commits, options, function(error, succeeded) {
    if (error) return util.callEach(transaction._callbacks, error, succeeded);
    if (!succeeded) {
      // TODO: Retry
    }
    util.callEach(transaction._callbacks, null, succeeded);
  });
};

Transaction.prototype._isReady = function() {
  return Object.keys(this._readyRequests).length === this._ops.length;
}
