'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.messageChannel = messageChannel;
exports.setTimeout = setTimeout;
function messageChannel() {
  var triggerCallback = createNextTickTrigger(arguments);
  var channel = new MessageChannel();
  channel.port1.onmessage = function () {
    triggerCallback();
    channel.port1.close();
  };
  channel.port2.postMessage('');
}
function setTimeout() {
  var triggerCallback = createNextTickTrigger(arguments);
  global.setTimeout(triggerCallback);
}
function createNextTickTrigger(args) {
  var callback = args[0];
  var _args = [];
  for (var i = 1; i < args.length; i++) {
    _args[i - 1] = args[i];
  }
  return function triggerCallback() {
    callback.apply(null, _args);
  };
}
