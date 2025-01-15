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
        transaction.commit.bind(transaction),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({
            name: 'Gaspode',
            age: 3,
            tricks: ['fetch']
          });
          next();
        }
      ], done);
    });

    it('does not commit the first op if the second op fails', function(done) {
      var doc = connection.get('dogs', 'gaspode');
      var remoteDoc = backend.connect().get('dogs', 'gaspode');

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
            next();
          });
        },
        function(next) {
          transaction.commit(function(error) {
            expect(error.code).to.equal('ERR_TRANSACTION_ABORTED');
            next();
          });
        },
        // TODO: Assert hard rollback
        doc.destroy.bind(doc),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          expect(remoteDoc.data).to.eql({name: 'Gaspode'});
          next();
        }
      ], done);
    });
  });
}
