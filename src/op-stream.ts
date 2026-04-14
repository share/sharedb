import { Readable } from 'stream';
import util = require('./util');

/** Stream of operations. Subscribe returns one of these */
class OpStream extends Readable {
  id;
  open;

  constructor() {
    super({objectMode: true});
    this.id = null;
    this.open = true;
  }

  /**
   * This function is for notifying us that the stream is empty and needs data.
   * For now, we'll just ignore the signal and assume the reader reads as fast
   * as we fill it. I could add a buffer in this function, but really I don't
   * think that is any better than the buffer implementation in nodejs streams
   * themselves.
   */
  declare _read;

  static {
    OpStream.prototype._read = util.doNothing;
  }

  pushData(data) {
    // Ignore any messages after unsubscribe
    if (!this.open) return;
    // This data gets consumed in Agent#_subscribeToStream
    this.push(data);
  }

  destroy() {
    // Only close stream once
    if (!this.open) return;
    this.open = false;

    this.push(null);
    this.emit('close');
  }
}

export = OpStream;
