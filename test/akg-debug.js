function debug() {
  if (!module.exports.enabled) return;
  console.log.apply(console, arguments);
}

module.exports = {
  enabled: false,
  debug: debug
};
