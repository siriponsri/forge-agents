import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../app/server/store.mjs';
import { createLocalAuthority } from '../app/server/authority.mjs';
import { createFrontendRoute, mergeFrontendRouteSafety, FRONTEND_PURPOSE } from '../app/server/frontend-route.mjs';
import { digest } from '../app/guarded-runtime/profile.mjs';
import { META_KEY } from '../app/frontend-tools/contract.mjs';

const selection = { instanceId: 'fixture', connectionId: 'connection', model: 'forge/fixture', options: [] };
const create = { projectId: 'p', taskId: 'task', documentId: 'doc', documentRevision: 1, operationId: 'intent-operation' };
const output = { status: 'ok', documentId: 'doc', revision: 1, selection: { start: 0, end: 5, text: 'hello' } };
async function until(fn) { for (let n = 0; n < 200; n++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); } throw Error('Fixture timeout'); }

// Real canonical SQLite, Owner capability, broker, HTTP and MCP SDK; only T3's
// lead-owned run allocation/native observations are injected contract fixtures.
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-frontend-route-'));
  const store = await openStore(dir), authority = createLocalAuthority(), session = { expiresAt: Date.now() + 600000 }, owner = authority.owner(session);
  let time = Date.now(), launches = 0, stops = 0, route, native, checked = true, captured;
  await store.transaction(s => {
    s.projects.push({ id: 'p', workspace: dir, profile: { provider: selection }, revision: 1 });
    s.plans.push({ id: 'plan', projectId: 'p', approved: true, revision: 1 });
    s.bots.push({ id: 'bot', projectId: 'p', name: 'reader', revision: 1 });
    s.tasks.push({ id: 'task', projectId: 'p', planId: 'plan', botId: 'bot', title: 'Read selected text', status: 'ready', revision: 1, runIds: [] });
    s.documents.push({ id: 'doc', projectId: 'p', kind: 'doc', name: 'Saved doc', revision: 1, snapshot: { id: 'univer-unit', body: { dataStream: 'hello world\r\n' } } });
  });
  const policy = { observe: () => { if (!checked) throw Error('CHECK_REQUIRED'); return { route: { providerInstanceId: selection.instanceId, modelId: selection.model, options: [] }, policyGeneration: 'policy', toolGeneration: 'tools' }; } };
  const t3 = {
    async startRun(input) {
      launches++; captured = structuredClone(input);
      return store.transaction(s => {
        route.validateContext(s, input);
        const runId = launches === 1 ? 'run' : 'run-' + launches;
        const task = s.tasks[0]; task.runIds.push(runId); task.revision++;
        const run = { id: runId, ...input, botId: 'bot', attemptId: 'attempt', threadId: 'thread', rootNodeId: 'root', status: 'running', profile: structuredClone(s.projects[0].profile), selection: structuredClone(selection), nativeProviderThreadId: 'provider-thread', nativeProviderTurnId: 'provider-turn', nativeThreadRef: { driver: 'opencode', nativeId: 'ses_observed', strength: 'strong' }, nativeTurnRef: { driver: 'opencode', nativeId: 'msg_observed_turn', strength: 'weak' } };
        s.runs.push(run); route.reserve(s, { run, input });
        const profile = { purpose: FRONTEND_PURPOSE, projectId: 'p', taskId: 'task', runId: run.id, threadId: run.threadId, envelopeDigest: digest(input.frontendContext), identitySnapshot: input.frontendContext.identitySnapshot, scope: { ...input.frontendContext.scope, maxBytes: 65536 }, expiresAt: input.frontendContext.expiresAt, route: { opencodeBinarySha256: 'a'.repeat(64) }, manifestDigest: 'b'.repeat(64), contextDigest: 'c'.repeat(64), toolGeneration: 'tools', policyGeneration: 'policy' };
        native = { profile, routeProof: null, live: true, phase: 'attested', phases: ['openSession', 'ensureThread'], providerThread: { id: run.nativeProviderThreadId, appThreadId: run.threadId, nativeThreadRef: run.nativeThreadRef }, providerTurn: { id: run.nativeProviderTurnId, providerThreadId: run.nativeProviderThreadId, nodeId: run.rootNodeId, runAttemptId: run.attemptId, status: 'running', nativeTurnRef: run.nativeTurnRef }, attestation: { version: 1, purpose: FRONTEND_PURPOSE, sessionID: 'ses_observed', pid: 42, binarySha256: profile.route.opencodeBinarySha256, profileDigest: digest(profile), manifestDigest: profile.manifestDigest, contextDigest: profile.contextDigest, toolGeneration: profile.toolGeneration, policyGeneration: profile.policyGeneration, runtimeDirectory: dir, names: ['forge_frontend_selection_read'], evidenceId: 'frontend-session-v1:fixture' } };
        return run;
      });
    },
    async stop(id) { stops++; await store.transaction(s => { s.runs[0].stopRequest = { source: 'fixture-real-stop-owner' }; s.runs[0].status = 'unknown'; }); return { id, status: 'unknown' }; },
  };
  const options = { store, authorizeOwner: authority.goalAuthorize, policy, getT3: () => t3, getGuarded: () => ({ privateSnapshot: () => structuredClone(native) }), clock: () => time };
  route = createFrontendRoute(options); await route.recover();
  const cleanups = [];
  t.after(async () => { for (const fn of cleanups.reverse()) await fn(); await route.close(); await store.close(); await rm(dir, { recursive: true, force: true }); });
  async function start() { const intent = await route.createIntent(create, owner); return route.start({ projectId: 'p', intentId: intent.intentId, operationId: intent.operationId }, owner); }
  return { store, options, route, owner, session, start, cleanup: fn => cleanups.push(fn), native: () => native, input: () => captured, launches: () => launches, stops: () => stops, expire: () => { time += 120001; }, uncheck: () => { checked = false; }, replace: next => { route = next; } };
}

