var runTests = require('./driver');

describe('inprocess driver', function() {
  runTests(require('../lib/inprocessdriver'), function(driver) {
    driver.destroy();
  });
});
