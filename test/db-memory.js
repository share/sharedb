var MemoryDB = require('../lib/db/memory');

require('./db')(function(callback) {
  callback(null, MemoryDB());
});