test('opaque Owner chooses saved Doc + approved task; exact operation/context dispatches once through SAME T3', async t => {
  const f = await fixture(t);
  await assert.rejects(f.route.createIntent(create, { role: 'owner' }), /FRONTEND_OWNER_REQUIRED/);
  const intent = await f.route.createIntent(create, f.owner);
  assert.deepEqual(await f.route.createIntent(create, f.owner), intent);
  const input = { projectId: 'p', intentId: intent.intentId, operationId: intent.operationId };
  const [a, b] = await Promise.all([f.route.start(input, f.owner), f.route.start(input, f.owner)]);
  assert.equal(f.launches(), 1); assert.equal([a, b].filter(x => x.replayed).length, 1);
  const run = f.store.read().runs[0];
  assert.equal(run.providerRunId, undefined); assert.equal(run.frontendContext.documentRevision, 1);
  assert.deepEqual(f.route.requestForInput(f.store.read(), f.input()).scope.capabilities, ['frontend_selection_read']);
  assert.equal(f.route.requestForInput(f.store.read(), f.input()).deadlineAt, intent.expiresAt);
  await assert.rejects(f.route.start({ ...input, operationId: 'different' }, f.owner), /FRONTEND_OPERATION_REUSE/);
  await assert.rejects(f.route.createIntent({ ...create, taskId: 'different' }, f.owner), /FRONTEND_OPERATION_REUSE/);
});

test('stripped, forged, mixed-controller and foreign context fails closed before dispatch and at run lifecycle', async t => {
  const f = await fixture(t); await f.start(); const s = f.store.read(), input = f.input(), run = s.runs[0];
  for (const mutate of [x => delete x.frontendContext, x => { x.frontendContext.documentRevision++; }, x => { x.frontendContext.scope.capabilities.push('workspace.write'); }, x => { x.proactiveContext = {}; }, x => { x.researchContext = {}; }, x => { x.researchComponentContext = {}; }, x => { x.conversationId = 'foreign'; }, x => { x.projectId = 'foreign'; }, x => { x.taskId = 'foreign'; }]) {
    const copy = structuredClone(input); mutate(copy); assert.throws(() => f.route.validateContext(s, copy, { run }), /FRONTEND_/);
    assert.throws(() => f.route.validateContext(s, copy, { run, replay: true }), /FRONTEND_/);
  }
  const strippedRun = { ...run }; delete strippedRun.frontendContext;
  assert.throws(() => f.route.validateContext(s, input, { run: strippedRun }), /FRONTEND_/);
});

for (const [name, mutate] of [
  ['task', s => { s.tasks[0].title = 'changed'; }], ['plan', s => { s.plans[0].revision++; }],
  ['bot', s => { s.bots[0].revision++; }], ['saved doc', s => { s.documents[0].revision++; }],
  ['settings', s => { s.settings.language = 'en'; }], ['workspace', s => { s.projects[0].workspace += '-other'; }],
  ['provider', s => { s.projects[0].profile.provider.model += '-other'; }], ['scope policy', s => { s.events.push({ id: 'policy', type: 'governance.policy', projectId: 'p' }); }],
]) test(`current ${name} change revokes the per-run context`, async t => {
  const f = await fixture(t); await f.start(); await f.store.transaction(mutate);
  assert.throws(() => f.route.validateContext(f.store.read(), f.input(), { run: f.store.read().runs[0] }), /FRONTEND_/);
});

