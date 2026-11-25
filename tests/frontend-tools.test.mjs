import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../app/server/store.mjs';
import { createLocalAuthority } from '../app/server/authority.mjs';
import { createFrontendToolBroker, mergeFrontendToolSafety } from '../app/frontend-tools/broker.mjs';
import { createFrontendToolsHttpHandler } from '../app/frontend-tools/http.mjs';
import { META_KEY, TOOL_NAME } from '../app/frontend-tools/contract.mjs';

const binding = { projectId: 'project', runId: 'run', attemptId: 'attempt', threadId: 'native-thread', providerRunId: 'native-run', nativeSessionId: 'ses_native', nativeTurnId: 'turn_native', documentId: 'document', documentRevision: 1 };
const scope = { projectId: 'project', runId: 'run', attemptId: 'attempt' };
const native = { sessionId: 'ses_native', turnId: 'turn_native', callId: 'call_native', messageId: 'msg_native' };
const params = (callId = native.callId) => ({ name: TOOL_NAME, arguments: { documentId: 'document', expectedRevision: 1 }, _meta: { [META_KEY]: { ...native, callId } } });
const output = { status: 'ok', documentId: 'document', revision: 1, selection: { start: 3, end: 8, text: 'hello' } };
async function until(fn) {
  for (let n = 0; n < 200; n++) { const x = await fn(); if (x) return x; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('Condition timed out');
}
async function setup(t, { ttlMs, clock } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-frontend-tools-'));
  let store = await openStore(dir);
  await store.transaction(s => {
    s.projects.push({ id: 'project', workspace: dir });
    s.documents.push({ id: 'document', projectId: 'project', kind: 'doc', revision: 1 });
    s.runs.push({ id: 'run', projectId: 'project', attemptId: 'attempt', threadId: 'native-thread', providerRunId: 'native-run', status: 'running', revision: 1 });
  });
  const authority = createLocalAuthority(), owner = authority.owner({ expiresAt: Date.now() + 600000 });
  let hostActive = true;
  const options = { store, authorizeOwner: authority.goalAuthorize, authorizeNativeBinding: (b, s) => hostActive && b.nativeSessionId === 'ses_native' && b.nativeTurnId === 'turn_native' && s.runs.find(r => r.id === b.runId)?.status === 'running', ...(clock ? { clock } : {}) };
  let broker = createFrontendToolBroker(options); await broker.recover();
  const grant = broker.bindNativeTurn({ ...binding, ...(ttlMs ? { ttlMs } : {}) });
  const sockets = new Set();
  let http;
  const server = createServer((req, res) => { http.handler(req, res).then(found => { if (!found) { res.writeHead(404); res.end(); } }).catch(error => { res.writeHead(500); res.end(error.message); }); });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const authenticateOwner = req => req.headers['x-test-owner-session'] === 'opaque-fixture-session' && req.headers['x-test-csrf'] === 'test' ? owner : null;
  http = createFrontendToolsHttpHandler({ broker, endpoint: url + '/mcp/frontend-tools', authenticateOwner });
  const client = new Client({ name: 'frontend-tools-fixture', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp/frontend-tools'), { requestInit: { headers: { Authorization: grant.authorization } } }));
  const ownerHeaders = { 'x-test-owner-session': 'opaque-fixture-session', 'x-test-csrf': 'test', 'Content-Type': 'application/json' };
  const post = async (body, headers = ownerHeaders) => {
    const response = await fetch(url + '/api/frontend-tools/result', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const pending = async () => until(() => broker.state(scope, owner).calls.find(c => c.status === 'pending'));
  const resultInput = pendingId => ({ ...scope, pendingId, operationId: 'owner-result', result: output });
  t.after(async () => { await client.close().catch(() => {}); await http.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, broker, owner, options, grant, client, url, post, pending, resultInput, ownerHeaders, deactivate: () => { hostActive = false; }, replaceBroker: b => { broker = b; } };
}

test('actual SDK HTTP tools/call waits, accepts Owner typed result once and resumes original request', async t => {
  const h = await setup(t);
  assert.deepEqual((await h.client.listTools()).tools.map(x => x.name), [TOOL_NAME]);
  let settled = false;
  const call = h.client.callTool(params(), undefined, { timeout: 5000 }).finally(() => { settled = true; });
  const row = await h.pending();
  assert.equal(settled, false);
  const response = await h.post(h.resultInput(row.pendingId));
  assert.equal(response.status, 200); assert.equal(response.body.replayed, false);
  const result = await call;
  assert.deepEqual(result.structuredContent, { source: 'owner-frontend-selection', ...output });
  assert.equal(JSON.parse(result.content[0].text).selection.text, 'hello');
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 1);
  const again = await h.post(h.resultInput(row.pendingId));
  assert.equal(again.status, 200); assert.equal(again.body.replayed, true);
  assert.equal(h.broker.state(scope, h.owner).calls[0].status, 'released');
  await assert.rejects(h.client.callTool(params(), undefined, { timeout: 5000 }), /FRONTEND_CALL_ALREADY_SEEN/);
  assert.equal(h.store.read().events.filter(e => e.type === 'frontend-tools.call').length, 1);
  const events = h.store.read().events.filter(e => e.type === 'agui');
  assert.equal(events.filter(e => e.event.name === 'forge.frontend-tool.pending').length, 1);
  assert.equal(events.some(e => e.event.type === 'TOOL_CALL_RESULT'), false, 'broker cannot claim native observation');
  assert.equal(JSON.stringify(h.store.read()).includes(h.grant.authorization.slice(7)), false);
});

test('scoped authentication precedes malformed body/validation and mutations on both HTTP paths', async t => {
  const h = await setup(t), before = h.store.read().revision;
  assert.equal((await h.post('{')).status, 400);
  assert.equal((await h.post('{', { 'Content-Type': 'application/json' })).status, 403);
  const nativeResponse = await fetch(h.url + '/mcp/frontend-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid' }, body: '{' });
  assert.equal(nativeResponse.status, 401);
  assert.equal(h.store.read().revision, before);
  assert.throws(() => h.broker.state(scope, { role: 'owner' }), /FRONTEND_OWNER_REQUIRED/);
  await assert.rejects(h.broker.returnResult({ ...scope, result: { evil: true } }, {}), /FRONTEND_OWNER_REQUIRED/);
  // A declared giant body without sending a byte proves the decision did not
  // wait for JSON or allocate the pending native continuation.
  const response = await new Promise((resolve, reject) => {
    const r = request(h.url + '/api/frontend-tools/result', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 999999 } }, res => { res.resume(); resolve(res.statusCode); r.destroy(); });
    r.on('error', reject); r.flushHeaders();
  });
  assert.equal(response, 403);
});

test('wrong native/session/document/call metadata never reserves a frontend effect', async t => {
  const h = await setup(t);
  for (const change of [
    x => { x._meta[META_KEY].sessionId = 'foreign'; },
    x => { x._meta[META_KEY].turnId = 'foreign'; },
    x => { delete x._meta; },
    x => { x.arguments.documentId = 'foreign'; },
    x => { x.arguments.expectedRevision = 2; },
    x => { x.arguments.code = 'arbitrary javascript'; },
    x => { x.name = 'edit_text'; },
    x => { x._meta[META_KEY].requestId = 'not-a-native-call'; },
  ]) { const input = params(); change(input); await assert.rejects(h.client.callTool(input, undefined, { timeout: 5000 }), /FRONTEND_/); }
  assert.equal(h.broker.state(scope, h.owner).calls.length, 0);
});

test('strict typed Owner result confines identity, revision and bounded read-only selection', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 });
  const row = await h.pending(), body = h.resultInput(row.pendingId);
  for (const input of [
    { ...body, projectId: 'foreign' }, { ...body, attemptId: 'foreign' },
    { ...body, result: { ...output, revision: 2 } },
    { ...body, result: { ...output, script: 'evil' } },
    { ...body, result: { ...output, selection: { start: 0, end: 9000, text: 'x'.repeat(9000) } } },
    { ...body, result: { ...output, selection: { start: 0, end: 2, text: 'hello' } } },
    { ...body, result: { ...output, selection: { start: 0, end: 5, text: 'hello', saved: true } } },
  ]) assert.ok((await h.post(input)).status >= 400);
  assert.equal(h.broker.state(scope, h.owner).calls[0].status, 'pending');
  assert.equal((await h.post(body)).status, 200); await call;
  const conflicting = { ...body, result: { ...output, selection: { start: 0, end: 5, text: 'other' } } };
  assert.equal((await h.post(conflicting)).status, 409);
  await assert.rejects(h.broker.returnResult(conflicting, h.owner), /OPERATION_REUSE/);
});

