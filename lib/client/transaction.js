var emitter = require('../emitter');

var idCounter = 1;

var STATE = {
  pending: 'pending',
  committing: 'committing',
  aborting: 'aborting',
  committed: 'committed',
  aborted: 'aborted'
}

module.exports = Transaction;
function Transaction(connection) {
  emitter.EventEmitter.call(this);

  this.connection = connection;
  this.id = (idCounter++).toString();

  this._callback = null;
  this._state = STATE.pending;
}
emitter.mixin(Transaction);

Transaction.prototype.commit = function(callback) {
  // TODO: Catch multiple calls
  // TODO: Handle network changes
  this._state = STATE.committing;
  this._callback = callback;
  this.connection._commitTransaction(this);
};

Transaction.prototype.abort = function(callback) {
  this._state = STATE.aborting;
  this._callback = callback;
};

Transaction.prototype._handleCommit = function(error, message) {
  if (error) return this._callback(error);
  this._callback();
};
