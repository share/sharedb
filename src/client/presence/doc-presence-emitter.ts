import util = require('../../util');
import { EventEmitter } from 'events';

var EVENTS = [
  'create',
  'del',
  'destroy',
  'load',
  'op'
];

export = DocPresenceEmitter;

class DocPresenceEmitter {
  _docs;
  _forwarders;
  _emitters;

  constructor() {
    this._docs = Object.create(null);
    this._forwarders = Object.create(null);
    this._emitters = Object.create(null);
  }

  addEventListener(doc, event, listener) {
    this._registerDoc(doc);
    var emitter = util.dig(this._emitters, doc.collection, doc.id);
    emitter.on(event, listener);
  }

  removeEventListener(doc, event, listener) {
    var emitter = util.dig(this._emitters, doc.collection, doc.id);
    if (!emitter) return;
    emitter.off(event, listener);
    // We'll always have at least one, because of the destroy listener
    if (emitter._eventsCount === 1) this._unregisterDoc(doc);
  }

  _registerDoc(doc) {
    var alreadyRegistered = true;
    util.digOrCreate(this._docs, doc.collection, doc.id, function() {
      alreadyRegistered = false;
      return doc;
    });

    if (alreadyRegistered) return;

    var emitter = util.digOrCreate(this._emitters, doc.collection, doc.id, function() {
      var e = new EventEmitter();
      // Set a high limit to avoid unnecessary warnings, but still
      // retain some degree of memory leak detection
      e.setMaxListeners(1000);
      return e;
    });

    var self = this;
    EVENTS.forEach(function(event) {
      var forwarder = util.digOrCreate(self._forwarders, doc.collection, doc.id, event, function() {
        return emitter.emit.bind(emitter, event);
      });

      doc.on(event, forwarder);
    });

    this.addEventListener(doc, 'destroy', this._unregisterDoc.bind(this, doc));
  }

  _unregisterDoc(doc) {
    var forwarders = util.dig(this._forwarders, doc.collection, doc.id);
    for (var event in forwarders) {
      doc.off(event, forwarders[event]);
    }

    var emitter = util.dig(this._emitters, doc.collection, doc.id);
    emitter.removeAllListeners();

    util.digAndRemove(this._forwarders, doc.collection, doc.id);
    util.digAndRemove(this._emitters, doc.collection, doc.id);
    util.digAndRemove(this._docs, doc.collection, doc.id);
  }
}