test('Stop invalidates pending SDK continuation and stale Owner return, preserving durable unknown', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 });
  const caught = assert.rejects(call, /FRONTEND_OUTCOME_UNKNOWN/), row = await h.pending();
  await h.store.transaction(s => { s.runs[0].stopRequest = { status: 'requested' }; });
  const stopped = h.broker.revokeRun(scope);
  assert.throws(() => h.broker.authenticateNative(h.grant.authorization), /FRONTEND_AUTH/);
  await stopped; await caught;
  assert.equal((await h.post(h.resultInput(row.pendingId))).status, 409);
  assert.equal(h.broker.state(scope, h.owner).calls[0].status, 'unknown');
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 0);
});

test('expiry and canonical binding changes cannot return a queued result', async t => {
  let time = Date.now(); const h = await setup(t, { clock: () => time });
  const call = h.client.callTool(params(), undefined, { timeout: 5000 });
  const caught = assert.rejects(call, /FRONTEND_OUTCOME_UNKNOWN/), row = await h.pending();
  time += 120001; await h.broker.sweep(); await caught;
  assert.equal((await h.post(h.resultInput(row.pendingId))).status, 401);
  assert.equal(h.broker.state(scope, h.owner).calls[0].status, 'unknown');
  assert.throws(() => h.broker.authenticateNative(h.grant.authorization), /FRONTEND_LEASE_INACTIVE/);
});

