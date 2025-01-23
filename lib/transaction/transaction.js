var util = require('../util');

function Transaction(agent, id, ops) {
  this.id = id;

  this._agent = agent;
  this._backend = agent.backend;

  this._ops = ops;
  this._pendingOps = Object.create(null);

  for (var op of ops) {
    var docOps = util.digOrCreate(this._pendingOps, op.c, op.d, function() {
      return [];
    });
    op.v = op.v + docOps.length;
    docOps.push(op);
  }

  this._finished = false;
  this._callback = null;

  this._readyRequests = Object.create(null);
  this._requestCallbacks = [];
  this._acks = [];
}
module.exports = Transaction;

Transaction.prototype.submit = function(callback) {
  // TODO: Handle multiple calls?
  this._callback = callback;

  for (var collection in this._pendingOps) {
    for (var id in this._pendingOps[collection]) {
      this._submitNextDocOp(collection, id);
    }
  }
};

Transaction.prototype.ready = function(request, callback) {
  // TODO: Clear these on retry
  var docRequests = util.digOrCreate(this._readyRequests, request.collection, request.id, function() {
    return [];
  });
  docRequests.push(request);
  this._requestCallbacks.push(callback);

  if (this._isReady()) return this._commitTransaction();
  this._submitNextDocOp(request.collection, request.id);
};

Transaction.prototype.getSnapshot = function(collection, id, fields, snapshotOptions) {
  // TODO: Support fields?
  // TODO: Support options?
  var requests = util.dig(this._readyRequests, collection, id);
  if (!requests) return;
  return util.clone(requests[requests.length - 1].snapshot);
};

Transaction.prototype._submitNextDocOp = function(collection, id) {
  var transaction = this;
  var ops = this._pendingOps[collection][id];
  var op = ops.shift();
  this._agent._submit(op, function(error, ack) {
    if (error) transaction._finish(error);
    transaction._acks.push(ack);
    if (transaction._acks.length === transaction._ops.length) transaction._finish();
  });
};

Transaction.prototype._isReady = function() {
  return this._requestCallbacks.length === this._ops.length;
};

Transaction.prototype._commitTransaction = function() {
  var requests = this._flatReadyRequests();
  var commits = requests.map(function(request) {
    return {
      collection: request.collection,
      id: request.id,
      op: request.op,
      snapshot: request.snapshot,
      options: request.options,
    };
  });

  var transaction = this;
  var options = null;
  this._backend.db.commitTransaction(commits, options, function(error, succeeded) {
    if (error) return transaction._finish(error);
    if (!succeeded) {
      // TODO: Retry
    }
    util.callEach(transaction._requestCallbacks, null, true);
  });
};

Transaction.prototype._flatReadyRequests = function() {
  var requests = [];
  for (var collection in this._readyRequests) {
    for (var id in this._readyRequests[collection]) {
      requests = requests.concat(this._readyRequests[collection][id]);
    }
  }
  return requests;
};

Transaction.prototype._finish = function(error) {
  if (this._finished) return;
  this._finished = true;
  if (error) return this._callback(error);
  this._callback(null, {acks: this._acks});
};
