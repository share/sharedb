import {Duplex} from "stream";

var inherits = require('util').inherits;
var util = require('./util');

class StreamSocket {

    public isServer = true;
    public readyState: any;
    public stream: any;

    constructor() {

        this.readyState = 0;
        this.stream = new ServerStream(this);
    }

    public _open() {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen();
    };

    public close(reason) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        // Signal data writing is complete. Emits the 'end' event
        this.stream.push(null);
        this.onclose(reason || 'closed');
    };

    public send(data) {
        // Data is an object
        this.stream.push(JSON.parse(data));
    };

    public onmessage() {
    }

    onclose(...args: any[]) {
    }

    onerror() {
    }

    onopen() {
    }

}

class ServerStream extends Duplex {

    public socket: any;

    constructor(socket) {
        super({objectMode: true});
        this.socket = socket;

        this.on('error', function (error) {
            console.warn('ShareDB client message stream error', error);
            socket.close('stopped');
        });

        // The server ended the writable stream. Triggered by calling stream.end()
        // in agent.close()
        this.on('finish', function () {
            socket.close('stopped');
        });
    }


    _read() {
    };

    public _write(chunk, encoding, callback) {
        var socket = this.socket;
        process.nextTick(function () {
            if (socket.readyState !== 1) return;
            socket.onmessage({data: JSON.stringify(chunk)});
            callback();
        });
    };
}

module.exports = StreamSocket;

