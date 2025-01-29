var util = require('../util');
var emitter = require('../emitter');

function Transaction(agent, id, ops) {
  emitter.EventEmitter.call(this);

  this.id = id;

  this._agent = agent;
  this._backend = agent.backend;

  this._ops = ops;
  this._docOps = Object.create(null);

  for (var op of ops) {
    var docOps = util.digOrCreate(this._docOps, op.c, op.d, function() {
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
emitter.mixin(Transaction);
module.exports = Transaction;

Transaction.prototype.submit = function(callback) {
  // TODO: Handle multiple calls?
  this._callback = callback;

  for (var op of this._ops) {
    this._submitOp(op);
  }
};

Transaction.prototype.ready = function(request, callback) {
  // TODO: Clear these on retry
  var docRequests = util.digOrCreate(this._readyRequests, request.collection, request.id, function() {
    return [];
  });
  docRequests.push(request);
  this._requestCallbacks.push(callback);

  this.emit('requestReady', request);

  if (this._isReady()) return this._commitTransaction();
};

Transaction.prototype.getSnapshotAndOps = function(request, callback) {
  // TODO: Support fields?
  // TODO: Support options?
  var op = {c: request.collection, d: request.id, seq: request.op.seq};
  this._waitForPreviousOpRequest(op, function(req) {
    if (!req) return callback();
    var versionDiff = req.snapshot.v - request.op.v;
    var ops = util.clone(req.ops.slice(-versionDiff));
    if (ops.length) {
      var offset = request.op.v - ops[0].v;
      for (var op of ops) {
        op.v = op.v + offset;
      }
    }
    callback(null, util.clone(req.snapshot), ops);
  });
};

Transaction.prototype._waitForPreviousOpRequest = function(op, callback) {
  var collection = op.c;
  var id = op.d;

  var previousOp;
  var docOps = this._docOps[collection][id];
  for (var docOp of docOps) {
    if (op.seq === docOp.seq) break;
    previousOp = docOp;
  }

  if (!previousOp) return callback();

  var requests = util.dig(this._readyRequests, collection, id) || [];
  for (var request of requests) {
    if (request.op.seq === previousOp.seq) return callback(request);
  }

  var transaction = this;
  var handler = function(request) {
    if (request.collection !== collection || request.id !== id || request.op.seq !== previousOp.seq) return;
    transaction.off('requestReady', handler);
    callback(request);
  };

  this.on('requestReady', handler);
};

Transaction.prototype._submitOp = function(op) {
  var transaction = this;
  var agent = this._agent;
  this._waitForPreviousOpRequest(op, function() {
    agent._submit(op, function(error, ack) {
      if (error) transaction._finish(error);
      transaction._acks.push(ack);
      if (transaction._acks.length === transaction._ops.length) transaction._finish();
    });
  });
};

Transaction.prototype._isReady = function() {
  return this._requestCallbacks.length === this._ops.length;
};

Transaction.prototype._commitTransaction = function() {
  var requests = this._flatReadyRequests();
  this._readyRequests = Object.create(null);
  var commits = requests.map(function(request) {
    return {
      collection: request.collection,
      id: request.id,
      op: request.op,
      snapshot: request.snapshot,
      options: request.options,
    };
  });
  var callbacks = this._requestCallbacks;
  this._requestCallbacks = [];

  var transaction = this;
  var options = null;
  this._backend.db.commitTransaction(commits, options, function(error, succeeded) {
    if (error) return transaction._finish(error);
    util.callEach(callbacks, null, succeeded);
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
