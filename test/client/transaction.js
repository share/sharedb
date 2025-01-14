var async = require('async');
var expect = require('chai').expect;

module.exports = function() {
  describe.only('transaction', function() {
    describe('single transaction', function() {
      var backend;
      var connection;

      beforeEach(function() {
        backend = this.backend;
        connection = backend.connect();
      });

      it('does not commit the first op if the second op fails', function(done) {
        var doc = connection.get('dogs', 'gaspode');
        // Disable composing to force two submissions
        doc.preventCompose = true;

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
          function(next) {
            doc = connection.get('dogs', 'gaspode');
            doc.fetch(next);
          },
          function(next) {
            expect(doc.data).to.eql({name: 'Gaspode'});
            next();
          }
        ], done);
      });
    });
  });
}
