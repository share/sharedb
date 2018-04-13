var ot = require('./ot');
var projections = require('./projections');

class SubmitRequest {

    public backend: any;
    public agent: any;
    public index: any;
    public projection: any;
    public collection: any;
    public id: any;
    public op: any;
    public options: any;
    public start: any;
    public action: any;
    public custom: any;
    public suppressPublish: any;
    public maxRetries: any;
    public retries: any;
    public snapshot: any;
    public ops: any;
    public channels: any;

    constructor(backend, agent, index, id, op, options) {
        this.backend = backend;
        this.agent = agent;
        // If a projection, rewrite the call into a call against the collection
        var projection = backend.projections[index];
        this.index = index;
        this.projection = projection;
        this.collection = (projection) ? projection.target : index;
        this.id = id;
        this.op = op;
        this.options = options;

        this.start = Date.now();
        this._addOpMeta();

        // Set as this request is sent through middleware
        this.action = null;
        // For custom use in middleware
        this.custom = {};

        this.suppressPublish = backend.suppressPublish;
        this.maxRetries = backend.maxSubmitRetries;
        this.retries = 0;

        // return values
        this.snapshot = null;
        this.ops = [];
        this.channels = null;
    }


    public submit(callback) {
        var request = this;
        var backend = this.backend;
        var collection = this.collection;
        var id = this.id;
        var op = this.op;
        // Send a special projection so that getSnapshot knows to return all fields.
        // With a null projection, it strips document metadata
        var fields = {$submit: true};

        backend.db.getSnapshot(collection, id, fields, null, function (err, snapshot) {
            if (err) return callback(err);

            request.snapshot = snapshot;
            request._addSnapshotMeta();

            if (op.v == null) {

                if (op.create && snapshot.type && op.src) {
                    // If the document was already created by another op, we will return a
                    // 'Document already exists' error in response and fail to submit this
                    // op. However, this could also happen in the case that the op was
                    // already committed and the create op was simply resent. In that
                    // case, we should return a non-fatal 'Op already submitted' error. We
                    // must get the past ops and check their src and seq values to
                    // differentiate.
                    backend.db.getCommittedOpVersion(collection, id, snapshot, op, null, function (err, version) {
                        if (err) return callback(err);
                        if (version == null) {
                            callback(request.alreadyCreatedError());
                        } else {
                            op.v = version;
                            callback(request.alreadySubmittedError());
                        }
                    });
                    return;
                }

                // Submitting an op with a null version means that it should get the
                // version from the latest snapshot. Generally this will mean the op
                // won't be transformed, though transform could be called on it in the
                // case of a retry from a simultaneous submit
                op.v = snapshot.v;
            }

            if (op.v === snapshot.v) {
                // The snapshot hasn't changed since the op's base version. Apply
                // without transforming the op
                return request.apply(callback);
            }

            if (op.v > snapshot.v) {
                // The op version should be from a previous snapshot, so it should never
                // never exceed the current snapshot's version
                return callback(request.newerVersionError());
            }

            // Transform the op up to the current snapshot version, then apply
            var from = op.v;
            backend.db.getOpsToSnapshot(collection, id, from, snapshot, null, function (err, ops) {
                if (err) return callback(err);

                if (ops.length !== snapshot.v - from) {
                    return callback(request.missingOpsError());
                }

                err = request._transformOp(ops);
                if (err) return callback(err);

                if (op.v !== snapshot.v) {
                    // This shouldn't happen, but is just a final sanity check to make
                    // sure we have transformed the op to the current snapshot version
                    return callback(request.versionAfterTransformError());
                }

                request.apply(callback);
            });
        });
    };

    public apply(callback) {
        // If we're being projected, verify that the op is allowed
        var projection = this.projection;
        if (projection && !projections.isOpAllowed(this.snapshot.type, projection.fields, this.op)) {
            return callback(this.projectionError());
        }

        // Always set the channels before each attempt to apply. If the channels are
        // modified in a middleware and we retry, we want to reset to a new array
        this.channels = this.backend.getChannels(this.collection, this.id);

        var request = this;
        this.backend.trigger('apply', this.agent, this, function (err) {
            if (err) return callback(err);

            // Apply the submitted op to the snapshot
            err = ot.apply(request.snapshot, request.op);
            if (err) return callback(err);

            request.commit(callback);
        });
    };

