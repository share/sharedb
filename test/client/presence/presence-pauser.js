// Helper middleware for precise control over when clients receive
// presence updates
module.exports = PresencePauser;
function PresencePauser() {
  // Handler that can be set to be called when a message
  // is paused
  this.onPause = null;
  this._shouldPause = false;
  this._pendingBroadcasts = [];

  // Main middleware method
  this.sendPresence = function(request, callback) {
    if (!this._isPaused(request)) return callback();
    this._pendingBroadcasts.push([request, callback]);
    if (typeof this.onPause === 'function') {
      this.onPause(request);
    }
  };

  // If called without an argument, will pause all broadcasts.
  // If called with a function, the returned result will determine
  // whether the request is paused
  this.pause = function(predicate) {
    this._shouldPause = typeof predicate === 'function' ? predicate : true;
  };

  // Send all paused broadcasts, and unpause. Also unsets the onPause
  // handler
  this.resume = function() {
    this._shouldPause = false;
    this._pendingBroadcasts.forEach(function(broadcast) {
      var callback = broadcast[1];
      callback();
    });
    this._pendingBroadcasts = [];
    this.onPause = null;
  };

  this._isPaused = function(request) {
    return this._shouldPause === true ||
      typeof this._shouldPause === 'function' && this._shouldPause(request);
  };
}
