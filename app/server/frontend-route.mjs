import { randomUUID } from 'node:crypto';
import { digest } from '../guarded-runtime/profile.mjs';
import { createFrontendToolBroker, mergeFrontendToolSafety } from '../frontend-tools/broker.mjs';
import { createFrontendToolsHttpHandler } from '../frontend-tools/http.mjs';
import { openFrontendNativeGateway } from '../frontend-tools/native-gateway.mjs';
import { bindingFor, fail, identifier, object, revision, scope } from '../frontend-tools/contract.mjs';
import { digest as taskDigest } from './agui.mjs';

export const FRONTEND_PURPOSE = 'supervised-frontend-v1';
const INTENT = 'frontend-route.intent';
const controllers = ['adaptiveContext', 'assistanceContext', 'relayContext', 'goalContext', 'proactiveContext', 'workspaceContext', 'researchContext', 'researchComponentContext'];
const same = (a, b) => digest(a ?? null) === digest(b ?? null);
const sync = (fn, ...args) => { const x = fn(...args); if (x?.then) fail('FRONTEND_SYNC_REQUIRED'); return x; };
const rows = s => s.events.filter(x => x.type === INTENT);
const find = (s, collection, id, projectId) => s[collection].find(x => x.id === id && (projectId === undefined || x.projectId === projectId)) ?? fail('FRONTEND_SCOPE_NOT_FOUND', 404);
const intentFor = (s, input) => rows(s).find(x => x.context.operationId === input.operationId);
const definition = t => Object.fromEntries(['id', 'projectId', 'title', 'description', 'planId', 'phaseId', 'botId', 'dependsOn', 'evidence', 'artifactIds'].map(k => [k, t[k] ?? null]));

// Call in the lead's existing restore merge transaction, after synchronous
// invalidateForRestore(). Intent/run/result identities can never be rewound into
// permission to dispatch again. No human session or live grant is restored.
export function mergeFrontendRouteSafety(restored, previous) {
  mergeFrontendToolSafety(restored, previous);
  const previousRows = rows(previous);
  for (const row of previousRows) {
    const existing = restored.events.find(x => x.id === row.id);
    if (existing && (!same(existing.context, row.context) || existing.fingerprint !== row.fingerprint)) fail('FRONTEND_RESTORE_CONFLICT');
    const copy = { ...structuredClone(row), status: 'unknown', reason: 'metadata-restored' };
    if (existing) Object.assign(existing, copy); else restored.events.push(copy);
  }
  for (const row of rows(restored)) { row.status = 'unknown'; row.reason = 'metadata-restored'; }
  for (const receipt of previous.receipts.filter(x => x.type?.startsWith('frontend-route.'))) {
    const existing = restored.receipts.find(x => x.operationId === receipt.operationId);
    if (existing && !same(existing, receipt)) fail('FRONTEND_RESTORE_CONFLICT');
    if (!existing) restored.receipts.push(structuredClone(receipt));
  }
  const operations = new Set(previousRows.map(x => x.context.operationId));
  for (const run of previous.runs.filter(x => operations.has(x.operationId) || x.frontendContext)) {
    const index = restored.runs.findIndex(x => x.id === run.id);
    const copy = structuredClone(run);
    if (['submitting', 'starting', 'running', 'waiting'].includes(copy.status)) copy.status = 'unknown';
    if (index < 0) restored.runs.push(copy); else restored.runs[index] = copy;
  }
  return restored;
}

/** Product admission facade; the existing T3 service remains the ONLY run/turn
 * owner. Pure callbacks may run inside its canonical transaction. Native SDK
 * waits and lifecycle cleanup must run outside that writer transaction. */
