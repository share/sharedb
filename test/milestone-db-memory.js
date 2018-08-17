var MemoryMilestoneDB = require('./../lib/milestone-db/memory');

require('./milestone-db')({
  create: function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    var db = new MemoryMilestoneDB(options);
    callback(null, db);
  }
});
