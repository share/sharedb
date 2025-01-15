var emitter = require('../emitter');
var ShareDBError = require('../error');

var ERROR_CODE = ShareDBError.CODES;
var idCounter = 1;

module.exports = Transaction;
function Transaction(connection) {
  emitter.EventEmitter.call(this);

  this.connection = connection;
  this.id = (idCounter++).toString();

  this._callback = null;
}
emitter.mixin(Transaction);

Transaction.prototype.commit = function(callback) {
  // TODO: Catch multiple calls
  // TODO: Handle network changes
  this._callback = callback;
  this.connection._commitTransaction(this);
};

Transaction.prototype.abort = function(callback) {
  this._callback = callback;
};

Transaction.prototype._handleCommit = function(error) {
  if (typeof this._callback === 'function') this._callback(error);
  else if (error) this.emit('error', error);

  if (!error) this.emit('commit');
  else if (error.code === ERROR_CODE.ERR_TRANSACTION_ABORTED) this.emit('abort', error);

  this.emit('end');
  // No more events will be emitted, so tidy up
  this.removeAllListeners();
};
