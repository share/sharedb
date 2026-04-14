import Snapshot = require('../../snapshot');
import emitter = require('../../emitter');

export = SnapshotRequest;

class SnapshotRequest {
  requestId;
  connection;
  id;
  collection;
  callback;
  sent;

  constructor(connection, requestId, collection, id, callback) {
    emitter.EventEmitter.call(this);

    if (typeof callback !== 'function') {
      throw new Error('Callback is required for SnapshotRequest');
    }

    this.requestId = requestId;
    this.connection = connection;
    this.id = id;
    this.collection = collection;
    this.callback = callback;

    this.sent = false;
  }

  send() {
    if (!this.connection.canSend) {
      return;
    }

    this.connection.send(this._message());
    this.sent = true;
  }

  _onConnectionStateChanged() {
    if (this.connection.canSend) {
      if (!this.sent) this.send();
    } else {
      // If the connection can't send, then we've had a disconnection, and even if we've already sent
      // the request previously, we need to re-send it over this reconnected client, so reset the
      // sent flag to false.
      this.sent = false;
    }
  }

  _handleResponse(error, message) {
    this.emit('ready');

    if (error) {
      return this.callback(error);
    }

    var metadata = message.meta ? message.meta : null;
    var snapshot = new Snapshot(this.id, message.v, message.type, message.data, metadata);

    this.callback(null, snapshot);
  }
}

emitter.mixin(SnapshotRequest);
