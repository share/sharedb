import {Readable} from "stream";


// Stream of operations. Subscribe returns one of these
class OpStream extends Readable {

    public id: any;
    public backend: any;
    public agent: any;
    public projection: any;
    public open: any;

    constructor() {
        super({objectMode: true});

        this.id = null;
        this.backend = null;
        this.agent = null;
        this.projection = null;

        this.open = true;
    }


// This function is for notifying us that the stream is empty and needs data.
// For now, we'll just ignore the signal and assume the reader reads as fast
// as we fill it. I could add a buffer in this function, but really I don't
// think that is any better than the buffer implementation in nodejs streams
// themselves.
    _read() {
    }

    public initProjection(backend, agent, projection) {
        this.backend = backend;
        this.agent = agent;
        this.projection = projection;
    };

    public pushOp(collection, id, op) {
        if (this.backend) {
            var stream = this;
            this.backend._sanitizeOp(this.agent, this.projection, collection, id, op, function (err) {
                if (!stream.open) return;
                stream.push(err ? {error: err} : op);
            });
        } else {
            // Ignore any messages after unsubscribe
            if (!this.open) return;
            this.push(op);
        }
    };

    public pushOps(collection, id, ops) {
        for (var i = 0; i < ops.length; i++) {
            this.pushOp(collection, id, ops[i]);
        }
    };

    public destroy() {
        if (!this.open) return;
        this.open = false;

        this.push(null);
        this.emit('close');
    };
}


module.exports = OpStream;