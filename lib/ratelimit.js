
// 3 states: Ready, on cooldown and on cooldown & queued.
//
// In ready: ready->cooldown, run fn, fire timer
// in cooldown: cooldown->queued,
// in queued: do nothing
// when timer fires: call fn if queued, move to ready.
module.exports = function(time, fn) {
  // State encoded in these two variables.
  //  null/false  = ready
  //  timer/false = cooldown
  //  timer/true  = queued.
  var timeout = null;
  var queued = false;

  var f;
  return f = function() {
    if (!timeout) {
      timeout = setTimeout(function() {
        timeout = null;
        if (queued) {
          queued = false;
          f();
        }
      }, time);
      fn();
    } else {
      queued = true;
    }
  };
};

