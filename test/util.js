var livedb = require('../lib');
var Memory = require('../lib/memory');
var inProcessDriver = require('../lib/inprocessdriver');

var nextId = 0;

exports.createClient = function(db, createDriver) {
  var client, driver, sdc, testWrapper;
  if (db == null) {
    db = new Memory();
  }
  if (createDriver == null) {
    createDriver = inProcessDriver;
  }
  driver = createDriver(db);
  testWrapper = {
    name: 'test'
  };
  sdc = {
    guage: (function() {}),
    increment: (function() {}),
    timing: (function() {})
  };
  client = livedb.client({
    db: db,
    driver: driver,
    extraDbs: {
      test: testWrapper
    },
    sdc: sdc
  });
  return {
    client: client,
    db: db,
    testWrapper: testWrapper,
    driver: driver
  };
};

exports.setup = function() {
  if (this.cName == null) {
    this.cName = '_test';
  }

  var defaultClient = exports.createClient();
  this.client = defaultClient.client;
  this.db = defaultClient.db;
  this.testWrapper = defaultClient.testWrapper;
  this.driver = defaultClient.driver;
  this.collection = this.client.collection(this.cName);
  this.docName = "id" + (nextId++);

  this.createDoc = function(docName, data, cb) {
    if (data == null) {
      data = '';
    }

    if (typeof data === 'function') {
      cb = data;
      data = '';
    }

    var type = typeof data === 'string' ? 'text' : 'json0';

    return this.collection.submit(docName, {
      v: 0,
      create: {
        type: type,
        data: data
      }
    },
    null,
    function(err) {
      if (err) {
        throw new Error(err);
      }
      return typeof cb === "function" ? cb() : void 0;
    });
  };

  return this.create = function(data, cb) {
    return this.createDoc(this.docName, data, cb);
  };
};

exports.teardown = function() {
  this.client.destroy();
  this.driver.destroy();
  return this.db.close();
};

exports.stripTs = function(ops) {
  if (Array.isArray(ops)) {
    for (var i = 0; i < ops.length; ++i) {
      if (ops[i].m) {
        delete ops[i].m.ts;
      }
    }
  } else {
    if (ops.m) {
      delete ops.m.ts;
    }
  }
  return ops;
};

exports.calls = function(num, fn) {
  return function(done) {
    var n;
    if (num === 0) {
      done();
    }
    n = 0;
    fn.call(this, function() {
      if (++n >= num) {
        done();
      }
    });
  };
};
