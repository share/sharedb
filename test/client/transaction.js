var async = require('async');
var expect = require('chai').expect;

module.exports = function() {
  describe.only('transaction', function() {
    var backend;
    var connection;

    beforeEach(function() {
      backend = this.backend;
      connection = backend.connect();
    });

    it('commits two ops as a transaction', function(done) {
      var doc = connection.get('dogs', 'gaspode');
      var remoteDoc = backend.connect().get('dogs', 'gaspode');
      var transaction = connection.startTransaction();

      async.series([
        doc.create.bind(doc, {name: 'Gaspode'}),
        doc.submitOp.bind(doc, [{p: ['age'], oi: 3}], {transaction: transaction}),
        doc.submitOp.bind(doc, [{p: ['tricks'], oi: ['fetch']}], {transaction: transaction}),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({name: 'Gaspode'});
          next();
        },
        transaction.commit.bind(transaction),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({
            name: 'Gaspode',
            age: 3,
            tricks: ['fetch']
          });
          expect(doc.data).to.eql(remoteDoc.data);
          next();
        }
      ], done);
    });

    it('does not commit the first op if the second op fails', function(done) {
      var doc = connection.get('dogs', 'gaspode');
      var remoteDoc = backend.connect().get('dogs', 'gaspode');

      // TODO: Discuss if this is an acceptable API? Doc will always emit error on
      // a failed transaction, since the ops may have been successfully acked for this Doc, and
      // we force a hard rollback with no callback, which causes an 'error' event
      doc.on('error', () => {});

      backend.use('commit', function(request, next) {
        if (!request.snapshot.data.tricks) return next();
        next(new Error('fail'));
      });

      var transaction = connection.startTransaction();

      async.series([
        doc.create.bind(doc, {name: 'Gaspode'}),
        doc.submitOp.bind(doc, [{p: ['age'], oi: 3}], {transaction: transaction}),
        function(next) {
          doc.submitOp([{p: ['tricks'], oi: ['fetch']}], {transaction: transaction}, function(error) {
            expect(error.message).to.equal('fail');
          });
          doc.once('load', next);
        },
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({name: 'Gaspode'});
          expect(doc.data).to.eql(remoteDoc.data);
          next();
        }
      ], done);
    });

    it('deletes and creates as part of a transaction', function(done) {
      var doc = connection.get('dogs', 'gaspode');
      var remoteDoc = backend.connect().get('dogs', 'gaspode');

      doc.on('error', () => {});

      var transaction = connection.startTransaction();

      async.series([
        doc.create.bind(doc, {name: 'Gaspode'}),
        doc.del.bind(doc, {transaction: transaction}),
        doc.create.bind(doc, {name: 'Recreated'}, 'json0', {transaction: transaction}),
        remoteDoc.fetch.bind(remoteDoc),
        function (next) {
          expect(remoteDoc.data).to.eql({name: 'Gaspode'});
          next();
        },
        transaction.commit.bind(transaction),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({name: 'Recreated'});
          expect(doc.data).to.eql(remoteDoc.data);
          next();
        }
      ], done);
    });

    it('does not delete if the following create fails', function(done) {
      var doc = connection.get('dogs', 'gaspode');
      var remoteDoc = backend.connect().get('dogs', 'gaspode');

      doc.on('error', () => {});

      var transaction = connection.startTransaction();

      async.series([
        doc.create.bind(doc, {name: 'Gaspode'}),
        function(next) {
          backend.use('commit', function(request, next) {
            var error = request.op.create ? new Error('Create not allowed') : null;
            next(error);
          });
          next();
        },
        doc.del.bind(doc, {transaction: transaction}),
        function(next) {
          doc.create({name: 'Recreated'}, 'json0', {transaction: transaction}, function(error) {
            expect(error.message).to.equal('Create not allowed');
          });
          doc.once('load', next);
        },
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({name: 'Gaspode'});
          expect(doc.data).to.eql(remoteDoc.data);
          next();
        }
      ], done);
    });
  });
}
