var emitter = require('../emitter');
const {ACTIONS} = require('../message-actions');

var idCounter = 1;

module.exports = Transaction;
function Transaction(connection) {
  emitter.EventEmitter.call(this);

  // TODO: UUIDs?
  this.id = (idCounter++).toString();

  this._connection = connection;
  this._callback = null;
  this._docs = Object.create(null);
}
emitter.mixin(Transaction);

Transaction.prototype.commit = function(callback) {
  // TODO: Catch multiple calls
  // TODO: Handle network changes
  this._callback = callback;
  this._connection.send({
    a: ACTIONS.transactionCommit,
    id: this.id,
    o: this._getOps()
  });
};

Transaction.prototype._handleCommit = function(error) {
  // TODO: Trigger this._getOps() callbacks
  // TODO: Should unset transaction on this._docs
  // TODO: If error, should rollback docs
  if (typeof this._callback === 'function') this._callback(error);
  else if (error) this.emit('error', error);
};

Transaction.prototype._registerDoc = function(doc) {
  console.log('register doc', doc.collection, doc.id);
  var collection = this._docs[doc.collection] = this._docs[doc.collection] || Object.create(null);
  collection[doc.id] = doc;
  doc._transaction = this;
};

Transaction.prototype._getOps = function() {
  var ops = [];

  for (var collection in this._docs) {
    for (var id in this._docs[collection]) {
      var doc = this._docs[collection][id];
      console.log(collection, id, !!doc);
      for (var op of doc.pendingOps) {
        if (op.transaction !== this.id) break;
        ops.push(this._connection._opMessage(doc, op));
      }
    }
  }

  return ops;
};