    public commit(callback) {
        var request = this;
        var backend = this.backend;
        backend.trigger('commit', this.agent, this, function (err) {
            if (err) return callback(err);

            // Try committing the operation and snapshot to the database atomically
            backend.db.commit(request.collection, request.id, request.op, request.snapshot, request.options, function (err, succeeded) {
                if (err) return callback(err);
                if (!succeeded) {
                    // Between our fetch and our call to commit, another client committed an
                    // operation. We expect this to be relatively infrequent but normal.
                    return request.retry(callback);
                }
                if (!request.suppressPublish) {
                    var op = request.op;
                    op.c = request.collection;
                    op.d = request.id;
                    op.m = undefined;
                    // Needed for agent to detect if it can ignore sending the op back to
                    // the client that submitted it in subscriptions
                    if (request.collection !== request.index) op.i = request.index;
                    backend.pubsub.publish(request.channels, op);
                }
                callback();
            });
        });
    };

    public retry(callback) {
        this.retries++;
        if (this.maxRetries != null && this.retries > this.maxRetries) {
            return callback(this.maxRetriesError());
        }
        this.backend.emit('timing', 'submit.retry', Date.now() - this.start, this);
        this.submit(callback);
    };

    public _transformOp(ops) {
        var type = this.snapshot.type;
        for (var i = 0; i < ops.length; i++) {
            var op = ops[i];

            if (this.op.src && this.op.src === op.src && this.op.seq === op.seq) {
                // The op has already been submitted. There are a variety of ways this
                // can happen in normal operation, such as a client resending an
                // unacknowledged operation at reconnect. It's important we don't apply
                // the same op twice
                return this.alreadySubmittedError();
            }

            if (this.op.v !== op.v) {
                return this.versionDuringTransformError();
            }

            var err = ot.transform(type, this.op, op);
            if (err) return err;
            this.ops.push(op);
        }
    };

    public _addOpMeta() {
        this.op.m = {
            ts: this.start
        };
        if (this.op.create) {
            // Consistently store the full URI of the type, not just its short name
            this.op.create.type = ot.normalizeType(this.op.create.type);
        }
    };

    public _addSnapshotMeta() {
        var meta = this.snapshot.m || (this.snapshot.m = {});
        if (this.op.create) {
            meta.ctime = this.start;
        } else if (this.op.del) {
            this.op.m.data = this.snapshot.data;
        }
        meta.mtime = this.start;
    };

// Non-fatal client errors:
    public alreadySubmittedError() {
        return {code: 4001, message: 'Op already submitted'};
    };

    public rejectedError() {
        return {code: 4002, message: 'Op submit rejected'};
    };

// Fatal client errors:
    public alreadyCreatedError() {
        return {code: 4010, message: 'Invalid op submitted. Document already created'};
    };

    public newerVersionError() {
        return {code: 4011, message: 'Invalid op submitted. Op version newer than current snapshot'};
    };

    public projectionError() {
        return {code: 4012, message: 'Invalid op submitted. Operation invalid in projected collection'};
    };

// Fatal internal errors:
    public missingOpsError() {
        return {
            code: 5001,
            message: 'Op submit failed. DB missing ops needed to transform it up to the current snapshot version'
        };
    };

    public versionDuringTransformError() {
        return {code: 5002, message: 'Op submit failed. Versions mismatched during op transform'};
    };

    public versionAfterTransformError() {
        return {code: 5003, message: 'Op submit failed. Op version mismatches snapshot after op transform'};
    };

    public maxRetriesError() {
        return {code: 5004, message: 'Op submit failed. Maximum submit retries exceeded'};
    };
}

module.exports = SubmitRequest;