test('actual HTTP disconnect/cancel cannot be replayed as another native tools/call', async t => {
  const h = await setup(t), controller = new AbortController();
  const call = h.client.callTool(params(), undefined, { timeout: 5000, signal: controller.signal });
  const caught = assert.rejects(call), row = await h.pending();
  controller.abort(); await caught;
  await until(() => h.broker.state(scope, h.owner).calls[0].status === 'unknown');
  assert.equal((await h.post(h.resultInput(row.pendingId))).status, 409);
  await assert.rejects(h.client.callTool(params(), undefined, { timeout: 5000 }), /FRONTEND_CALL_ALREADY_SEEN/);
});

test('restart recovery invalidates pending calls and replays accepted Owner receipt without redelivery', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 }), row = await h.pending();
  const body = h.resultInput(row.pendingId); await h.post(body); await call;
  const pendingCall = h.client.callTool(params('second-native-call'), undefined, { timeout: 5000 });
  const caught = assert.rejects(pendingCall); await h.pending();
  await h.broker.close(); await caught;
  const second = createFrontendToolBroker(h.options); await second.recover();
  assert.equal(second.state(scope, h.owner).calls.every(c => c.status === 'unknown'), true);
  const replay = await second.returnResult(body, h.owner);
  assert.equal(replay.replayed, true); assert.equal(replay.call.delivery, 'unknown');
  assert.throws(() => second.authenticateNative(h.grant.authorization), /FRONTEND_AUTH/);
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 1);
  await second.close();
});

test('policy/native revocation, changed document revision and the Guarded route refuse before result admission', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 });
  const caught = assert.rejects(call), row = await h.pending();
  await h.store.transaction(s => { s.documents[0].revision = 2; });
  assert.equal((await h.post(h.resultInput(row.pendingId))).status, 409);
  await h.broker.sweep(); await caught;
  const next = createFrontendToolBroker(h.options); await next.recover();
  await h.store.transaction(s => { s.documents[0].revision = 1; s.runs[0].proactiveContext = { occurrenceId: 'guarded' }; });
  assert.throws(() => next.bindNativeTurn(binding), /FRONTEND_ATTEMPT_INACTIVE/);
  await next.close();
});

test('frontend errors are actual SDK error results, not success or a saved edit', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 }), row = await h.pending();
  await h.post({ ...h.resultInput(row.pendingId), result: { status: 'error', documentId: 'document', revision: 1, error: { code: 'NO_SELECTION' } } });
  const result = await call;
  assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, 'NO_SELECTION');
  assert.equal(h.store.read().documents[0].revision, 1);
});

test('concurrent Owner returns reserve one receipt and resolve exactly one native continuation', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 }), row = await h.pending();
  const results = await Promise.all([h.post(h.resultInput(row.pendingId)), h.post(h.resultInput(row.pendingId))]);
  assert.deepEqual(results.map(x => x.status), [200, 200]);
  assert.deepEqual(results.map(x => x.body.replayed).sort(), [false, true]);
  await call;
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 1);
  assert.equal((await h.post({ ...h.resultInput(row.pendingId), operationId: 'another-operation' })).status, 409);
});

test('per-turn outstanding call bound prevents further reservation, real timer expires waits', async t => {
  const h = await setup(t, { ttlMs: 900 });
  const calls = Array.from({ length: 4 }, (_, n) => h.client.callTool(params(`call_${n}`), undefined, { timeout: 5000 }));
  const catches = calls.map(c => assert.rejects(c, /FRONTEND_OUTCOME_UNKNOWN/));
  await until(() => h.broker.state(scope, h.owner).calls.length === 4);
  await assert.rejects(h.client.callTool(params('fifth-call'), undefined, { timeout: 5000 }), /FRONTEND_BUSY/);
  await Promise.all(catches);
  assert.equal(h.broker.state(scope, h.owner).calls.every(c => c.status === 'unknown'), true);
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 0);
});

