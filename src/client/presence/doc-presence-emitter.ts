var util = require('../../util');
var EventEmitter = require('events').EventEmitter;

var EVENTS = [
  'create',
  'del',
  'destroy',
  'load',
  'op'
];

module.exports = DocPresenceEmitter;

function DocPresenceEmitter() {
  this._docs = Object.create(null);
  this._forwarders = Object.create(null);
  this._emitters = Object.create(null);
}

DocPresenceEmitter.prototype.addEventListener = function(doc, event, listener) {
  this._registerDoc(doc);
  var emitter = util.dig(this._emitters, doc.collection, doc.id);
  emitter.on(event, listener);
};

DocPresenceEmitter.prototype.removeEventListener = function(doc, event, listener) {
  var emitter = util.dig(this._emitters, doc.collection, doc.id);
  if (!emitter) return;
  emitter.off(event, listener);
  // We'll always have at least one, because of the destroy listener
  if (emitter._eventsCount === 1) this._unregisterDoc(doc);
};

DocPresenceEmitter.prototype._registerDoc = function(doc) {
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
};

DocPresenceEmitter.prototype._unregisterDoc = function(doc) {
  var forwarders = util.dig(this._forwarders, doc.collection, doc.id);
  for (var event in forwarders) {
    doc.off(event, forwarders[event]);
  }

  var emitter = util.dig(this._emitters, doc.collection, doc.id);
  emitter.removeAllListeners();

  util.digAndRemove(this._forwarders, doc.collection, doc.id);
  util.digAndRemove(this._emitters, doc.collection, doc.id);
  util.digAndRemove(this._docs, doc.collection, doc.id);
};
