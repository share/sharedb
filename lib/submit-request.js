var ot = require('./ot');

var MAX_RETRIES = 100;

function SubmitRequest(livedb, cName, docName, opData, callback) {
  this.projection = livedb.projections[cName];
  ot.normalize(opData);

  this.livedb = livedb;
  // If a projection, rewrite the call into a call against the collection
  this.cName = (this.projection) ? projection.target : cName;
  this.docName = docName;
  this.opData = opData;
  this.callback = callback;

  this.start = Date.now();
  this.transformedOps = [];
  this.expectTransform = false;
  this.retries = 0;
}

SubmitRequest.prototype.run = function() {
  var self = this;
  var livedb = this.livedb;
  var cName = this.cName;
  var docName = this.docName;
  var opData = this.opData;
  var callback = this.callback;

  livedb.fetch(cName, docName, function(err, snapshot) {
    if (err) return callback(err);

    // Get all operations that might be relevant. We'll float the snapshot
    // and the operation up to the most recent version of the document, then
    // try submitting.
    var from = (opData.v != null && opData.v < snapshot.v) ? opData.v : snapshot.v;
    var to = null;
    livedb.db.getOps(cName, docName, from, to, function(err, ops) {
      if (err) return callback(err);

      if (ops.length) {
        livedb.emit('increment', 'submit.transformNeeded');
      } else if (self.retries > 0) {
        var err = {
          code: 5001,
          message: 'No new ops returned when retrying unsuccessful submit',
          collection: cName,
          id: docName,
          from: from,
          to: to,
          op: opData,
          tries: self.retries
        };
        return callback(err);
      }

      var err = applyCommittedOps(opData, snapshot, ops, self.transformedOps);
      if (err) return callback(err);

      // Setting the version here has ramifications if we have to retry -
      // we'll transform by any new operations which hit from this point on.
      // In reality, it shouldn't matter. But its important to know that even
      // if you pass a null version into submit, its still possible for
      // transform() to get called.
      if (opData.v == null) {
        opData.v = snapshot.v;
      } else if (opData.v !== snapshot.v) {
        return callback('Invalid opData version');
      }

      // If we're being projected, verify that the op is allowed.
      if (self.projection && !projections.isOpDataAllowed(snapshot.type, self.projection.fields, opData)) {
        return callback('Operation invalid in projected collection');
      }

      if (!livedb.suppressPublish) {
        var preChannels = livedb.getPublishChannels(cName, docName, opData, snapshot);
      }

      // Ok, now we can try to apply the op.
      err = ot.apply(snapshot, opData);
      if (err) return callback(err);

      if (!livedb.suppressPublish) {
        var postChannels = livedb.getPublishChannels(cName, docName, opData, snapshot);
        var channels = getChannels(self.cName, self.docName, preChannels, postChannels);
      }

      self._commit(snapshot, channels);
    });
  });
};

SubmitRequest.prototype._commit = function(snapshot, channels) {
  var self = this;
  // Try committing the operation and snapshot to the database atomically
  this.livedb.db.commit(this.cName, this.docName, this.opData, snapshot, function(err, succeeded) {
    if (err) return callback(err);
    if (!succeeded) {
      // Between our fetch and our call to commit, another client
      // committed an operation. This retry loop could be optimized, but
      // we currently expect it to be rare
      self.expectTransform = true;
      return self.run(self);
    }

    if (channels) {
      livedb.driver.publish(channels, opData);
    }

    livedb.emit('timing', 'submit', Date.now() - self.start);
    callback(err, snapshot, self.transformedOps);
  });
};

SubmitRequest.prototype._retry = function() {
  if (this.retries >= this.livedb.maxSubmitRetries) {
    var err = {
      code: 5002,
      message: 'Maximum submit retries exceeded',
      collection: this.cName,
      id: this.docName,
      op: this.opData,
      retries: this.retries
    }
    return this.callback();
  }
};

function applyCommittedOps(opData, snapshot, ops, transformedOps) {
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];

    if (opData.src && opData.src === op.src && opData.seq === op.seq) {
      // The op has already been submitted. There's a variety of ways this can
      // happen. It's important we don't apply the same op twice
      return 'Op already submitted';
    }

    // Bring both the op and the snapshot up to date. At least one of
    // these two conditionals should be true.
    if (snapshot.v === op.v) {
      err = ot.apply(snapshot, op);
      if (err) return err;
    }
    if (opData.v === op.v) {
      transformedOps.push(op);
      err = ot.transform(snapshot.type, opData, op);
      if (err) return err;
    }
  }
}
