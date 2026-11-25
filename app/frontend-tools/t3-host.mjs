// Explicit supervised alternative at the EXISTING private T3 bridge slot.
// Not an HTTP/RPC installer; cannot coexist with another host in the same graph.
import { digest } from '../guarded-runtime/profile.mjs';
const slot = Symbol.for('FORGE.GuardedRoute.T3Host.v1');
export function installSupervisedFrontendT3Host({ resolveThread, assertCurrent, runtimeDirectory, resolveConnection }) {
  if (globalThis[slot] || ![resolveThread, assertCurrent, runtimeDirectory, resolveConnection].every(fn => typeof fn === 'function')) throw Error('FRONTEND_PRIVATE_T3_HOST');
  const profiles = new WeakSet();
  const current = handle => {
    const p = assertCurrent(handle);
    if (!p || p.then || p.purpose !== 'supervised-frontend-v1' || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= Date.now()) throw Error('FRONTEND_PRIVATE_T3_PROFILE');
    return p;
  };
  const host = Object.freeze({
    directory: runtimeDirectory,
    connection(input) { if (resolveConnection(input) !== true) throw Error('FRONTEND_PRIVATE_T3_CONNECTION'); },
    resolve(thread, selection) { const handle = resolveThread(thread, selection); if (!handle || handle.then) throw Error('FRONTEND_PRIVATE_T3_PROFILE'); current(handle); profiles.add(handle); return handle; },
    assert(handle, phase, input) {
      if (!profiles.has(handle)) throw Error('FRONTEND_PRIVATE_T3_PROFILE');
      const p = current(handle), thread = input.threadId ?? input.targetThreadId ?? input.providerThread?.appThreadId;
      if (thread !== undefined && thread !== p.threadId) throw Error('FRONTEND_PRIVATE_T3_THREAD');
      const selected = input.modelSelection;
      if (selected && (selected.instanceId !== p.route.providerInstanceId || selected.model !== p.route.modelId || digest(selected.options ?? {}) !== digest(p.route.options))) throw Error('FRONTEND_PRIVATE_T3_SELECTION');
      if (input.runtimePolicy && (input.runtimePolicy.runtimeMode !== 'approval-required' || input.runtimePolicy.cwd !== runtimeDirectory(handle))) throw Error('FRONTEND_PRIVATE_T3_POLICY');
    },
    // Consumed by the new matching T3 source patch, not by an old installed T3.
    toolNames(handle) { if (!handle || !profiles.has(handle)) throw Error('FRONTEND_PRIVATE_T3_PROFILE'); current(handle); return ['forge_frontend_selection_read']; },
  });
  Object.defineProperty(globalThis, slot, { value: host, configurable: false, writable: false, enumerable: false });
  return host;
}
