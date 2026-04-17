import { EventEmitter } from 'events';
export { EventEmitter };
export { mixin };

function mixin(Constructor) {
  for (var key in EventEmitter.prototype) {
    Constructor.prototype[key] = EventEmitter.prototype[key];
  }
}
