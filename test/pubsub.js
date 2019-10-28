var expect = require('chai').expect;

module.exports = function(create) {
  describe('pubsub', function() {
    beforeEach(function(done) {
      var self = this;
      create(function(err, pubsub) {
        if (err) done(err);
        self.pubsub = pubsub;
        done();
      });
    });

    afterEach(function(done) {
      this.pubsub.close(done);
    });

    it('can call pubsub.close() without callback', function(done) {
      create(function(err, pubsub) {
        if (err) done(err);
        pubsub.close();
        done();
      });
    });

    it('can subscribe to a channel', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('x', function(err, stream) {
        if (err) done(err);
        stream.on('data', function(data) {
          expect(data).eql({test: true});
          done();
        });
        expect(pubsub.streamsCount).equal(1);
        pubsub.publish(['x'], {test: true});
      });
    });

    it('publish optional callback returns', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('x', function(err) {
        if (err) done(err);
        pubsub.publish(['x'], {test: true}, done);
      });
    });

    it('can subscribe to a channel twice', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('y', function(err) {
        if (err) done(err);
        pubsub.subscribe('y', function(err, stream) {
          if (err) done(err);
          stream.on('data', function(data) {
            expect(data).eql({test: true});
            done();
          });
          expect(pubsub.streamsCount).equal(2);
          pubsub.publish(['x', 'y'], {test: true});
        });
      });
    });

    it('stream.destroy() unsubscribes from a channel', function(done) {
      var pubsub = this.pubsub;
      pubsub.subscribe('x', function(err, stream) {
        if (err) done(err);
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

    it('can emit events', function(done) {
      this.pubsub.on('error', function(err) {
        expect(err).instanceOf(Error);
        expect(err.message).equal('test error');
        done();
      });
      this.pubsub.emit('error', new Error('test error'));
    });
  });
};
