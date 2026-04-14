'use strict';
var __extends =
  (this && this.__extends) ||
  (function () {
    var extendStatics = function (d, b) {
      extendStatics =
        Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array &&
          function (d, b) {
            d.__proto__ = b;
          }) ||
        function (d, b) {
          for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
        };
      return extendStatics(d, b);
    };
    return function (d, b) {
      if (typeof b !== 'function' && b !== null)
        throw new TypeError('Class extends value ' + String(b) + ' is not a constructor or null');
      extendStatics(d, b);
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  })();
var Presence = require('./presence');
var LocalDocPresence = require('./local-doc-presence');
var RemoteDocPresence = require('./remote-doc-presence');
var DocPresence = /** @class */ (function (_super) {
  __extends(DocPresence, _super);
  function DocPresence(connection, collection, id) {
    var _this = this;
    var channel = DocPresence.channel(collection, id);
    _this = _super.call(this, connection, channel) || this;
    _this.collection = collection;
    _this.id = id;
    return _this;
  }
  DocPresence.prototype._createLocalPresence = function (id) {
    return new LocalDocPresence(this, id);
  };
  DocPresence.prototype._createRemotePresence = function (id) {
    return new RemoteDocPresence(this, id);
  };
  DocPresence.channel = function (collection, id) {
    return collection + '.' + id;
  };
  return DocPresence;
})(Presence);
module.exports = DocPresence;
