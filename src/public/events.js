/**
 * Simple event system to replace setRefreshQueue pattern
 */

const handlers = {};

export function on(event, fn) {
  (handlers[event] ||= []).push(fn);
}

export function off(event, fn) {
  if (handlers[event]) {
    handlers[event] = handlers[event].filter(h => h !== fn);
  }
}

export function emit(event, data) {
  (handlers[event] || []).forEach(fn => fn(data));
}
