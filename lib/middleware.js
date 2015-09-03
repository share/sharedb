module.exports = function(ShareDB) {

  /** Add middleware to an action. The action is optional (if not specified, the
   * middleware fires on every action).
   */
  ShareDB.prototype.use = function(action, middleware) {
    if (typeof action === 'function') {
      middleware = action;
      action = '';
    }
    var extensions = this.extensions[action];
    if (!extensions) extensions = this.extensions[action] = [];

    extensions.push(middleware);
  };

  // Return truthy if the instance has registered middleware. Used for bulkSubscribe.
  ShareDB.prototype._hasMiddleware = function(action) {
    return this.extensions[action];
  };

  /**
   * Passes request through the extensions stack
   *
   * Extensions may modify the request object. After all middlewares have been
   * invoked we call `callback` with `null` and the modified request.
   * If one of the extensions resturns an error the callback is called with that
   * error.
   */
  ShareDB.prototype.trigger = function(request, callback) {
    request.backend = this;

    // Copying the triggers we'll fire so they don't get edited while we iterate.
    var middlewares = (this.extensions[request.action] || []).concat(this.extensions['']);

    var next = function() {
      var middleware = middlewares.shift();
      if (!middleware) {
        return callback && callback(null, request);
      }
      middleware(request, function(err) {
        if (err) return callback && callback(err);
        next();
      });
    };

    next();
  };

);
