var memory = require('../lib/memory');

describe('memory db', function() {
  require('./snapshotdb')(memory);
  require('./oplog')(memory);
});