test('expired/revoked Owner and current checked-route loss cannot authorize a native call', async t => {
  const f = await fixture(t); await f.start();
  const call = { sessionId: 'ses_observed', callId: 'actual-tool-context-id', messageId: 'actual-message' };
  const binding = f.route.nativeBinding(call, f.native().profile);
  assert.equal(binding.nativeTurnRef.strength, 'weak'); assert.equal(binding.providerRunId, undefined);
  f.native().providerTurn.nodeId = 'foreign';
  assert.equal(f.route.authorizeNativeBinding(binding, f.store.read()), false);
  f.native().providerTurn.nodeId = 'root';
  f.session.expiresAt = 0; assert.equal(f.route.authorizeNativeBinding(binding, f.store.read()), false);
});

test('expired context and exact historical replay confer no current native authority', async t => {
  const f = await fixture(t); await f.start(); const input = f.input();
  f.expire();
  assert.throws(() => f.route.nativeBinding({ sessionId: 'ses_observed' }, f.native().profile), /FRONTEND_INTENT_INACTIVE/);
  assert.deepEqual(f.route.validateContext(f.store.read(), input, { run: f.store.read().runs[0], replay: true }), input.frontendContext);
});

test('absence of actual native observations, wrong strength/session and default purpose never mint bindings', async t => {
  const f = await fixture(t); await f.start();
  for (const mutate of [n => { n.live = false; }, n => { n.attestation = null; }, n => { n.attestation.purpose = 'guarded'; }, n => { n.attestation.names.push('forge_guarded_edit_text'); }, n => { n.attestation.binarySha256 = 'f'.repeat(64); }, n => { n.attestation.sessionID = 'foreign'; }, n => { n.profile.purpose = 'guarded'; }, n => { n.providerTurn = null; }, n => { n.providerThread.nativeThreadRef.strength = 'weak'; }, n => { n.phases = []; }]) {
    const before = structuredClone(f.native()); mutate(f.native());
    assert.throws(() => f.route.nativeBinding({ sessionId: 'ses_observed' }, f.native().profile), /FRONTEND_/);
    Object.assign(f.native(), before);
  }
  assert.throws(() => f.route.nativeBinding({ sessionId: 'guessed-session' }, f.native().profile), /FRONTEND_/);
});

test('SDK original call waits for Owner result; canonical Stop revokes it before real T3 stop', async t => {
  const f = await fixture(t); await f.start();
  const gateway = await f.route.createFrontendGateway({ profile: f.native().profile, assertCurrent: () => f.native().profile, authorizePhase: () => true, withFence: async (_id, fn) => f.store.transaction(() => fn()) });
  const boot = gateway.bootstrap();
  const bind = async () => {
    const raw = JSON.stringify({ profileDigest: digest(f.native().profile), sessionId: 'ses_observed', callId: 'Tool.Context.id:1', messageId: 'msg:1' });
    const response = await fetch(boot.brokerUrl + '/frontend-binding', { method: 'POST', headers: { Authorization: 'Bearer ' + boot.key, 'Content-Type': 'application/json', 'X-Forge-Mac': createHmac('sha256', Buffer.from(boot.key, 'hex')).update(raw).digest('hex') }, body: raw });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const grant = await bind(), client = new Client({ name: 'product-frontend-fixture', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.endpoint), { requestInit: { headers: { Authorization: grant.authorization } } }));
  f.cleanup(() => client.close());
  const scope = { projectId: 'p', runId: 'run', attemptId: 'attempt' };
  const params = id => ({ name: 'selection_read', arguments: { documentId: 'doc', expectedRevision: 1 }, _meta: { [META_KEY]: { sessionId: 'ses_observed', turnId: 'msg_observed_turn', callId: id, messageId: 'msg:1' } } });
  const first = client.callTool(params('Tool.Context.id:1'), undefined, { timeout: 5000 });
  const row = await until(() => f.route.pending(scope, f.owner).calls.find(x => x.status === 'pending'));
  const body = { ...scope, pendingId: row.pendingId, operationId: 'owner-result', result: output };
  await f.route.result(body, f.owner);
  assert.deepEqual((await first).structuredContent, { source: 'owner-frontend-selection', ...output });
  assert.equal((await f.route.result(body, f.owner)).replayed, true);
  const second = client.callTool(params('Tool.Context.id:2'), undefined, { timeout: 5000 });
  const rejected = assert.rejects(second, /FRONTEND_OUTCOME_UNKNOWN/);
  await until(() => f.route.pending(scope, f.owner).calls.find(x => x.status === 'pending'));
  await f.route.stop(scope, f.owner); await rejected;
  assert.equal(f.stops(), 1); assert.equal(f.launches(), 1);
  assert.equal(f.route.pending(scope, f.owner).calls.every(x => x.delivery === 'unknown'), true);
  assert.equal(JSON.stringify(f.store.read()).includes(grant.authorization), false);
});

