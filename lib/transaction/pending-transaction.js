const AbortedTransaction = require("./aborted-transaction");
const CommittedTransaction = require("./committed-transaction");

function PendingTransaction(transaction) {
  this._transaction = transaction;
  this._wantsCommit = false;
}
module.exports = PendingTransaction;

PendingTransaction.prototype.commit = function() {
  this._wantsCommit = true;
  this.update();
};

PendingTransaction.prototype.abort = function() {
  this._transaction._state = new AbortedTransaction(this._transaction);
};

PendingTransaction.prototype.registerSubmitRequest = function(request) {
  this._transaction._requests.push(request);
  this.update();
};

PendingTransaction.prototype.update = function() {
  if (!this._shouldCommit()) return;
  this._transaction._state = new CommittedTransaction(this._transaction);
};

PendingTransaction.prototype._shouldCommit = function() {
  if (!this._wantsCommit) return false;
  return this._transaction._requests.every(function(request) {
    return request._succeeded;
  });
};
