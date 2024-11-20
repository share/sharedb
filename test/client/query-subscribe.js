var expect = require('chai').expect;
var async = require('async');
var util = require('../util');
var sinon = require('sinon');
var ShareDBError = require('../../lib/error');

module.exports = function(options) {
  var getQuery = options.getQuery;

  describe('client query subscribe', function() {
    before(function() {
      this.matchAllDbQuery = getQuery({query: {}});
    });

    afterEach(function() {
      sinon.restore();
    });

    commonTests(options);

    describe('custom channels', function() {
      it('only informs subscribed channels', function(done) {
        this.backend.use('connect', function(context, next) {
          context.agent.custom = context.req;
          next();
        });

        this.backend.use('commit', function(context, next) {
          var user = context.agent.custom;

          if (user === 'sending-user-1') {
            context.channels.push('channel-1');
          }
          if (user === 'sending-user-2') {
            context.channels.push('channel-2');
          }
          next();
        });

        this.backend.use('query', function(context, next) {
          var user = context.agent.custom;
          if (user === 'receiving-user') {
            context.channels = ['channel-1', 'channel-2'];
          } else if (user === 'not-receiving-user') {
            context.channels = ['different-channel'];
          }
          next();
        });

        var receivingUserConnection = this.backend.connect(null, 'receiving-user');
        var notReceivingUserConnection = this.backend.connect(null, 'not-receiving-user');
        var sendingUser1Connection = this.backend.connect(null, 'sending-user-1');
        var sendingUser2Connection = this.backend.connect(null, 'sending-user-2');

        var notReceivingQuery = notReceivingUserConnection.createSubscribeQuery(
          'dogs',
          this.matchAllDbQuery,
          null,
          function(err) {
            if (err) return done(err);
          }
        );

        notReceivingQuery.on('error', done);
        notReceivingQuery.on('insert', function() {
          done('User who didn\'t subscribed to sending channels shouldn\'t get the message');
        });

        var receivingQuery = receivingUserConnection.createSubscribeQuery(
          'dogs',
          this.matchAllDbQuery,
          null,
          function(err) {
            if (err) return done(err);
            sendingUser1Connection.get('dogs', '1').on('error', done).create({});
            sendingUser2Connection.get('dogs', '2').on('error', done).create({});
          }
        );
        var receivedDogsCount = 0;
        receivingQuery.on('error', done);
        receivingQuery.on('insert', function() {
          receivedDogsCount++;
          if (receivedDogsCount === 2) {
            var allDocsIds = receivingQuery.results.map(function(doc) {
              return doc.id;
            });
            expect(allDocsIds.sort()).to.be.deep.equal(['1', '2']);
            done();
          } else if (receivedDogsCount > 2) {
            done('It should not duplicate messages');
          }
        });
      });

      describe('one common channel', function() {
        beforeEach(function() {
          this.backend.use('commit', function(context, next) {
            context.channels.push('channel-1');
            context.channels.push('channel-3');
            next();
          });
          this.backend.use('query', function(context, next) {
            context.channels = ['channel-1', 'channel-2'];
            next();
          });
        });

        commonCustomChannelsErrorHandlingTests();
        commonTests(options);
      });

      describe('multiple common channels', function() {
        beforeEach(function() {
          this.backend.use('commit', function(context, next) {
            context.channels.push('channel-1');
            context.channels.push('channel-2');
            next();
          });
          this.backend.use('query', function(context, next) {
            context.channels = ['channel-1', 'channel-2'];
            next();
          });
        });

        it('does not duplicate messages', function(done) {
          var connection = this.backend.connect();
          var count = 0;
          var query = connection.createSubscribeQuery(
            'dogs',
            this.matchAllDbQuery,
            {pollInterval: 0, pollDebounce: 0},
            function(err) {
              if (err) return done(err);
              connection.get('dogs', '1').on('error', done).create({});
              connection.get('dogs', '2').on('error', done).create({});
              connection.get('dogs', '3').on('error', done).create({});
            }
          );
          query.on('error', done);
          query.on('insert', function() {
            count++;
            if (count === 3) {
              var allDocsIds = query.results.map(function(doc) {
                return doc.id;
              });
              expect(allDocsIds.sort()).to.be.deep.equal(['1', '2', '3']);
              done();
            } else if (count > 3) {
              done('It should not duplicate messages');
            }
          });
        });

        commonCustomChannelsErrorHandlingTests();
        commonTests(options);
      });

      describe('backward compatibility', function() {
        beforeEach(function() {
          this.backend.use('commit', function(context, next) {
            context.channels.push('channel-1');
            next();
          });
          this.backend.use('query', function(context, next) {
            context.channel = 'channel-1';
            next();
          });
        });
        commonTests(options);
      });
    });
  });
};

