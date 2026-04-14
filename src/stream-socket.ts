import { Duplex } from 'stream';
import logger = require('./logger');
import util = require('./util');

class StreamSocket {
  readyState;
  stream;

  constructor() {
    this.readyState = 0;
    this.stream = new ServerStream(this);
  }

  _open() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen();
  }

  close(reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // Signal data writing is complete. Emits the 'end' event
    this.stream.push(null);
    this.onclose(reason || 'closed');
  }

  send(data) {
    // Data is an object
    this.stream.push(JSON.parse(data));
  }

  declare onmessage;

  static {
    StreamSocket.prototype.onmessage = util.doNothing;
  }

  declare onclose;

  static {
    StreamSocket.prototype.onclose = util.doNothing;
  }

  declare onerror;

  static {
    StreamSocket.prototype.onerror = util.doNothing;
  }

  declare onopen;

  static {
    StreamSocket.prototype.onopen = util.doNothing;
  }
}

export = StreamSocket;

class ServerStream extends Duplex {
  socket;

  constructor(socket) {
    super({objectMode: true});

    this.socket = socket;

    this.on('error', function(error) {
      logger.warn('ShareDB client message stream error', error);
      socket.close('stopped');
    });

    // The server ended the writable stream. Triggered by calling stream.end()
    // in agent.close()
    this.on('finish', function() {
      socket.close('stopped');
    });
  }

  declare isServer;

  static {
    ServerStream.prototype.isServer = true;
  }

  declare _read;

  static {
    ServerStream.prototype._read = util.doNothing;
  }

  _write(chunk, encoding, callback) {
    var socket = this.socket;
    util.nextTick(function() {
      if (socket.readyState !== 1) return;
      socket.onmessage({data: JSON.stringify(chunk)});
      callback();
    });
  }
}