test('pending and Owner receipts survive SQLite reopen; restore preserves identities and revokes old grants', async t => {
  const h = await setup(t), before = h.store.read();
  const call = h.client.callTool(params(), undefined, { timeout: 5000 }), row = await h.pending();
  const body = h.resultInput(row.pendingId); await h.post(body); await call;
  const persisted = await openStore(h.dir);
  const restarted = createFrontendToolBroker({ ...h.options, store: persisted }); await restarted.recover();
  const recovered = restarted.state(scope, h.owner).calls[0];
  assert.equal(recovered.status, 'unknown'); assert.equal(recovered.reason, 'process-restart');
  assert.equal((await restarted.returnResult(body, h.owner)).replayed, true);
  const merged = mergeFrontendToolSafety(before, persisted.read());
  assert.equal(merged.receipts.filter(r => r.type === 'frontend-tools.result').length, 1);
  assert.equal(merged.events.filter(r => r.type === 'frontend-tools.call').length, 1);
  assert.equal(merged.events.find(r => r.type === 'frontend-tools.call').status, 'unknown');
  const invalidation = h.broker.invalidateForRestore();
  assert.throws(() => h.broker.authenticateNative(h.grant.authorization), /FRONTEND_AUTH/);
  await invalidation;
  const conflict = structuredClone(merged); conflict.receipts[0].fingerprint = 'forged';
  assert.throws(() => mergeFrontendToolSafety(conflict, persisted.read()), /FRONTEND_RESTORE_CONFLICT/);
  await restarted.close(); await persisted.close();
});

test('canonical Stop committed while Owner result waits for transaction fence prevents acceptance', async t => {
  const h = await setup(t), call = h.client.callTool(params(), undefined, { timeout: 5000 });
  const caught = assert.rejects(call), row = await h.pending();
  let release, acquired;
  const locked = new Promise(r => { acquired = r; });
  const stop = h.store.transaction(async s => { acquired(); await new Promise(r => { release = r; }); s.runs[0].stopRequest = { status: 'requested' }; });
  await locked;
  const returned = h.broker.returnResult(h.resultInput(row.pendingId), h.owner);
  const rejected = assert.rejects(returned, /FRONTEND_ATTEMPT_INACTIVE/);
  release(); await stop; await rejected;
  await h.broker.sweep(); await caught;
  assert.equal(h.store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 0);
});

test('private-adapter identities retain actual weak refs and refuse invented orchestration run IDs', async t => {
  const h = await setup(t); await h.broker.close();
  const privateBinding = { ...scope, identityKind: 'private-adapter', threadId: binding.threadId, rootNodeId: 'node', providerThreadId: 'provider-thread', providerTurnId: 'provider-turn', nativeThreadRef: { driver: 'opencode', nativeId: 'ses_native', strength: 'strong' }, nativeTurnRef: { driver: 'opencode', nativeId: 'turn_native', strength: 'weak' }, nativeSessionId: 'ses_native', nativeTurnId: 'turn_native', documentId: 'document', documentRevision: 1 };
  await h.store.transaction(s => { const run = s.runs[0]; delete run.providerRunId; Object.assign(run, { rootNodeId: 'node', nativeProviderThreadId: 'provider-thread', nativeProviderTurnId: 'provider-turn', nativeThreadRef: privateBinding.nativeThreadRef, nativeTurnRef: privateBinding.nativeTurnRef }); });
  const broker = createFrontendToolBroker(h.options); await broker.recover();
  for (const value of [{ ...privateBinding, providerRunId: 'invented' }, { ...privateBinding, rootNodeId: 'foreign' }, { ...privateBinding, nativeTurnRef: { ...privateBinding.nativeTurnRef, strength: 'strong' } }]) assert.throws(() => broker.bindNativeTurn(value), /FRONTEND_/);
  const grant = broker.bindNativeTurn(privateBinding);
  const call = broker.callNative(grant.handle, params()), row = await until(() => broker.state(scope, h.owner).calls[0]);
  await broker.returnResult(h.resultInput(row.pendingId), h.owner);
  assert.equal((await call).structuredContent.selection.text, 'hello');
  assert.equal(h.store.read().runs[0].providerRunId, undefined);
  assert.equal(h.store.read().events.find(e => e.type === 'frontend-tools.call').binding.nativeTurnRef.strength, 'weak');
  await broker.close();
});
