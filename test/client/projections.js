var expect = require('chai').expect;
var util = require('../util');

module.exports = function(options) {
  var getQuery = options.getQuery;
  var matchAllQuery = getQuery && getQuery({query: {}});

  describe('client projections', function() {
    beforeEach(function(done) {
      this.backend.addProjection('dogs_summary', 'dogs', {age: true, owner: true});
      this.connection = this.backend.connect();
      var data = {age: 3, color: 'gold', owner: {name: 'jim'}, litter: {count: 4}};
      this.connection.get('dogs', 'fido').create(data, done);
    });

    ['fetch', 'subscribe'].forEach(function(method) {
      it('snapshot ' + method, function(done) {
        var connection2 = this.backend.connect();
        var fido = connection2.get('dogs_summary', 'fido');
        fido[method](function(err) {
          if (err) return done(err);
          expect(fido.data).eql({age: 3, owner: {name: 'jim'}});
          expect(fido.version).eql(1);
          done();
        });
      });
    });

    if (getQuery) {
      ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
        it('snapshot ' + method, function(done) {
          var connection2 = this.backend.connect();
          connection2[method]('dogs_summary', matchAllQuery, null, function(err, results) {
            if (err) return done(err);
            expect(results.length).eql(1);
            expect(results[0].data).eql({age: 3, owner: {name: 'jim'}});
            expect(results[0].version).eql(1);
            done();
          });
        });
      });
    }

    function opTests(test) {
      it('projected field', function(done) {
        test.call(this,
          {p: ['age'], na: 1},
          {age: 4, owner: {name: 'jim'}},
          done
        );
      });

      it('non-projected field', function(done) {
        test.call(this,
          {p: ['color'], oi: 'brown', od: 'gold'},
          {age: 3, owner: {name: 'jim'}},
          done
        );
      });

      it('parent field replace', function(done) {
        test.call(this,
          {
            p: [],
            oi: {age: 2, color: 'brown', owner: false},
            od: {age: 3, color: 'gold', owner: {name: 'jim'},
              litter: {count: 4}}
          },
          {age: 2, owner: false},
          done
        );
      });

      it('parent field set', function(done) {
        test.call(this,
          {p: [], oi: {age: 2, color: 'brown', owner: false}},
          {age: 2, owner: false},
          done
        );
      });

      it('projected child field', function(done) {
        test.call(this,
          {p: ['owner', 'sex'], oi: 'male'},
          {age: 3, owner: {name: 'jim', sex: 'male'}},
          done
        );
      });

      it('non-projected child field', function(done) {
        test.call(this,
          {p: ['litter', 'count'], na: 1},
          {age: 3, owner: {name: 'jim'}},
          done
        );
      });
    }

    describe('op fetch', function() {
      function test(op, expected, done) {
        var connection = this.connection;
        var connection2 = this.backend.connect();
        var fido = connection2.get('dogs_summary', 'fido');
        fido.fetch(function(err) {
          if (err) return done(err);
          connection.get('dogs', 'fido').submitOp(op, function(err) {
            if (err) return done(err);
            fido.fetch(function(err) {
              if (err) return done(err);
              expect(fido.data).eql(expected);
              expect(fido.version).eql(2);
              done();
            });
          });
        });
      };
      opTests(test);
    });

    describe('op subscribe', function() {
      function test(op, expected, done) {
        var connection = this.connection;
        var connection2 = this.backend.connect();
        var fido = connection2.get('dogs_summary', 'fido');
        fido.subscribe(function(err) {
          if (err) return done(err);
          fido.on('op', function() {
            expect(fido.data).eql(expected);
            expect(fido.version).eql(2);
            done();
          });
          connection.get('dogs', 'fido').submitOp(op);
        });
      };
      opTests(test);
    });

    if (getQuery) {
      describe('op fetch query', function() {
        function test(op, expected, done) {
          var connection = this.connection;
          var connection2 = this.backend.connect();
          var fido = connection2.get('dogs_summary', 'fido');
          fido.fetch(function(err) {
            if (err) return done(err);
            connection.get('dogs', 'fido').submitOp(op, function(err) {
              if (err) return done(err);
              connection2.createFetchQuery('dogs_summary', matchAllQuery, null, function(err) {
                if (err) return done(err);
                expect(fido.data).eql(expected);
                expect(fido.version).eql(2);
                done();
              });
            });
          });
        };
        opTests(test);
      });

      describe('op subscribe query', function() {
        function test(op, expected, done) {
          var connection = this.connection;
          var connection2 = this.backend.connect();
          var fido = connection2.get('dogs_summary', 'fido');
          connection2.createSubscribeQuery('dogs_summary', matchAllQuery, null, function(err) {
            if (err) return done(err);
            fido.on('op', function() {
              expect(fido.data).eql(expected);
              expect(fido.version).eql(2);
              done();
            });
            connection.get('dogs', 'fido').submitOp(op);
          });
        };
        opTests(test);
      });

      function queryUpdateTests(test) {
        it('doc create', function(done) {
          test.call(this,
            function(connection, callback) {
              var data = {age: 5, color: 'spotted', owner: {name: 'sue'}, litter: {count: 6}};
              connection.get('dogs', 'spot').create(data, callback);
            },
            function(err, results) {
              var sorted = util.sortById(results.slice());
              expect(sorted.length).eql(2);
              expect(util.pluck(sorted, 'id')).eql(['fido', 'spot']);
              expect(util.pluck(sorted, 'data')).eql([
                {age: 3, owner: {name: 'jim'}},
                {age: 5, owner: {name: 'sue'}}
              ]);
              done();
            }
          );
        });
      }

      describe('subscribe query', function() {
        function test(trigger, callback) {
          var connection = this.connection;
          var connection2 = this.backend.connect();
          var query = connection2.createSubscribeQuery('dogs_summary', matchAllQuery, null, function(err) {
            if (err) return callback(err);
            query.on('insert', function() {
              callback(null, query.results);
            });
            trigger(connection);
          });
        }
        queryUpdateTests(test);

        it('query subscribe on projection will update based on fields not in projection', function(done) {
          // Create a query on a field not in the projection. The query doesn't
          // match the doc created in beforeEach
          var fido = this.connection.get('dogs', 'fido');
          var connection2 = this.backend.connect();
          var dbQuery = getQuery({query: {color: 'black'}});
          var query = connection2.createSubscribeQuery('dogs_summary', dbQuery, null, function(err, results) {
            if (err) return done(err);
            expect(results).to.have.length(0);

            query.once('changed', function() {
              expect(query.results).to.have.length(1);
              expect(query.results[0].id).to.equal('fido');
              expect(query.results[0].data).to.eql({age: 3, owner: {name: 'jim'}});
              done();
            });

            // Submit an op on a field not in the projection, where the op should
            // cause the doc to be included in the query results
            fido.submitOp({p: ['color'], od: 'gold', oi: 'black'}, null, util.errorHandler(done));
          });
        });
      });

      describe('fetch query', function() {
        function test(trigger, callback) {
          var connection = this.connection;
          var connection2 = this.backend.connect();
          trigger(connection, function(err) {
            if (err) return callback(err);
            connection2.createFetchQuery('dogs_summary', matchAllQuery, null, callback);
          });
        }
        queryUpdateTests(test);
      });
    }

    describe('submit on projected doc', function() {
      function test(op, expected, done) {
        var doc = this.connection.get('dogs', 'fido');
        var projected = this.backend.connect().get('dogs_summary', 'fido');
        projected.fetch(function(err) {
          if (err) return done(err);
          projected.submitOp(op, function(err) {
            if (err) return done(err);
            doc.fetch(function(err) {
              if (err) return done(err);
              expect(doc.data).eql(expected);
              expect(doc.version).equal(2);
              done();
            });
          });
        });
      }
      function testError(op, done) {
        var doc = this.connection.get('dogs', 'fido');
        var projected = this.backend.connect().get('dogs_summary', 'fido');
        projected.fetch(function(err) {
          if (err) return done(err);
          projected.submitOp(op, function(err) {
            expect(err).instanceOf(Error);
            doc.fetch(function(err) {
              if (err) return done(err);
              expect(doc.data).eql({age: 3, color: 'gold', owner: {name: 'jim'}, litter: {count: 4}});
              expect(doc.version).equal(1);
              done();
            });
          });
        });
      }

      it('can set on projected field', function(done) {
        test.call(this,
          {p: ['age'], na: 1},
          {age: 4, color: 'gold', owner: {name: 'jim'}, litter: {count: 4}},
          done
        );
      });

      it('can set on child of projected field', function(done) {
        test.call(this,
          {p: ['owner', 'sex'], oi: 'male'},
          {age: 3, color: 'gold', owner: {name: 'jim', sex: 'male'}, litter: {count: 4}},
          done
        );
      });

      it('cannot set on non-projected field', function(done) {
        testError.call(this,
          {p: ['color'], od: 'gold', oi: 'tan'},
          done
        );
      });

      it('cannot set on root path of projected doc', function(done) {
        testError.call(this,
          {p: [], oi: null},
          done
        );
      });

      it('can delete on projected doc', function(done) {
        var doc = this.connection.get('dogs', 'fido');
        var projected = this.backend.connect().get('dogs_summary', 'fido');
        projected.fetch(function(err) {
          if (err) return done(err);
          projected.del(function(err) {
            if (err) return done(err);
            doc.fetch(function(err) {
              if (err) return done(err);
              expect(doc.data).eql(undefined);
              expect(doc.version).equal(2);
              done();
            });
          });
        });
      });

      it('can create a projected doc with only projected fields', function(done) {
        var doc = this.connection.get('dogs', 'spot');
        var projected = this.backend.connect().get('dogs_summary', 'spot');
        var data = {age: 5};
        projected.create(data, function(err) {
          if (err) return done(err);
          doc.fetch(function(err) {
            if (err) return done(err);
            expect(doc.data).eql({age: 5});
            expect(doc.version).equal(1);
            done();
          });
        });
      });

      it('cannot create a projected doc with non-projected fields', function(done) {
        var doc = this.connection.get('dogs', 'spot');
        var projected = this.backend.connect().get('dogs_summary', 'spot');
        var data = {age: 5, foo: 'bar'};
        projected.create(data, function(err) {
          expect(err).instanceOf(Error);
          doc.fetch(function(err) {
            if (err) return done(err);
            expect(doc.data).eql(undefined);
            expect(doc.version).equal(0);
            done();
          });
        });
      });
    });
  });

  describe('client sub-field projections', function() {
    beforeEach(function(done) {
      this.backend.addProjection('dogs_contact', 'dogs', {age: true, 'owner.name': true});
      this.connection = this.backend.connect();
      var data = {age: 3, color: 'gold', owner: {name: 'jim', phone: '555-0100'}};
      this.connection.get('dogs', 'fido').create(data, done);
    });

    ['fetch', 'subscribe'].forEach(function(method) {
      it('snapshot ' + method, function(done) {
        var fido = this.backend.connect().get('dogs_contact', 'fido');
        fido[method](function(err) {
          if (err) return done(err);
          expect(fido.data).eql({age: 3, owner: {name: 'jim'}});
          done();
        });
      });
    });

    if (getQuery) {
      ['createFetchQuery', 'createSubscribeQuery'].forEach(function(method) {
        it('snapshot ' + method, function(done) {
          this.backend.connect()[method]('dogs_contact', matchAllQuery, null, function(err, results) {
            if (err) return done(err);
            expect(util.pluck(results, 'data')).eql([{age: 3, owner: {name: 'jim'}}]);
            done();
          });
        });
      });
    }

    function opTests(test) {
      it('projected sub-field', function(done) {
        test.call(this,
          {p: ['owner', 'name'], od: 'jim', oi: 'bob'},
          {age: 3, owner: {name: 'bob'}},
          done
        );
      });

      it('edit inside a projected sub-field', function(done) {
        test.call(this,
          {p: ['owner', 'name', 3], si: 'my'},
          {age: 3, owner: {name: 'jimmy'}},
          done
        );
      });

      it('non-projected sibling sub-field', function(done) {
        test.call(this,
          {p: ['owner', 'phone'], od: '555-0100', oi: '555-0199'},
          {age: 3, owner: {name: 'jim'}},
          done
        );
      });

      it('parent of a projected sub-field replace', function(done) {
        test.call(this,
          {p: ['owner'], od: {name: 'jim', phone: '555-0100'}, oi: {name: 'sue', phone: '555-0142'}},
          {age: 3, owner: {name: 'sue'}},
          done
        );
      });
    }

    describe('op fetch', function() {
      opTests(function(op, expected, done) {
        var connection = this.connection;
        var fido = this.backend.connect().get('dogs_contact', 'fido');
        fido.fetch(function(err) {
          if (err) return done(err);
          connection.get('dogs', 'fido').submitOp(op, function(err) {
            if (err) return done(err);
            fido.fetch(function(err) {
              if (err) return done(err);
              expect(fido.data).eql(expected);
              expect(fido.version).eql(2);
              done();
            });
          });
        });
      });
    });

    describe('op subscribe', function() {
      opTests(function(op, expected, done) {
        var connection = this.connection;
        var fido = this.backend.connect().get('dogs_contact', 'fido');
        fido.subscribe(function(err) {
          if (err) return done(err);
          fido.on('op', function() {
            expect(fido.data).eql(expected);
            expect(fido.version).eql(2);
            done();
          });
          connection.get('dogs', 'fido').submitOp(op);
        });
      });
    });

    describe('submit on projected doc', function() {
      var original = {age: 3, color: 'gold', owner: {name: 'jim', phone: '555-0100'}};

      function submit(op, callback) {
        var doc = this.connection.get('dogs', 'fido');
        var projected = this.backend.connect().get('dogs_contact', 'fido');
        projected.fetch(function(err) {
          if (err) return callback(err);
          projected.submitOp(op, function(submitErr) {
            doc.fetch(function(err) {
              if (err) return callback(err);
              callback(submitErr, doc);
            });
          });
        });
      }

      it('can edit a projected sub-field', function(done) {
        submit.call(this, {p: ['owner', 'name'], od: 'jim', oi: 'bob'}, function(err, doc) {
          if (err) return done(err);
          expect(doc.data).eql({age: 3, color: 'gold', owner: {name: 'bob', phone: '555-0100'}});
          expect(doc.version).equal(2);
          done();
        });
      });

      it('cannot edit a non-projected sibling sub-field', function(done) {
        submit.call(this, {p: ['owner', 'phone'], od: '555-0100', oi: '555-0199'}, function(err, doc) {
          expect(err).instanceOf(Error);
          expect(doc.data).eql(original);
          expect(doc.version).equal(1);
          done();
        });
      });

      it('cannot replace the parent of a projected sub-field', function(done) {
        // This would delete the phone number, which the client can't see
        submit.call(this, {p: ['owner'], od: {name: 'jim'}, oi: {name: 'bob'}}, function(err, doc) {
          expect(err).instanceOf(Error);
          expect(doc.data).eql(original);
          expect(doc.version).equal(1);
          done();
        });
      });
    });
  });
};