function commonCustomChannelsErrorHandlingTests() {
  it('should throw if not channels provided in query', function(done) {
    this.backend.use('query', function(context, next) {
      context.channels = null;
      next();
    });
    var connection = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (!err) return done('Should throw Required minimum one query channel error');
        expect(err.message).to.be.equal('Required minimum one query channel.');
        expect(err.code).to.be.equal(ShareDBError.CODES.ERR_QUERY_CHANNEL_MISSING);
        done();
      });
    });
  });

  it('should throw if channels provided in query is an empty array', function(done) {
    this.backend.use('query', function(context, next) {
      context.channels = [];
      next();
    });
    var connection = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (!err) return done('Should throw Required minimum one query channel error');
        expect(err.message).to.be.equal('Required minimum one query channel.');
        expect(err.code).to.be.equal(ShareDBError.CODES.ERR_QUERY_CHANNEL_MISSING);
        done();
      });
    });
  });
}

function commonTests(options) {
  var getQuery = options.getQuery;

  it('creating a document updates a subscribed query', function(done) {
    var connection = this.backend.connect();
    var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err) {
      if (err) return done(err);
      connection.get('dogs', 'fido').on('error', done).create({age: 3});
    });
    query.on('error', done);
    query.on('insert', function(docs, index) {
      expect(util.pluck(docs, 'id')).eql(['fido']);
      expect(util.pluck(docs, 'data')).eql([{age: 3}]);
      expect(index).equal(0);
      expect(util.pluck(query.results, 'id')).eql(['fido']);
      expect(util.pluck(query.results, 'data')).eql([{age: 3}]);
      done();
    });
  });

  it('creating an additional document updates a subscribed query', function(done) {
    var connection = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'taco').on('error', done).create({age: 2});
      });
      query.on('error', done);
      query.on('insert', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['taco']);
        expect(util.pluck(docs, 'data')).eql([{age: 2}]);
        expect(query.results[index]).equal(docs[0]);
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['fido', 'spot', 'taco']);
        expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}, {age: 2}]);
        done();
      });
    });
  });

  it('deleting a document updates a subscribed query', function(done) {
    var connection = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').del();
      });
      query.on('error', done);
      query.on('remove', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        expect(util.pluck(docs, 'data')).eql([undefined]);
        expect(index).a('number');
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['spot']);
        expect(util.pluck(results, 'data')).eql([{age: 5}]);
        done();
      });
    });
  });

  it('subscribed query removes document from results before sending delete op to other clients', function(done) {
    var connection1 = this.backend.connect();
    var connection2 = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection1.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection1.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection2.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection1.get('dogs', 'fido').del();
      });
      query.on('error', done);
      var removed = false;
      connection2.get('dogs', 'fido').on('del', function() {
        expect(removed).equal(true);
        done();
      });
      query.on('remove', function(docs, index) {
        removed = true;
        expect(util.pluck(docs, 'id')).eql(['fido']);
        expect(util.pluck(docs, 'data')).eql([{age: 3}]);
        expect(index).a('number');
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['spot']);
        expect(util.pluck(results, 'data')).eql([{age: 5}]);
      });
    });
  });

  it('subscribed query does not get updated after destroyed', function(done) {
    var connection = this.backend.connect();
    var connection2 = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        query.destroy(function(err) {
          if (err) return done(err);
          connection2.get('dogs', 'taco').on('error', done).create({age: 2}, done);
        });
      });
      query.on('error', done);
      query.on('insert', function() {
        done();
      });
    });
  });

  it('subscribed query does not get updated after connection is disconnected', function(done) {
    var connection = this.backend.connect();
    var connection2 = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.close();
        connection2.get('dogs', 'taco').on('error', done).create({age: 2}, done);
      });
      query.on('error', done);
      query.on('insert', function() {
        done();
      });
    });
  });

  it('subscribed query gets update after reconnecting', function(done) {
    var backend = this.backend;
    var connection = backend.connect();
    var connection2 = backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);

      var wait = 2;
      function finish() {
        if (--wait) return;
        expect(util.pluck(query.results, 'id')).to.have.members(['fido', 'spot', 'taco']);
        done();
      }

      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.close();
        connection2.get('dogs', 'taco').on('error', done).create({age: 2});
        process.nextTick(function() {
          backend.connect(connection);
          query.on('ready', finish);
        });
      });
      query.on('error', done);
      query.on('insert', finish);
    });
  });

  it('subscribed query gets simultaneous insert and remove after reconnecting', function(done) {
    var backend = this.backend;
    var connection = backend.connect();
    var connection2 = backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery);
      query.on('error', done);

      query.once('ready', function() {
        connection.close();

        connection2.get('dogs', 'fido').fetch(function(err) {
          if (err) return done(err);
          async.parallel([
            function(cb) {
              connection2.get('dogs', 'fido').del(cb);
            },
            function(cb) {
              connection2.get('dogs', 'taco').create({age: 2}, cb);
            }
          ], function(error) {
            if (error) return done(error);
            backend.connect(connection);
            query.once('ready', function() {
              finish();
            });
          });
        });
      });

      var wait = 3;
      function finish() {
        if (--wait) return;
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['spot', 'taco']);
        expect(util.pluck(results, 'data')).eql([{age: 5}, {age: 2}]);
        done();
      }
      query.once('insert', function(docs) {
        expect(util.pluck(docs, 'id')).eql(['taco']);
        expect(util.pluck(docs, 'data')).eql([{age: 2}]);
        finish();
      });
      query.once('remove', function(docs) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        // We don't assert the value of data, because the del op could be
        // applied by the client before or after the query result is removed.
        // Order of ops & query result updates is not currently guaranteed
        finish();
      });
    });
  });

  it('creating an additional document updates a subscribed query', function(done) {
    var connection = this.backend.connect();
    var matchAllDbQuery = this.matchAllDbQuery;
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var query = connection.createSubscribeQuery('dogs', matchAllDbQuery, null, function(err) {
        if (err) return done(err);
        connection.get('dogs', 'taco').on('error', done).create({age: 2});
      });
      query.on('error', done);
      query.on('insert', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['taco']);
        expect(util.pluck(docs, 'data')).eql([{age: 2}]);
        expect(query.results[index]).equal(docs[0]);
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['fido', 'spot', 'taco']);
        expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}, {age: 2}]);
        done();
      });
    });
  });

  it('pollDebounce option reduces subsequent poll interval', function(done) {
    var clock = sinon.useFakeTimers();
    var connection = this.backend.connect();
    this.backend.db.canPollDoc = function() {
      return false;
    };
    var query = connection.createSubscribeQuery('items', this.matchAllDbQuery, {pollDebounce: 2000});
    query.on('error', done);
    var batchSizes = [];
    var total = 0;

    query.on('insert', function(docs) {
      batchSizes.push(docs.length);
      total += docs.length;

      if (total === 1) {
        // first write received by client. we're debouncing. create 9
        // more documents.
        var counter = 0;
        for (var i = 1; i < 10; i++) {
          connection.get('items', i.toString()).on('error', done).create({}, function(err) {
            if (err) return done(err);
            counter++;
            if (counter === 9) clock.tickAsync(10000);
          });
        }
      }
      if (total === 10) {
        // first document is its own batch; then subsequent creates
        // are debounced and batched
        expect(batchSizes[0]).eql(1);
        batchSizes.shift();
        var sum = batchSizes.reduce(function(sum, batchSize) {
          return sum + batchSize;
        }, 0);
        expect(batchSizes.length).to.lessThan(9);
        expect(sum).eql(9);
        done();
      }
    });

    // create an initial document. this will lead to the 'insert'
    // event firing the first time, while sharedb is definitely
    // debouncing
    connection.get('items', '0').on('error', done).create({}, function() {
      clock.tickAsync(3000);
    });
  });

  it('db.pollDebounce option reduces subsequent poll interval', function(done) {
    var clock = sinon.useFakeTimers();
    var connection = this.backend.connect();
    this.backend.db.canPollDoc = function() {
      return false;
    };
    this.backend.db.pollDebounce = 2000;
    var query = connection.createSubscribeQuery('items', this.matchAllDbQuery);
    query.on('error', done);
    var batchSizes = [];
    var total = 0;

    query.on('insert', function(docs) {
      batchSizes.push(docs.length);
      total += docs.length;

      if (total === 1) {
        // first write received by client. we're debouncing. create 9
        // more documents.
        var counter = 0;
        for (var i = 1; i < 10; i++) {
          connection.get('items', i.toString()).on('error', done).create({}, function(err) {
            if (err) return done(err);
            counter++;
            if (counter === 9) clock.tickAsync(10000);
          });
        }
      }
      if (total === 10) {
        // first document is its own batch; then subsequent creates
        // are debounced and batched
        expect(batchSizes[0]).eql(1);
        batchSizes.shift();
        var sum = batchSizes.reduce(function(sum, batchSize) {
          return sum + batchSize;
        }, 0);
        expect(batchSizes.length).to.lessThan(9);
        expect(sum).eql(9);
        done();
      }
    });

    // create an initial document. this will lead to the 'insert'
    // event firing the first time, while sharedb is definitely
    // debouncing
    connection.get('items', '0').on('error', done).create({}, function() {
      clock.tickAsync(3000);
    });
  });

  it('pollInterval updates a subscribed query after an unpublished create', function(done) {
    var clock = sinon.useFakeTimers();
    var connection = this.backend.connect();
    this.backend.suppressPublish = true;
    var query = connection.createSubscribeQuery(
      'dogs',
      this.matchAllDbQuery,
      {pollDebounce: 0, pollInterval: 50},
      function(err) {
        if (err) return done(err);
        connection.get('dogs', 'fido').on('error', done).create({}, function() {
          clock.tickAsync(51);
        });
      }
    );
    query.on('error', done);
    query.on('insert', function(docs) {
      expect(util.pluck(docs, 'id')).eql(['fido']);
      done();
    });
  });

  it('db.pollInterval updates a subscribed query after an unpublished create', function(done) {
    var clock = sinon.useFakeTimers();
    var connection = this.backend.connect();
    this.backend.suppressPublish = true;
    this.backend.db.pollDebounce = 0;
    this.backend.db.pollInterval = 50;
    var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err) {
      if (err) return done(err);
      connection.get('dogs', 'fido').on('error', done).create({}, function() {
        clock.tickAsync(51);
      });
    });
    query.on('error', done);
    query.on('insert', function(docs) {
      expect(util.pluck(docs, 'id')).eql(['fido']);
      done();
    });
  });

  it('pollInterval captures additional unpublished creates', function(done) {
    var clock = sinon.useFakeTimers();
    var connection = this.backend.connect();
    this.backend.suppressPublish = true;
    var count = 0;

    var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, {pollInterval: 1000}, function(err) {
      if (err) return done(err);
      var doc = connection.get('dogs', count.toString()).on('error', done);
      doc.create({}, function(e) {
        if (e) return done(e);
        clock.tickAsync(2000);
      });
    });
    query.on('error', done);
    query.on('insert', function() {
      count++;
      if (count === 3) return done();
      var doc = connection.get('dogs', count.toString()).on('error', done);
      doc.create({}, function(e) {
        if (e) return done(e);
        clock.tickAsync(10000);
      });
    });
    clock.tickAsync(1);
  });

  it('query extra is returned to client', function(done) {
    var connection = this.backend.connect();
    this.backend.db.query = function(collection, query, fields, options, callback) {
      process.nextTick(function() {
        callback(null, [], {colors: ['brown', 'gold']});
      });
    };
    var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err, results, extra) {
      if (err) return done(err);
      expect(results).eql([]);
      expect(extra).eql({colors: ['brown', 'gold']});
      expect(query.extra).eql({colors: ['brown', 'gold']});
      done();
    });
    query.on('error', done);
  });

  it('query extra is updated on change', function(done) {
    var connection = this.backend.connect();
    this.backend.db.query = function(collection, query, fields, options, callback) {
      process.nextTick(function() {
        callback(null, [], 1);
      });
    };
    this.backend.db.queryPoll = function(collection, query, options, callback) {
      process.nextTick(function() {
        callback(null, [], 2);
      });
    };
    this.backend.db.canPollDoc = function() {
      return false;
    };
    var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery, null, function(err, results, extra) {
      if (err) return done(err);
      expect(extra).eql(1);
      expect(query.extra).eql(1);
    });
    query.on('error', done);
    query.on('extra', function(extra) {
      expect(extra).eql(2);
      expect(query.extra).eql(2);
      done();
    });
    connection.get('dogs', 'fido').on('error', done).create({age: 3});
  });

  it('does not reply if the agent is closed before the query returns', function(done) {
    var backend = this.backend;
    var connection = backend.connect();
    var agent = connection.agent;

    backend.use('query', function(request, next) {
      backend.use('reply', function() {
        done(new Error('unexpected reply'));
      });

      expect(agent.closed).to.be.false;
      agent.stream.on('close', function() {
        expect(agent.closed).to.be.true;
        next();
        done();
      });

      agent.close();
    });

    connection.createSubscribeQuery('dogs', {});
  });

  describe('passing agent.custom to the DB adapter', function() {
    var connection;
    var expectedArg = {
      agentCustom: {foo: 'bar'}
    };
    beforeEach('set up', function() {
      connection = this.backend.connect();
      connection.agent.custom = {
        foo: 'bar'
      };
    });

    it('sends agentCustom to the db\'s getSnapshot call', function(done) {
      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery);
      var getSnapshotSpy = sinon.spy(this.backend.db, 'getSnapshot');

      query.on('insert', function() {
        // The first call to getSnapshot is when the document is created
        // The seconds call is when the event is triggered, and is the one we are testing here
        expect(getSnapshotSpy.callCount).to.equal(2);
        expect(getSnapshotSpy.getCall(1).args[3]).to.deep.equal(expectedArg);
        done();
      });
      connection.get('dogs', 'fido').create({age: 3});
    });

    it('sends agentCustom to the db\'s getSnapshotBulk call', function(done) {
      // Ensures that getSnapshotBulk is called, instead of getSnapshot
      this.backend.db.canPollDoc = function() {
        return false;
      };

      var query = connection.createSubscribeQuery('dogs', this.matchAllDbQuery);
      var getSnapshotBulkSpy = sinon.spy(this.backend.db, 'getSnapshotBulk');

      query.on('insert', function() {
        expect(getSnapshotBulkSpy.callCount).to.equal(1);
        expect(getSnapshotBulkSpy.getCall(0).args[3]).to.deep.equal(expectedArg);
        done();
      });
      connection.get('dogs', 'fido').create({age: 3});
    });
  });

  it('changing a filtered property removes from a subscribed query', function(done) {
    var connection = this.backend.connect();
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 3}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var dbQuery = getQuery({query: {age: 3}});
      var query = connection.createSubscribeQuery('dogs', dbQuery, null, function(err, results) {
        if (err) return done(err);
        var sorted = util.sortById(results);
        expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
        expect(util.pluck(sorted, 'data')).eql([{age: 3}, {age: 3}]);
        connection.get('dogs', 'fido').submitOp({p: ['age'], na: 2});
      });
      query.on('error', done);
      query.on('remove', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['fido']);
        expect(util.pluck(docs, 'data')).eql([{age: 5}]);
        expect(index).a('number');
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['spot']);
        expect(util.pluck(results, 'data')).eql([{age: 3}]);
        done();
      });
    });
  });

  it('changing a filtered property inserts to a subscribed query', function(done) {
    var connection = this.backend.connect();
    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var dbQuery = getQuery({query: {age: 3}});
      var query = connection.createSubscribeQuery('dogs', dbQuery, null, function(err, results) {
        if (err) return done(err);
        var sorted = util.sortById(results);
        expect(util.pluck(sorted, 'id')).eql(['fido']);
        expect(util.pluck(sorted, 'data')).eql([{age: 3}]);
        connection.get('dogs', 'spot').submitOp({p: ['age'], na: -2});
      });
      query.on('error', done);
      query.on('insert', function(docs, index) {
        expect(util.pluck(docs, 'id')).eql(['spot']);
        expect(util.pluck(docs, 'data')).eql([{age: 3}]);
        expect(index).a('number');
        var results = util.sortById(query.results);
        expect(util.pluck(results, 'id')).eql(['fido', 'spot']);
        expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 3}]);
        done();
      });
    });
  });

  it('changing a sorted property moves in a subscribed query', function(done) {
    var connection = this.backend.connect();

    async.parallel([
      function(cb) {
        connection.get('dogs', 'fido').on('error', done).create({age: 3}, cb);
      },
      function(cb) {
        connection.get('dogs', 'spot').on('error', done).create({age: 5}, cb);
      }
    ], function(err) {
      if (err) return done(err);
      var dbQuery = getQuery({query: {}, sort: [['age', 1]]});
      var query = connection.createSubscribeQuery(
        'dogs',
        dbQuery,
        null,
        function(err, results) {
          if (err) return done(err);
          expect(util.pluck(results, 'id')).eql(['fido', 'spot']);
          expect(util.pluck(results, 'data')).eql([{age: 3}, {age: 5}]);
          connection.get('dogs', 'spot').submitOp({p: ['age'], na: -3});
        });
      query.on('error', done);
      query.on('move', function(docs, from, to) {
        expect(docs.length).eql(1);
        expect(from).a('number');
        expect(to).a('number');
        expect(util.pluck(query.results, 'id')).eql(['spot', 'fido']);
        expect(util.pluck(query.results, 'data')).eql([{age: 2}, {age: 3}]);
        done();
      });
    });
  });

  it('returns pubSub error if fails to subscribe to channel', function(done) {
    sinon.stub(this.backend.pubsub, 'subscribe').callsFake(function(_channel, callback) {
      callback(new Error('TEST_ERROR'));
    });
    var connection = this.backend.connect();
    connection.createSubscribeQuery(
      'dogs',
      this.matchAllDbQuery,
      {pollInterval: 0, pollDebounce: 0},
      function(err) {
        if (err) {
          expect(err.message).to.be.equal('TEST_ERROR');
          return done();
        } else {
          done('Should call callback with pubsub subscribe error');
        }
      }
    );
  });
}
