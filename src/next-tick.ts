exports.messageChannel = function() {
  var triggerCallback = createNextTickTrigger(arguments);
  var channel = new MessageChannel();
  channel.port1.onmessage = function() {
    triggerCallback();
    channel.port1.close();
  };
  channel.port2.postMessage('');
};

exports.setTimeout = function() {
  var triggerCallback = createNextTickTrigger(arguments);
  setTimeout(triggerCallback);
};

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
