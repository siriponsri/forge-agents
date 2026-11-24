import { setTimeout as sleep } from 'node:timers/promises';

export function fault(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fault('VALIDATION', `${label} must be a nonempty string of at most ${max} characters`);
  return value;
}
export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault('VALIDATION', `${label} must be ${min}..${max}`);
  return value;
}
export function aborted(signal) { signal?.throwIfAborted(); }
export async function wait(ms, signal) { await sleep(ms, undefined, { signal }); }
export const mutations = new Set(['focus', 'type', 'click', 'key', 'navigate']);
export const keys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

// Reject script evaluators, shell commands, arbitrary key chords and unbounded input.
export function validateAction(name, args = {}) {
  if (!['inspect', 'screenshot', 'focus', 'type', 'click', 'key', 'navigate', 'wait'].includes(name)) throw fault('CAPABILITY', 'Unsupported bounded desktop action');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw fault('VALIDATION', 'arguments must be an object');
  if (name === 'type' && (typeof args.text !== 'string' || args.text.length > 10000)) throw fault('VALIDATION', 'text must be a string of at most 10000 characters');
  if (name === 'key' && !keys.includes(args.key)) throw fault('VALIDATION', 'Unsupported key; chords and system shortcuts are not supported');
  if (name === 'wait') integer(args.ms, 'ms', 0, 30000);
  if (args.timeoutMs !== undefined) integer(args.timeoutMs, 'timeoutMs', 100, 30000);
  return args;
}
