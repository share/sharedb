import Presence = require('./presence');
import LocalDocPresence = require('./local-doc-presence');
import RemoteDocPresence = require('./remote-doc-presence');

class DocPresence extends Presence {
  collection;
  id;

  constructor(connection, collection, id) {
    var channel = DocPresence.channel(collection, id);
    super(connection, channel);

    this.collection = collection;
    this.id = id;
  }

  _receiveUpdate(error, message) {
    var isForThisDoc = message.c === this.collection && message.d === this.id;
    if (!error && !isForThisDoc) return;
    Presence.prototype._receiveUpdate.call(this, error, message);
  }

  _createLocalPresence(id) {
    return new LocalDocPresence(this, id);
  }

  _createRemotePresence(id) {
    return new RemoteDocPresence(this, id);
  }

  static channel(collection, id) {
    return collection + '.' + id;
  }
}

export = DocPresence;
