import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendProtocol } from '../server/agui.mjs';
import { FRONTEND_TOOL, LIMITS, META_KEY, SCOPE_KEYS, TOOL_NAME, argumentsFor, bindingFor, fail, identifier, nativeCall, object, scope, sdkResult, typedResult } from './contract.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeStatuses = new Set(['starting', 'running', 'waiting']);
const records = s => s.events.filter(e => e.type === 'frontend-tools.call');
const sameScope = (a, b) => SCOPE_KEYS.every(k => a[k] === b[k]);
const sync = (fn, ...args) => { const value = fn(...args); if (value?.then) throw new TypeError('Frontend authority callbacks must be synchronous'); return value; };

// Call INSIDE the existing metadata restore transaction. A restored backup is
// never permission to forget an accepted native call or Owner operation ID.
export function mergeFrontendToolSafety(restored, previous) {
  for (const row of records(previous)) {
    const old = restored.events.find(e => e.id === row.id);
    if (old && (old.type !== row.type || old.fingerprint !== row.fingerprint)) fail('FRONTEND_RESTORE_CONFLICT');
    const copy = { ...structuredClone(row), status: 'unknown', delivery: 'unknown', reason: 'metadata-restored' };
    if (old) Object.assign(old, copy); else restored.events.push(copy);
  }
  for (const receipt of previous.receipts.filter(r => r.type === 'frontend-tools.result')) {
    const old = restored.receipts.find(r => r.operationId === receipt.operationId);
    if (old && (old.type !== receipt.type || old.fingerprint !== receipt.fingerprint)) fail('FRONTEND_RESTORE_CONFLICT');
    if (!old) restored.receipts.push(structuredClone(receipt));
  }
  return restored;
}

