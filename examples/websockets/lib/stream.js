var Duplex = require('stream').Duplex;
var inherits = require('util').inherits;

function Stream(socket) {
  Duplex.call(this, {objectMode: true});

  this.socket = socket;

  this.on('error', function(error) {
    console.warn('ShareDB client message stream error', error);
    socket.close('stopped');
  });

  this.on('finish', function() {
    socket.close('stopped');
  });
}
inherits(Stream, Duplex);

Stream.prototype._read = function() {};

Stream.prototype._write = function(chunk, encoding, next) {
  this.socket.send(JSON.stringify(chunk));
  next();
};

module.exports = Stream;