export function createFrontendRoute({ store, authorizeOwner, policy, getGuarded, getT3, clock = Date.now }) {
  if (!store?.read || !store?.transaction || ![authorizeOwner, getGuarded, getT3, policy?.observe].every(x => typeof x === 'function')) throw TypeError('Canonical frontend route host required');
  const approvals = new Map(), revoked = new Set(), gateways = new Map();
  let ready = false, closed = false, recovery;
  const now = () => { const n = clock(); if (!Number.isSafeInteger(n)) fail('FRONTEND_CLOCK'); return n; };
  function owner(input, caller, action) {
    const identity = sync(authorizeOwner, { action: `frontend-route.${action}`, projectId: input?.projectId }, caller);
    if (identity?.kind !== 'human' || identity.role !== 'owner') fail('FRONTEND_OWNER_REQUIRED', 403);
  }
  function available() { if (closed || !ready) fail('FRONTEND_NOT_READY', 503); }
  function snapshot(s, input) {
    const project = find(s, 'projects', input.projectId), task = find(s, 'tasks', input.taskId, project.id);
    const plan = find(s, 'plans', task.planId, project.id);
    const doc = find(s, 'documents', input.documentId, project.id);
    if (!plan.approved || doc.kind !== 'doc' || doc.revision !== input.documentRevision) fail('FRONTEND_SAVED_PLAN_REQUIRED');
    const bot = task.botId ? find(s, 'bots', task.botId, project.id) : null;
    const selected = sync(policy.observe, s, { projectId: project.id });
    if (!selected?.route || selected.route.providerInstanceId !== project.profile?.provider?.instanceId || selected.route.modelId !== project.profile?.provider?.model || !same(selected.route.options, project.profile?.provider?.options ?? [])) fail('FRONTEND_CHECKED_ROUTE_REQUIRED');
    return { taskRevision: task.revision, planRevision: plan.revision, taskDefinition: digest(definition(task)), plan: digest(plan), bot: digest(bot), document: digest(doc), settings: digest({ workspace: project.workspace, profile: project.profile, settings: s.settings, policies: s.events.filter(x => x.projectId === project.id && ['governance.policy', 'plugin.binding'].includes(x.type)) }), selected: digest(selected) };
  }
  function validateContext(s, input, { run, replay = false } = {}) {
    const intent = intentFor(s, input), c = input.frontendContext;
    if (c === undefined && !intent && !run?.frontendContext) return null;
    if (!c || !intent || !same(c, intent.context) || input.projectId !== intent.projectId || input.taskId !== c.taskId || controllers.some(k => input[k] != null || run?.[k] != null) || input.conversationId != null || run?.conversationId != null) fail('FRONTEND_CONTEXT_CHANGED');
    if (replay) {
      // Historical equality only. This branch never authorizes dispatch/action.
      if (!run || !same(run.frontendContext, c) || run.operationId !== c.operationId || run.projectId !== c.projectId || run.taskId !== c.taskId || intent.runId !== run.id || intent.attemptId !== run.attemptId) fail('FRONTEND_CONTEXT_CHANGED');
      return structuredClone(c);
    }
    available();
    if (revoked.has(intent.id) || !approvals.has(intent.id) || !['approved', 'dispatching', 'dispatched'].includes(intent.status) || now() >= c.expiresAt) fail('FRONTEND_INTENT_INACTIVE');
    owner(intent, approvals.get(intent.id), 'current');
    const observed = snapshot(s, c);
    if (!same({ ...observed, taskRevision: c.snapshot.taskRevision }, c.snapshot)) fail('FRONTEND_CONTEXT_CHANGED');
    if (run) {
      if (!same(run.frontendContext, c) || run.operationId !== c.operationId || run.projectId !== c.projectId || run.taskId !== c.taskId || (run.botId ?? null) !== c.botId || intent.runId != null && intent.runId !== run.id || run.stopRequest || run.stopRequested || run.revoked || !['submitting', 'starting', 'running', 'waiting'].includes(run.status)) fail('FRONTEND_ATTEMPT_INACTIVE');
      if (!same(run.selection, c.selection) || !same(run.profile, find(s, 'projects', c.projectId).profile)) fail('FRONTEND_CONTEXT_CHANGED');
      // Existing T3 owns task.runIds/revision and its exact observed task stamp.
      // Only that host projection may advance the stamp during a running turn.
      const t = find(s, 'tasks', c.taskId, c.projectId);
      const stamp = run.guardedTaskSnapshot ?? run.guardedReservedTaskSnapshot;
      if (stamp ? taskDigest(t) !== stamp : t.revision !== c.snapshot.taskRevision + 1) fail('FRONTEND_CONTEXT_CHANGED');
    } else if (observed.taskRevision !== c.snapshot.taskRevision) fail('FRONTEND_CONTEXT_CHANGED');
    return structuredClone(c);
  }
  const inputFor = row => ({ projectId: row.projectId, taskId: row.context.taskId, operationId: row.context.operationId, frontendContext: structuredClone(row.context) });
  function requestForInput(s, input) {
    const run = s.runs.find(x => x.operationId === input.operationId);
    const c = validateContext(s, input, { run });
    if (!c) return null;
    return { projectId: c.projectId, taskId: c.taskId, purpose: FRONTEND_PURPOSE, envelopeDigest: digest(c), identitySnapshot: c.identitySnapshot, scope: structuredClone(c.scope), deadlineAt: c.expiresAt, limits: { maxRunMs: 300000, maxTokens: null, maxCost: null } };
  }
  function reserve(s, { run, input }) {
    const c = validateContext(s, input, { run });
    if (!c) return null;
    const row = intentFor(s, input);
    if (row.status !== 'dispatching' || row.runId && row.runId !== run.id) fail('FRONTEND_INTENT_ALREADY_USED');
    row.runId = run.id; row.attemptId = run.attemptId; row.status = 'dispatched';
    return structuredClone(c);
  }
  function validate(s, { run, input }) { validateContext(s, input, { run }); return true; }
  function current(runId, state = store.read()) {
    const run = find(state, 'runs', runId);
    const row = intentFor(state, run);
    if (!row) fail('FRONTEND_CONTEXT_CHANGED');
    validateContext(state, inputFor(row), { run });
    const native = sync(() => getGuarded()?.privateSnapshot(runId));
    if (!native || native.profile?.purpose !== FRONTEND_PURPOSE || native.profile.runId !== run.id || native.profile.threadId !== run.threadId || native.profile.envelopeDigest !== digest(row.context) || native.profile.identitySnapshot !== row.context.identitySnapshot || !same(native.profile.scope?.capabilities, row.context.scope.capabilities) || !same(native.profile.scope?.paths, row.context.scope.paths) || native.profile.expiresAt > row.context.expiresAt || native.profile.expiresAt <= now()) fail('FRONTEND_NATIVE_CURRENT_REQUIRED');
    return native;
  }
  function nativeBinding(call, profile, state = store.read()) {
    const native = current(profile.runId, state), run = find(state, 'runs', profile.runId);
    const c = run.frontendContext, thread = native.providerThread, turn = native.providerTurn;
    if (!native.live || !same(native.profile, profile) || !native.phases?.includes('openSession') || !native.phases?.includes('ensureThread') || !native.attestation || native.attestation.purpose !== FRONTEND_PURPOSE || native.attestation.profileDigest !== digest(profile)) fail('FRONTEND_NATIVE_ATTESTATION_REQUIRED');
    const a = native.attestation;
    if (a.version !== 1 || !Number.isSafeInteger(a.pid) || a.pid < 1 || a.sessionID !== call.sessionId || a.binarySha256 !== profile.route.opencodeBinarySha256 || a.manifestDigest !== profile.manifestDigest || a.contextDigest !== profile.contextDigest || a.toolGeneration !== profile.toolGeneration || a.policyGeneration !== profile.policyGeneration || !same(a.names, ['forge_frontend_selection_read']) || typeof a.runtimeDirectory !== 'string' || !a.runtimeDirectory || !a.evidenceId?.startsWith('frontend-session-v1:')) fail('FRONTEND_NATIVE_ATTESTATION_REQUIRED');
    if (!thread || !turn || thread.appThreadId !== run.threadId || turn.providerThreadId !== thread.id || turn.nodeId !== run.rootNodeId || turn.runAttemptId !== run.attemptId || turn.status !== 'running' || thread.nativeThreadRef?.nativeId !== call.sessionId) fail('FRONTEND_NATIVE_OBSERVATION_REQUIRED');
    const b = bindingFor({ projectId: run.projectId, runId: run.id, attemptId: run.attemptId, identityKind: 'private-adapter', threadId: run.threadId, rootNodeId: run.rootNodeId, providerThreadId: thread.id, providerTurnId: turn.id, nativeThreadRef: thread.nativeThreadRef, nativeTurnRef: turn.nativeTurnRef, nativeSessionId: thread.nativeThreadRef.nativeId, nativeTurnId: turn.nativeTurnRef?.nativeId, documentId: c.documentId, documentRevision: c.documentRevision });
    if (run.nativeProviderThreadId !== b.providerThreadId || run.nativeProviderTurnId !== b.providerTurnId || !same(run.nativeThreadRef, b.nativeThreadRef) || !same(run.nativeTurnRef, b.nativeTurnRef)) fail('FRONTEND_NATIVE_OBSERVATION_REQUIRED');
    return b;
  }
  function authorizeNativeBinding(binding, s) {
    try { return same(binding, nativeBinding({ sessionId: binding.nativeSessionId }, current(binding.runId, s).profile, s)); } catch { return false; }
  }
  const broker = createFrontendToolBroker({ store, authorizeOwner, authorizeNativeBinding, clock });
  const view = row => structuredClone({ intentId: row.id, projectId: row.projectId, taskId: row.context.taskId, documentId: row.context.documentId, documentRevision: row.context.documentRevision, operationId: row.context.operationId, status: row.status, expiresAt: row.context.expiresAt, runId: row.runId ?? null, attemptId: row.attemptId ?? null, reason: row.reason ?? null });
  async function createIntent(raw, caller) {
    owner(raw, caller, 'intent'); available();
    object(raw, ['projectId', 'taskId', 'documentId', 'documentRevision', 'operationId']);
    for (const k of ['projectId', 'taskId', 'documentId', 'operationId']) identifier(raw[k]); revision(raw.documentRevision);
    const fingerprint = digest(raw), id = randomUUID();
    const result = await store.transaction(s => {
      owner(raw, caller, 'intent'); available();
      const prior = s.receipts.find(x => x.operationId === raw.operationId);
      if (prior) { if (prior.type !== 'frontend-route.intent' || prior.fingerprint !== fingerprint) fail('FRONTEND_OPERATION_REUSE'); return view(find(s, 'events', prior.intentId)); }
      const observed = snapshot(s, raw), task = find(s, 'tasks', raw.taskId, raw.projectId);
      const context = { version: 1, purpose: FRONTEND_PURPOSE, intentId: id, projectId: raw.projectId, taskId: raw.taskId, planId: task.planId, botId: task.botId ?? null, documentId: raw.documentId, documentRevision: raw.documentRevision, operationId: randomUUID(), selection: structuredClone(find(s, 'projects', raw.projectId).profile.provider), snapshot: observed, scope: { paths: ['.'], capabilities: ['frontend_selection_read'] }, expiresAt: now() + 300000 };
      context.identitySnapshot = digest({ projectId: context.projectId, taskId: context.taskId, planId: context.planId, botId: context.botId, snapshot: observed });
      const row = { id, type: INTENT, projectId: raw.projectId, fingerprint, context, status: 'approved', createdAt: now() };
      s.events.push(row); s.receipts.push({ type: 'frontend-route.intent', operationId: raw.operationId, projectId: raw.projectId, intentId: id, fingerprint });
      return view(row);
    });
    // Replays after restart never recreate an Owner approval.
    if (result.intentId === id) approvals.set(id, caller);
    return result;
  }
  async function start(raw, caller) {
    owner(raw, caller, 'start'); available(); object(raw, ['projectId', 'intentId', 'operationId']);
    for (const k of ['projectId', 'intentId', 'operationId']) identifier(raw[k]);
    const admitted = await store.transaction(s => {
      owner(raw, caller, 'start'); available();
      const row = find(s, 'events', raw.intentId, raw.projectId);
      if (row.type !== INTENT || raw.operationId !== row.context.operationId) fail('FRONTEND_OPERATION_REUSE');
      const prior = s.receipts.find(x => x.operationId === raw.operationId);
      if (prior) { if (prior.type !== 'frontend-route.start' || !same(prior.request, raw) || prior.contextDigest !== digest(row.context)) fail('FRONTEND_OPERATION_REUSE'); return { replayed: true, intent: view(row) }; }
      validateContext(s, inputFor(row));
      if (row.status !== 'approved') fail('FRONTEND_INTENT_ALREADY_USED');
      row.status = 'dispatching';
      s.receipts.push({ type: 'frontend-route.start', projectId: raw.projectId, operationId: raw.operationId, request: structuredClone(raw), contextDigest: digest(row.context) });
      return { replayed: false, input: inputFor(row), intent: view(row) };
    });
    if (admitted.replayed) return admitted;
    try {
      const run = await getT3().startRun(admitted.input);
      if (!same(run.frontendContext, admitted.input.frontendContext) || run.operationId !== raw.operationId) fail('FRONTEND_T3_CONTEXT_REQUIRED');
      return { replayed: false, run, intent: view(find(store.read(), 'events', raw.intentId, raw.projectId)) };
    } catch (error) {
      revoked.add(raw.intentId);
      await store.transaction(s => { const row = find(s, 'events', raw.intentId, raw.projectId); row.status = 'unknown'; row.reason = 'start-unsettled-no-redispatch'; });
      throw error;
    }
  }
  function pending(input, caller) { owner(input, caller, 'pending'); return broker.state(input, caller); }
  async function result(input, caller) { owner(input, caller, 'result'); return broker.returnResult(input, caller); }
  async function stop(input, caller) {
    owner(input, caller, 'stop'); object(input, ['projectId', 'runId', 'attemptId']); scope(input);
    const run = find(store.read(), 'runs', input.runId, input.projectId);
    if (run.attemptId !== input.attemptId || !run.frontendContext) fail('FRONTEND_CALL_SCOPE');
    revoked.add(run.frontendContext.intentId);
    await broker.revokeRun(input, 'owner-stop');
    return getT3().stop(run.id);
  }
  async function recover() {
    if (closed) fail('FRONTEND_NOT_READY');
    if (recovery) return recovery;
    recovery = (async () => {
      await broker.recover();
      await store.transaction(s => {
        for (const row of rows(s)) if (!approvals.has(row.id)) { row.status = 'unknown'; row.reason = 'process-restart-no-redispatch'; }
        for (const run of s.runs.filter(x => x.frontendContext && !approvals.has(x.frontendContext.intentId))) if (['submitting', 'starting', 'running', 'waiting'].includes(run.status)) run.status = 'unknown';
      }); ready = true;
    })(); return recovery;
  }
  async function createFrontendGateway({ profile, assertCurrent, authorizePhase, withFence }) {
    if (gateways.has(profile.runId)) fail('FRONTEND_TURN_ALREADY_BOUND');
    const run = find(store.read(), 'runs', profile.runId), runScope = scope({ projectId: run.projectId, runId: run.id, attemptId: run.attemptId });
    let authorization;
    const scopedBroker = Object.freeze({ ...broker,
      bindNativeTurn(binding) {
        if (!same(scope(binding), runScope)) fail('FRONTEND_NATIVE_BINDING');
        const grant = broker.bindNativeTurn(binding); authorization = grant.authorization; return grant;
      },
      authenticateNative(value) { if (!authorization || value !== authorization) fail('FRONTEND_AUTH', 401); return broker.authenticateNative(value); },
      // The inherited gateway HTTP lifecycle owns its transport, not the whole
      // product broker. Closing one native turn must leave other runs usable.
      close: () => broker.revokeRun(runScope, 'native-gateway-closed'),
    });
    const gateway = await openFrontendNativeGateway({ broker: scopedBroker, assertCurrent: () => { const p = sync(assertCurrent); const snapshot = current(p.runId); if (!same(p, profile) || !same(snapshot.profile, p)) fail('FRONTEND_NATIVE_CURRENT_REQUIRED'); return p; }, bindingProvider: (call, p) => nativeBinding(call, p), authorizePhase, withFence, authenticateOwner: () => null });
    let closing;
    const owned = Object.freeze({ ...gateway, close() {
      if (!closing) { revoked.add(run.frontendContext.intentId); const revoking = scopedBroker.close(); closing = (async () => { try { await revoking; await gateway.close(); } finally { if (gateways.get(run.id) === owned) gateways.delete(run.id); } })(); }
      return closing;
    } });
    gateways.set(run.id, owned); return owned;
  }
  function closeRun(runId, reason = 'native-run-closed') {
    const run = find(store.read(), 'runs', runId);
    if (!run.frontendContext) return Promise.resolve();
    revoked.add(run.frontendContext.intentId);
    const revoking = broker.revokeRun({ projectId: run.projectId, runId, attemptId: run.attemptId }, reason);
    return Promise.all([revoking, gateways.get(runId)?.close()]);
  }
  function invalidateForRestore() {
    for (const id of approvals.keys()) revoked.add(id);
    approvals.clear();
    const invalidating = broker.invalidateForRestore();
    return Promise.all([invalidating, ...[...gateways.values()].map(x => x.close())]);
  }
  async function close() { if (closed) return; closed = true; approvals.clear(); await broker.close(); await Promise.allSettled([...gateways.values()].map(x => x.close())); gateways.clear(); }
  return Object.freeze({ createIntent, start, pending, result, stop, recover, close, closeRun, invalidateForRestore, mergeRestore: mergeFrontendRouteSafety, validateContext, validate, reserve, requestForInput, guardedRequest: requestForInput, authorizeNativeBinding, current, nativeBinding, createFrontendGateway, createHttpHandler: options => createFrontendToolsHttpHandler({ ...options, broker }), sweep: broker.sweep });
}