test('closing one native gateway revokes only its run and does not close product broker for later attempts', async t => {
  const f = await fixture(t); await f.start();
  const options = () => ({ profile: f.native().profile, assertCurrent: () => f.native().profile, authorizePhase: () => true, withFence: async (_id, fn) => f.store.transaction(() => fn()) });
  const first = await f.route.createFrontendGateway(options());
  await first.close(); await first.close();
  const intent = await f.route.createIntent({ ...create, operationId: 'second-intent' }, f.owner);
  await f.route.start({ projectId: 'p', intentId: intent.intentId, operationId: intent.operationId }, f.owner);
  const second = await f.route.createFrontendGateway(options()), boot = second.bootstrap();
  const raw = JSON.stringify({ profileDigest: digest(f.native().profile), sessionId: 'ses_observed', callId: 'Tool.Context.id:second-run', messageId: 'actual-message' });
  const response = await fetch(boot.brokerUrl + '/frontend-binding', { method: 'POST', headers: { Authorization: 'Bearer ' + boot.key, 'Content-Type': 'application/json', 'X-Forge-Mac': createHmac('sha256', Buffer.from(boot.key, 'hex')).update(raw).digest('hex') }, body: raw });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const grant = (await response.json()).result, client = new Client({ name: 'second-native-attempt', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.endpoint), { requestInit: { headers: { Authorization: grant.authorization } } }));
  assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['selection_read']); await client.close();
  await f.route.closeRun('run-2');
  assert.throws(() => second.bootstrap(), /FRONTEND_/);
});

test('restore + SQLite reopen retain once-only intent history without recreating Owner or dispatching', async t => {
  const f = await fixture(t), before = f.store.read();
  const result = await f.start(), previous = f.store.read();
  const invalidating = f.route.invalidateForRestore();
  assert.throws(() => f.route.validateContext(previous, f.input(), { run: previous.runs[0] }), /FRONTEND_INTENT_INACTIVE/);
  await invalidating;
  const merged = mergeFrontendRouteSafety(before, previous);
  assert.equal(merged.events.find(x => x.type === 'frontend-route.intent').status, 'unknown');
  assert.equal(merged.runs.length, 1);
  await f.route.close();
  const restartedStore = await openStore(path.dirname(path.join(previous.projects[0].workspace, 'forge.sqlite')));
  const restarted = createFrontendRoute({ ...f.options, store: restartedStore }); await restarted.recover();
  f.cleanup(async () => { await restarted.close(); await restartedStore.close(); });
  const replay = await restarted.start({ projectId: 'p', intentId: result.intent.intentId, operationId: result.intent.operationId }, f.owner);
  assert.equal(replay.replayed, true); assert.equal(replay.intent.status, 'unknown'); assert.equal(f.launches(), 1);
  const intentReplay = await restarted.createIntent(create, f.owner);
  assert.equal(intentReplay.status, 'unknown');
  assert.throws(() => restarted.validateContext(restartedStore.read(), f.input(), { run: restartedStore.read().runs[0] }), /FRONTEND_INTENT_INACTIVE/);
});

test('expired intent and unchecked route fail before T3 dispatch', async t => {
  const f = await fixture(t), intent = await f.route.createIntent(create, f.owner); f.expire();
  await assert.rejects(f.route.start({ projectId: 'p', intentId: intent.intentId, operationId: intent.operationId }, f.owner), /FRONTEND_INTENT_INACTIVE/);
  f.uncheck(); await assert.rejects(f.route.createIntent({ ...create, operationId: 'second' }, f.owner), /CHECK_REQUIRED/);
  assert.equal(f.launches(), 0);
});

test('Owner raw HTTP handler authenticates before malformed bytes and accepts only local origin', async t => {
  const f = await fixture(t); let handler;
  const server = createServer((req, res) => handler.handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  handler = f.route.createHttpHandler({ endpoint: url + '/mcp/frontend-tools', authenticateOwner: req => req.headers['x-fixture-csrf'] === 'checked' ? f.owner : null });
  f.cleanup(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const response = await fetch(url + '/api/frontend-tools/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 403);
});