// Uses ONLY canonical domain events/receipts. Live capabilities and pending SDK
// continuations are process-private; neither backup nor config can recreate them.
export function createFrontendToolBroker({ store, authorizeOwner, authorizeNativeBinding, clock = Date.now }) {
  if (!store?.read || !store?.transaction || typeof authorizeOwner !== 'function' || typeof authorizeNativeBinding !== 'function') throw new TypeError('Canonical store and private authority callbacks required');
  const leases = new Map(), handles = new WeakMap(), waiters = new Map();
  let closed = false, recovered = false;
  function now() { const n = clock(); if (!Number.isSafeInteger(n)) throw new TypeError('Invalid clock'); return n; }
  function owner(input, caller, action) {
    const who = sync(authorizeOwner, { action: `frontend-tools.${action}`, ...scope(input) }, caller);
    if (who?.kind !== 'human' || who.role !== 'owner') fail('FRONTEND_OWNER_REQUIRED', 403);
  }
  function canonical(s, binding) {
    const run = s.runs.find(r => r.id === binding.runId && r.projectId === binding.projectId && r.attemptId === binding.attemptId);
    const project = s.projects.find(p => p.id === binding.projectId);
    const doc = s.documents.find(d => d.id === binding.documentId && d.projectId === binding.projectId);
    if (!run || !project || !doc || doc.kind !== 'doc' || !activeStatuses.has(run.status) || run.stopRequest || run.guarded || run.proactiveContext || run.guardedProfile) fail('FRONTEND_ATTEMPT_INACTIVE');
    if (run.threadId !== binding.threadId) fail('FRONTEND_NATIVE_BINDING');
    if (binding.identityKind === 'private-adapter') {
      for (const [runKey, bindingKey] of [['rootNodeId', 'rootNodeId'], ['nativeProviderThreadId', 'providerThreadId'], ['nativeProviderTurnId', 'providerTurnId']]) if (run[runKey] !== binding[bindingKey]) fail('FRONTEND_NATIVE_BINDING');
      if (hash(run.nativeThreadRef) !== hash(binding.nativeThreadRef) || hash(run.nativeTurnRef) !== hash(binding.nativeTurnRef)) fail('FRONTEND_NATIVE_BINDING');
    } else if (run.providerRunId !== binding.providerRunId) fail('FRONTEND_NATIVE_BINDING');
    // The callback must inspect the actual matching native owner/turn mapping and
    // explicit supervised policy. A JSON flag is never sufficient qualification.
    if (sync(authorizeNativeBinding, structuredClone(binding), s) !== true) fail('FRONTEND_NATIVE_BINDING');
    if (doc.revision !== binding.documentRevision) fail('FRONTEND_REVISION_CONFLICT');
    const task = run.taskId && s.tasks.find(t => t.id === run.taskId && t.projectId === run.projectId);
    if (run.taskId && (!task || task.botId !== run.botId)) fail('FRONTEND_ATTEMPT_INACTIVE');
    for (const [key, collection] of [['botId', 'bots'], ['conversationId', 'conversations']]) if (run[key] && !s[collection].some(x => x.id === run[key] && x.projectId === run.projectId)) fail('FRONTEND_ATTEMPT_INACTIVE');
    const stamp = hash({ workspace: project.workspace, provider: project.profile?.provider, taskId: run.taskId, taskRevision: task?.revision, botId: run.botId, conversationId: run.conversationId, providerInstanceId: run.providerInstanceId, selection: run.selection, binding });
    return { run, stamp };
  }
  function live(lease, s = store.read()) {
    if (closed || !recovered || leases.get(lease.id) !== lease || now() >= lease.expiresAt) fail('FRONTEND_LEASE_INACTIVE', 401);
    const { run, stamp } = canonical(s, lease.binding);
    if (stamp !== lease.stamp) fail('FRONTEND_NATIVE_BINDING');
    return run;
  }
  function event(s, row, name, value) {
    const run = s.runs.find(r => r.id === row.runId && r.attemptId === row.attemptId);
    if (run) appendProtocol(s, run, { type: 'CUSTOM', name, value: { ...scope(row), pendingId: row.id, nativeCallId: row.native.callId, ...value } }, `${row.id}:${name}`);
  }
  function view(row) {
    return structuredClone({ pendingId: row.id, ...scope(row), tool: row.tool, native: row.native, arguments: row.arguments, expiresAt: row.expiresAt, status: row.status, resultReceiptId: row.resultReceiptId ?? null, delivery: row.delivery, reason: row.reason ?? null });
  }
  async function invalidate(ids, reason) {
    if (!ids.length) return;
    await store.transaction(s => {
      for (const row of records(s).filter(e => ids.includes(e.id) && ['pending', 'accepted', 'released'].includes(e.status))) {
        row.status = 'unknown'; row.delivery = 'unknown'; row.reason = reason; row.updatedAt = now();
        event(s, row, 'forge.frontend-tool.unknown', { reason });
      }
    });
    for (const id of ids) { const w = waiters.get(id); waiters.delete(id); w?.reject(Object.assign(new Error('FRONTEND_OUTCOME_UNKNOWN'), { code: 'FRONTEND_OUTCOME_UNKNOWN' })); }
  }
  async function recover() {
    if (recovered) return;
    if (leases.size || waiters.size) fail('FRONTEND_RECOVERY_ORDER');
    await invalidate(records(store.read()).filter(e => ['pending', 'accepted', 'released'].includes(e.status)).map(e => e.id), 'process-restart');
    recovered = true;
  }
  function bindNativeTurn(raw) {
    const binding = bindingFor(raw);
    if (!recovered || closed) fail('FRONTEND_NOT_READY', 503);
    const ttl = raw.ttlMs ?? LIMITS.ttl;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > LIMITS.ttl) fail('FRONTEND_VALIDATION', 400);
    const { stamp } = canonical(store.read(), binding);
    // One native transport per exact attempt. No automatic second attachment.
    if ([...leases.values()].some(x => x.binding.runId === binding.runId)) fail('FRONTEND_TURN_ALREADY_BOUND');
    const id = randomUUID(), secret = randomBytes(32).toString('base64url');
    const lease = { id, binding, stamp, tokenHash: hash(secret), expiresAt: now() + ttl };
    const handle = Object.freeze({}); handles.set(handle, lease); leases.set(id, lease);
    // HOST-ONLY return. Never put authorization in run/state/protocol/config.
    return Object.freeze({ handle, authorization: `Bearer ${secret}`, expiresAt: lease.expiresAt });
  }
  function authenticateNative(supplied) {
    if (typeof supplied !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied)) fail('FRONTEND_AUTH', 401);
    const actual = Buffer.from(hash(supplied.slice(7)), 'hex');
    for (const lease of leases.values()) if (timingSafeEqual(actual, Buffer.from(lease.tokenHash, 'hex'))) {
      live(lease); const handle = Object.freeze({}); handles.set(handle, lease); return handle;
    }
    fail('FRONTEND_AUTH', 401);
  }
  const leaseFor = handle => { const lease = handles.get(handle); if (!lease) fail('FRONTEND_AUTH', 401); live(lease); return lease; };
  function tools(handle) { leaseFor(handle); return [structuredClone(FRONTEND_TOOL)]; }
  async function callNative(handle, params, signal) {
    const lease = leaseFor(handle);
    object(params, ['name', 'arguments', '_meta']);
    if (params.name !== TOOL_NAME) fail('FRONTEND_TOOL_DENIED', 403);
    object(params._meta, [META_KEY]);
    const native = nativeCall(params._meta[META_KEY]), args = argumentsFor(params.arguments);
    if (native.sessionId !== lease.binding.nativeSessionId || native.turnId !== lease.binding.nativeTurnId || args.documentId !== lease.binding.documentId || args.expectedRevision !== lease.binding.documentRevision) fail('FRONTEND_CALL_SCOPE', 403);
    if (signal?.aborted) fail('FRONTEND_OUTCOME_UNKNOWN');
    const id = randomUUID(), fingerprint = hash({ binding: lease.binding, native, args });
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    promise.catch(() => {}); // abort can win before the reservation await returns
    // Attach before reservation so a dropped HTTP connection can never leave a
    // durable pending entry with no private continuation to invalidate.
    const waiter = { resolve, reject, leaseId: lease.id, promise }; waiters.set(id, waiter);
    const onAbort = () => { invalidate([id], 'native-call-disconnected').catch(() => { reject(new Error('FRONTEND_OUTCOME_UNKNOWN')); }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let timer;
    try {
      await store.transaction(s => {
        live(lease, s);
        if (signal?.aborted) fail('FRONTEND_OUTCOME_UNKNOWN');
        const rows = records(s);
        // A native call identity is one-shot, even with a new transport/request ID.
        // Existing Owner receipts are replayable; native tool execution is not.
        if (rows.some(r => r.runId === lease.binding.runId && r.attemptId === lease.binding.attemptId && r.native.sessionId === native.sessionId && r.native.callId === native.callId)) fail('FRONTEND_CALL_ALREADY_SEEN');
        if (rows.filter(r => r.status === 'pending').length >= LIMITS.pending || rows.filter(r => r.runId === lease.binding.runId && r.status === 'pending').length >= LIMITS.perTurn) fail('FRONTEND_BUSY', 429);
        const row = { id, type: 'frontend-tools.call', ...scope(lease.binding), binding: lease.binding, fingerprint, native, arguments: args, tool: TOOL_NAME, status: 'pending', delivery: 'pending', expiresAt: lease.expiresAt, createdAt: now() };
        s.events.push(row); event(s, row, 'forge.frontend-tool.pending', { tool: row.tool, arguments: args, expiresAt: row.expiresAt });
      });
      timer = setTimeout(() => { invalidate([id], 'expired').catch(() => reject(new Error('FRONTEND_OUTCOME_UNKNOWN'))); }, Math.max(1, lease.expiresAt - now()));
      timer.unref?.();
      const result = await promise;
      await store.transaction(s => {
        live(lease, s);
        const row = records(s).find(r => r.id === id);
        if (row.status !== 'accepted') fail('FRONTEND_OUTCOME_UNKNOWN');
        row.status = 'released'; row.delivery = 'unconfirmed'; row.updatedAt = now();
      });
      // This returns from the SDK tools/call request still on its original ID.
      // It does not assert the provider observed the result; native observation
      // remains the authoritative TOOL_CALL_RESULT producer.
      return sdkResult(result);
    } catch (e) {
      // Avoid an unhandled rejection if abort races reservation failure.
      promise.catch(() => {});
      await invalidate([id], 'native-call-unsettled');
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); waiters.delete(id); }
  }
  function state(input, caller) {
    object(input, SCOPE_KEYS); owner(input, caller, 'state');
    return { ...scope(input), capability: 'supervised-selection-read', calls: records(store.read()).filter(r => sameScope(r, input)).map(view) };
  }
  async function returnResult(raw, caller) {
    // Authenticate scope BEFORE inspecting/validating result content.
    owner(raw, caller, 'result');
    object(raw, [...SCOPE_KEYS, 'pendingId', 'operationId', 'result']);
    const input = { ...scope(raw), pendingId: identifier(raw.pendingId), operationId: identifier(raw.operationId) };
    let delivered, waiter;
    const result = await store.transaction(s => {
      owner(input, caller, 'result');
      const row = records(s).find(r => r.id === input.pendingId && sameScope(r, input));
      if (!row) fail('FRONTEND_CALL_NOT_FOUND', 404);
      const value = typedResult(raw.result, row), fingerprint = hash({ ...input, result: value });
      const prior = s.receipts.find(r => r.operationId === input.operationId);
      if (prior) {
        if (prior.type !== 'frontend-tools.result' || prior.fingerprint !== fingerprint) fail('OPERATION_REUSE');
        return { replayed: true, receipt: prior, call: view(row) };
      }
      const lease = [...leases.values()].find(l => l.binding.runId === row.runId && l.binding.attemptId === row.attemptId);
      if (!lease) fail('FRONTEND_OUTCOME_UNKNOWN');
      live(lease, s);
      waiter = waiters.get(row.id);
      if (row.status !== 'pending' || !waiter || waiter.leaseId !== lease.id || now() >= row.expiresAt) fail('FRONTEND_OUTCOME_UNKNOWN');
      row.status = 'accepted'; row.resultReceiptId = input.operationId; row.updatedAt = now();
      const receipt = { type: 'frontend-tools.result', ...input, fingerprint, result: value, at: now(), source: 'authenticated-owner-frontend', providerDelivery: 'unconfirmed' };
      s.receipts.push(receipt);
      event(s, row, 'forge.frontend-tool.result-accepted', { resultReceiptId: input.operationId, providerDelivery: 'unconfirmed' });
      delivered = value;
      return { replayed: false, receipt, call: view(row) };
    });
    if (delivered) waiter.resolve(delivered);
    return result;
  }
  async function revokeRun(input, reason = 'native-turn-stopped') {
    scope(input);
    // Revocation is synchronous before any await: Stop prevents later body reads
    // or Owner result admissions while the canonical invalidation commits.
    for (const [id, l] of leases) if (sameScope(l.binding, input)) leases.delete(id);
    await invalidate(records(store.read()).filter(r => sameScope(r, input)).map(r => r.id), reason);
  }
  async function sweep() {
    const invalid = [];
    for (const row of records(store.read()).filter(r => ['pending', 'accepted'].includes(r.status))) {
      const w = waiters.get(row.id), lease = w && leases.get(w.leaseId);
      try { if (!lease) fail('FRONTEND_LEASE_INACTIVE'); live(lease); } catch { invalid.push(row.id); }
    }
    await invalidate(invalid, 'native-binding-inactive');
  }
  async function close() {
    closed = true; leases.clear();
    await invalidate(records(store.read()).filter(r => ['pending', 'accepted', 'released'].includes(r.status)).map(r => r.id), 'host-closed');
  }
  function invalidateForRestore() {
    leases.clear();
    return invalidate(records(store.read()).filter(r => ['pending', 'accepted', 'released'].includes(r.status)).map(r => r.id), 'metadata-restored');
  }
  return Object.freeze({ recover, bindNativeTurn, authenticateNative, tools, callNative, state, returnResult, revokeRun, sweep, invalidateForRestore, close });
}
