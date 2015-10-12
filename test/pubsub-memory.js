var MemoryPubSub = require('../lib/pubsub/memory');

require('./pubsub')(function(callback) {
  callback(null, MemoryPubSub());
});
