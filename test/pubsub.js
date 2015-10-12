var expect = require('expect.js');

module.exports = function(create) {
  describe('pubsub', function() {
    beforeEach(function(done) {
      var self = this;
      create(function(err, pubsub) {
        if (err) throw err;
        self.pubsub = pubsub;
        done();
      });
    });

    afterEach(function(done) {
      this.pubsub.close(done);
    });

    it('can subscribe to a channel', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('x', function(err, stream) {
        if (err) throw err;
        stream.on('data', function(data) {
          expect(data).eql({test: true});
          done();
        });
        pubsub.publish(['x', 'y'], {test: true});
      });
    });

    it('stream.destroy() unsubscribes from a channel', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('x', function(err, stream) {
        if (err) throw err;
        expect(pubsub.streamsCount).equal(1);
        stream.on('data', function() {
          // Will error if done is called twice
          done();
        });
        stream.destroy();
        expect(pubsub.streamsCount).equal(0);
        pubsub.publish(['x', 'y'], {test: true});
        done();
      });
    });
  });
};
