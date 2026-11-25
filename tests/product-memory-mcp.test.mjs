import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../app/server/store.mjs';
import { entity } from '../app/server/domain.mjs';
import { createLocalAuthority } from '../app/server/authority.mjs';
import { createMemoryService } from '../app/memory/index.mjs';
import { createRunMemoryMcpGateway, mergeMemoryMcpSafety, MEMORY_MCP_OWNER_SCHEMAS } from '../app/server/memory-mcp.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'forge-memory-mcp-')), store = await openStore(dataDir), authority = createLocalAuthority();
  const selection = { instanceId: 'engineering-fixture-only', model: 'fixture-no-inference', options: [], connectionId: randomUUID(), connectionGeneration: 1 };
  const project = entity({ name: 'Disposable transport qualification', workspace: path.join(dataDir, 'workspace'), profile: { provider: selection } });
  const otherProject = entity({ name: 'Foreign fixture project', workspace: path.join(dataDir, 'other') });
  const bot = entity({ name: 'Fixture bot' }, project.id), otherBot = entity({ name: 'Other bot' }, project.id);
  const task = entity({ title: 'Fixture task', botId: bot.id }, project.id), otherTask = entity({ title: 'Other task', botId: otherBot.id }, project.id);
  const conversation = entity({ kind: 'team' }, project.id);
  const run = entity({ operationId: randomUUID(), attemptId: randomUUID(), status: 'running', taskId: task.id, botId: bot.id, conversationId: conversation.id, threadId: randomUUID(), providerRunId: randomUUID(), t3ProjectId: randomUUID(), providerInstanceId: selection.instanceId, selection }, project.id);
  await store.transaction(s => { s.projects.push(project, otherProject); s.bots.push(bot, otherBot); s.tasks.push(task, otherTask); s.conversations.push(conversation); s.runs.push(run); s.connections.push({ ...entity({ kind: 'provider', providerInstanceId: selection.instanceId, enabled: true, config: { generation: 1, routeId: 'fixture-no-provider-call', accountRoute: 'fixture-only' } }, project.id), id: selection.connectionId }); });
  const memory = await createMemoryService({ store, dataDir, authorize: authority.authorize });
  let time = Date.now(), gateway, memoryCall, arrivals = 0;
  const requests = new Set(), arrivalWaiters = [];
  // Instrument entry only; every operation still uses real Memory/SQLite/authority.
  const observedMemory = Object.fromEntries(['remember', 'recall', 'update', 'list', 'forget'].map(method => [method, (...args) => { memoryCall?.resolve(method); return memory[method](...args); }]));
  const server = createServer(async (req, res) => {
    arrivals++; for (const w of arrivalWaiters) if (arrivals >= w.count) w.ready.resolve();
    requests.add(req); res.on('close', () => requests.delete(req));
    try { if (!await gateway.handler(req, res)) res.writeHead(404).end(); } catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp/memory`;
  const ownerSession = { expiresAt: Date.now() + 3600000 }, owner = authority.owner(ownerSession);
  const makeGateway = () => createRunMemoryMcpGateway({ store, memory: observedMemory, endpoint, authorizeOwner: authority.goalAuthorize, callerForRun: authority.forRun, clock: () => time });
  gateway = makeGateway();
  t.after(async () => { await gateway.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await memory.close(); await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const input = (extra = {}) => ({ projectId: project.id, scope: { projectId: project.id, kind: 'project', id: project.id }, ...extra });
  const issueInput = extra => ({ projectId: project.id, runId: run.id, operationId: randomUUID(), expectedRevision: store.read().runs.find(r => r.id === run.id).revision, ...extra });
  const issue = (extra = {}) => gateway.issue(issueInput(extra), owner);
  const headers = grant => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: grant.configuration.headers.Authorization, 'mcp-protocol-version': '2025-03-26' });
  const rpc = (grant, method, params = {}, extra = {}) => fetch(endpoint, { method: 'POST', headers: headers(grant), body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), ...extra });
  const call = async (grant, method, args = input()) => { const response = await rpc(grant, 'tools/call', { name: method.includes('.') ? method : `memory.${method}`, arguments: args }); return { status: response.status, body: await response.json() }; };
  return { dataDir, store, authority, memory, owner, ownerSession, project, otherProject, bot, otherBot, task, otherTask, run, selection, endpoint, server, input, issueInput, issue, headers, rpc, call,
    get gateway() { return gateway; }, advance: ms => { time += ms; },
    restart: async () => { await gateway.close(); gateway = makeGateway(); },
    waitCall: () => { memoryCall = deferred(); return memoryCall.promise; },
    arrivals: () => arrivals,
    waitArrivals: count => { if (arrivals >= count) return Promise.resolve(); const ready = deferred(); arrivalWaiters.push({ count, ready }); return ready.promise; },
  };
}
const result = response => response.body.result?.structuredContent;
const errorCode = response => response.body.result?.structuredContent?.error?.code ?? response.body.error?.code;
const remember = f => f.input({ operationId: randomUUID(), memoryType: 'semantic', title: 'Transport memory', content: 'Scoped recovery ภาษาไทย data' });
async function holdStore(f) { const entered = deferred(), release = deferred(); const pending = f.store.transaction(async s => { entered.resolve(s); await release.promise; }); const state = await entered.promise; return { state, release: release.resolve, pending }; }

test('official SDK Streamable HTTP performs all five operations through real SQLite and run authority', async t => {
  const f = await fixture(t), grant = await f.issue({ access: 'read-write' });
  const client = new Client({ name: 'forge-engineering-http-fixture', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(f.endpoint), { requestInit: { headers: grant.configuration.headers } });
  await client.connect(transport); t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['memory.remember', 'memory.recall', 'memory.update', 'memory.list', 'memory.forget']);
  const call = async (method, args) => { const out = await client.callTool({ name: `memory.${method}`, arguments: args }); assert.notEqual(out.isError, true, JSON.stringify(out)); return out.structuredContent; };
  for (const [kind, id] of [['project', f.project.id], ['task', f.task.id], ['agent', f.bot.id], ['session', f.run.conversationId]]) {
    const scope = { projectId: f.project.id, kind, id }, base = f.input({ scope });
    const first = await call('remember', { ...remember(f), scope }); assert.equal(first.scope.kind, kind);
    const found = await call('recall', { ...base, query: 'ภาษาไทย' }); assert.equal(found.items[0].id, first.id); assert.equal(found.trust, 'untrusted-data');
    const updated = await call('update', { ...base, id: first.id, operationId: randomUUID(), expectedRevision: 1, patch: { pinned: true, content: 'Updated scoped data' } }); assert.equal(updated.revision, 2);
    assert.equal((await call('list', base)).items[0].id, first.id);
    assert.equal((await call('forget', { ...base, id: first.id, operationId: randomUUID(), expectedRevision: 2 })).deleted, true);
    assert.equal((await call('list', base)).items.length, 0);
  }
  assert.equal(grant.transportStatus, 'HTTP_MCP_AVAILABLE'); assert.equal(grant.nativeAttachmentStatus, 'NATIVE_ATTACHMENT_NOT_CONFIGURED');
  assert.equal(f.gateway.state({ projectId: f.project.id, runId: f.run.id }, f.owner).nativeAttachmentQualification, 'NOT_RUN');
});

test('read is default; tools/list and direct calls deny writes and every other tool', async t => {
  const f = await fixture(t), read = await f.issue(), write = await f.issue({ access: 'read-write' });
  assert.notEqual(read.configuration.headers.Authorization, write.configuration.headers.Authorization);
  assert.equal(read.session.expiresAt - read.session.issuedAt, 300000);
  assert.match(read.configuration.headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
  const tools = await (await f.rpc(read, 'tools/list')).json(); assert.deepEqual(tools.result.tools.map(t => t.name), ['memory.recall', 'memory.list']);
  const first = result(await f.call(write, 'remember', remember(f)));
  for (const [name, input] of [['remember', remember(f)], ['update', f.input({ id: first.id, operationId: randomUUID(), expectedRevision: 1, patch: { pinned: true } })], ['forget', f.input({ id: first.id, operationId: randomUUID(), expectedRevision: 1 })]]) assert.equal(errorCode(await f.call(read, name, input)), 'MEMORY_MCP_READ_ONLY');
  for (const name of ['owner.remember', 'owner.share', 'memory.configure', 'memory.export', 'owner.issue', 'memory-mcp.issue']) assert.equal(errorCode(await f.call(write, name)), 'MEMORY_UNKNOWN_TOOL');
  assert.equal(result(await f.call(read, 'list')).items.length, 1);
});

test('foreign scopes, forged actors, sensitive and sharing never gain run authority', async t => {
  const f = await fixture(t), grant = await f.issue({ access: 'read-write' });
  const r = result(await f.call(grant, 'remember', remember(f)));
  for (const scope of [{ projectId: f.otherProject.id, kind: 'project', id: f.otherProject.id }, { projectId: f.project.id, kind: 'task', id: f.otherTask.id }, { projectId: f.project.id, kind: 'agent', id: f.otherBot.id }, { projectId: f.project.id, kind: 'owner', id: 'local-owner' }]) {
    assert.equal((await f.call(grant, 'list', { projectId: scope.projectId, scope })).body.result.isError, true);
    assert.equal((await f.call(grant, 'remember', { ...remember(f), projectId: scope.projectId, scope })).body.result.isError, true);
  }
  for (const forged of [{ actor: 'owner' }, { owner: true }, { callerContext: {} }, { grants: [{ actions: ['write'] }] }]) assert.equal(errorCode(await f.call(grant, 'list', f.input(forged))), 'MEMORY_VALIDATION');
  assert.equal(errorCode(await f.call(grant, 'remember', { ...remember(f), sensitive: true })), 'MEMORY_FORBIDDEN');
  assert.equal(errorCode(await f.call(grant, 'update', f.input({ id: r.id, expectedRevision: 1, operationId: randomUUID(), patch: { shares: [] } }))), 'MEMORY_FORBIDDEN');
  assert.equal(f.authority.authorize({ action: 'owner.read', scope: { kind: 'owner', id: 'local-owner' }, callerContext: grant.configuration, state: f.store.read() }), false);
});

test('strict human Owner input, revisions, metadata-only operation replay and restart', async t => {
  const f = await fixture(t), input = f.issueInput({});
  for (const caller of [{}, { kind: 'human', role: 'owner' }, f.authority.forRun(f.run, { allowWrite: true })]) await assert.rejects(f.gateway.issue(input, caller), { code: 'MEMORY_MCP_OWNER_REQUIRED' });
  for (const patch of [{ actor: 'owner' }, { owner: true }, { access: 'write' }, { expectedRevision: 0 }, { expectedRevision: '1' }, { scope: {} }]) await assert.rejects(f.gateway.issue({ ...input, ...patch }, f.owner), { code: 'MEMORY_MCP_VALIDATION' });
  await assert.rejects(f.gateway.issue({ ...input, expectedRevision: 99 }, f.owner), { code: 'MEMORY_MCP_REVISION_CONFLICT' });
  const [a, b] = await Promise.all([f.gateway.issue(input, f.owner), f.gateway.issue(input, f.owner)]);
  assert.ok(a.configuration); assert.equal(b.replayed, true); assert.equal(b.configuration, undefined);
  const snapshot = JSON.stringify(f.store.read()), bearer = a.configuration.headers.Authorization;
  assert.equal(snapshot.includes(bearer), false); assert.equal(snapshot.includes(bearer.slice(7)), false); assert.equal(snapshot.includes('Authorization'), false);
  const records = f.store.read().events.filter(e => e.type === 'memory-mcp.session'); assert.equal(records.length, 1); assert.match(records[0].tokenHash, /^[0-9a-f]{64}$/);
  const state = f.gateway.state({ projectId: f.project.id, runId: f.run.id }, f.owner); assert.equal(JSON.stringify(state).includes('tokenHash'), false); assert.equal(state.sessions[0].status, 'ACTIVE');
  await assert.rejects(f.gateway.issue({ ...input, access: 'read-write' }, f.owner), { code: 'MEMORY_MCP_OPERATION_REUSE' });
  f.advance(300000); assert.equal((await f.call(a, 'list')).status, 401);
  assert.equal((await f.gateway.issue(input, f.owner)).configuration, undefined);
  const fresh = await f.issue(); await f.restart();
  assert.equal((await f.call(fresh, 'list')).status, 401);
  assert.equal((await f.gateway.issue(input, f.owner)).configuration, undefined);
  assert.equal(f.gateway.state({ projectId: f.project.id, runId: f.run.id }, f.owner).sessions.at(-1).status, 'INVALIDATED');
  assert.ok((await f.issue()).configuration);
  assert.equal(MEMORY_MCP_OWNER_SCHEMAS.issue.additionalProperties, false);
});

test('revocation is canonical, independent per session, idempotent, and cannot be forged', async t => {
  const f = await fixture(t), a = await f.issue(), b = await f.issue();
  const revoke = { ...f.issueInput({}), sessionId: a.session.sessionId };
  await assert.rejects(f.gateway.revoke(revoke, { owner: true }), { code: 'MEMORY_MCP_OWNER_REQUIRED' });
  await assert.rejects(f.gateway.revoke({ ...revoke, projectId: f.otherProject.id }, f.owner), { code: 'MEMORY_MCP_SCOPE' });
  assert.equal((await f.gateway.revoke(revoke, f.owner)).revoked, true);
  assert.equal((await f.gateway.revoke(revoke, f.owner)).replayed, true);
  assert.equal((await f.call(a, 'list')).status, 401); assert.equal((await f.call(b, 'list')).status, 200);
  assert.ok(f.store.read().events.find(e => e.id === a.session.sessionId).revokedAt);
});

test('live exact native/model/account/project/attempt binding is rechecked on each call', async t => {
  const f = await fixture(t), grant = await f.issue(), original = f.store.read();
  const changes = [s => { s.runs[0].attemptId = randomUUID(); }, s => { s.runs[0].threadId = randomUUID(); }, s => { s.runs[0].providerRunId = randomUUID(); }, s => { s.runs[0].t3ProjectId = randomUUID(); }, s => { s.runs[0].providerInstanceId = 'foreign'; }, s => { s.runs[0].selection.model = 'different'; }, s => { s.projects[0].profile.provider.model = 'different'; }, s => { s.connections[0].config.generation++; }, s => { s.connections[0].config.accountRoute = 'different'; }, s => { s.connections[0].enabled = false; }, s => { s.tasks[0].botId = f.otherBot.id; }, s => { s.projects[0].workspace += '-moved'; }, ...['completed', 'failed', 'cancelled', 'unknown', 'interrupted', 'stopped'].map(status => s => { s.runs[0].status = status; }), s => { s.runs[0].stopRequest = { status: 'requested' }; }];
  for (const change of changes) {
    await f.store.transaction(s => { Object.assign(s, structuredClone(original)); change(s); });
    assert.equal((await f.call(grant, 'list')).status, 401);
  }
});

test('proactive/research/Guarded attempts cannot use Memory even if a context is stripped', async t => {
  const f = await fixture(t), original = f.store.read(), grant = await f.issue();
  for (const change of [s => { s.runs[0].proactiveContext = {}; }, s => { s.runs[0].researchContext = {}; }, s => { s.runs[0].guardedContext = {}; }, s => { s.runs[0].guardedReceipt = {}; }, s => { s.connections[0].config.routeId = 'forge-guarded'; }, s => { s.connections[0].routeId = 'forge-guarded'; }, ...['proactive.occurrence', 'research.trial'].map(type => s => { s.events.push(entity({ type, runId: f.run.id }, f.project.id)); }), s => { s.events.push(entity({ type: 'proactive.occurrence', operationId: f.run.operationId }, f.project.id)); }, s => { s.events.push(entity({ type: 'proactive.occurrence', held: true }, f.project.id)); }, s => { s.events.push(entity({ type: 'research.trial', runOperationId: f.run.operationId }, f.project.id)); }]) {
    await f.store.transaction(s => { Object.assign(s, structuredClone(original)); change(s); });
    await assert.rejects(f.issue(), { code: 'MEMORY_MCP_QUALIFICATION' });
    assert.equal((await f.call(grant, 'list')).status, 401);
  }
});

test('Owner cannot issue until the native binding and selected account/model are established', async t => {
  const f = await fixture(t), original = f.store.read();
  for (const change of [s => { delete s.runs[0].threadId; }, s => { delete s.runs[0].providerRunId; }, s => { delete s.runs[0].attemptId; }, s => { s.runs[0].status = 'submitting'; }, s => { s.runs[0].status = 'completed'; }, s => { s.projects[0].profile.provider.model = 'changed'; }, s => { s.connections[0].config.generation++; }, s => { s.tasks[0].botId = f.otherBot.id; }]) {
    await f.store.transaction(s => { Object.assign(s, structuredClone(original)); change(s); });
    await assert.rejects(f.issue());
    assert.equal(f.store.read().events.some(e => e.type === 'memory-mcp.session'), false);
  }
});

test('restore preserves consumed Owner operation identities and revocations without restoring a bearer', async t => {
  const f = await fixture(t), old = f.store.read(), input = f.issueInput({}), a = await f.gateway.issue(input, f.owner);
  const beforeRevoke = f.store.read();
  await f.gateway.revoke({ ...f.issueInput({}), sessionId: a.session.sessionId }, f.owner);
  const previous = f.store.read(); f.gateway.invalidateForRestore();
  await f.store.transaction(s => { Object.assign(s, mergeMemoryMcpSafety(structuredClone(old), previous)); });
  assert.equal((await f.call(a, 'list')).status, 401);
  assert.equal((await f.gateway.issue(input, f.owner)).configuration, undefined);
  assert.equal(f.gateway.state({ projectId: f.project.id, runId: f.run.id }, f.owner).sessions[0].status, 'REVOKED');
  const reversed = mergeMemoryMcpSafety(structuredClone(previous), beforeRevoke);
  assert.ok(reversed.events.find(e => e.id === a.session.sessionId).revokedAt);
  await f.restart(); assert.equal((await f.gateway.issue(input, f.owner)).configuration, undefined);
  const conflict = structuredClone(previous); conflict.receipts.find(r => r.operationId === input.operationId).fingerprint = 'different';
  assert.throws(() => mergeMemoryMcpSafety(conflict, previous), { code: 'MEMORY_MCP_RESTORE_CONFLICT' });
  assert.ok((await f.issue()).configuration);
});

test('queued real mutation rechecks Stop, expiry, revoke and restore inside its transaction', async t => {
  for (const action of ['stop', 'expiry', 'revoke', 'restore']) await t.test(action, async t => {
    const f = await fixture(t), grant = await f.issue({ access: 'read-write' }), held = await holdStore(f);
    let revoked;
    if (action === 'revoke') revoked = f.gateway.revoke({ ...f.issueInput({}), sessionId: grant.session.sessionId }, f.owner);
    const called = f.waitCall(), pending = f.call(grant, 'remember', remember(f)); await called;
    if (action === 'stop') held.state.runs[0].stopRequest = { status: 'requested' };
    if (action === 'expiry') f.advance(300000);
    if (action === 'restore') f.gateway.invalidateForRestore();
    held.release(); await held.pending; await revoked;
    const response = await pending;
    assert.ok(['MEMORY_FORBIDDEN', 'MEMORY_MCP_LEASE_INACTIVE'].includes(errorCode(response)), JSON.stringify(response));
    assert.equal(f.store.read().events.some(e => e.type === 'memory.record'), false);
  });
});

test('memory operation replay is durable but never duplicates canonical records', async t => {
  const f = await fixture(t), grant = await f.issue({ access: 'read-write' }), input = remember(f);
  const a = result(await f.call(grant, 'remember', input)), b = result(await f.call(grant, 'remember', input));
  assert.equal(b.id, a.id); assert.equal(b.replayed, true);
  assert.equal(f.store.read().events.filter(e => e.type === 'memory.record').length, 1);
});

test('raw handler enforces exact path, local Host/Origin, auth before body, bounded chunked JSON and no batches', async t => {
  const f = await fixture(t), grant = await f.issue(), post = (body, extra = {}) => fetch(f.endpoint, { method: 'POST', headers: f.headers(grant), body, ...extra });
  assert.equal((await fetch(f.endpoint + '/suffix')).status, 404);
  assert.equal((await fetch(f.endpoint + '?x=1', { method: 'POST', headers: f.headers(grant), body: '{}' })).status, 400);
  assert.equal((await post('{}', { headers: { ...f.headers(grant), Origin: 'http://evil.invalid' } })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const req = httpRequest(f.endpoint, { method: 'POST', headers: { ...f.headers(grant), Host: 'evil.invalid' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.once('error', reject); req.end('{}');
  });
  assert.equal(badHost, 403);
  assert.equal((await post('invalid', { headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await post('x'.repeat(70000), { headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await post('{}', { headers: { ...f.headers(grant), 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(f.endpoint, { headers: f.headers(grant) })).status, 405);
  assert.equal((await post('[' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + ']')).status, 400);
  assert.equal((await post('not-json')).status, 400);
  assert.equal((await post('x'.repeat(70000))).status, 413);
  async function* chunks() { for (let i = 0; i < 9; i++) yield Buffer.alloc(8192, 120); }
  assert.equal((await post(chunks(), { duplex: 'half' })).status, 413);
  // A remote socket fails before bearer verification or body subscription.
  let consumed = false, status;
  await f.gateway.handler({ url: '/mcp/memory', socket: { remoteAddress: '192.0.2.1' }, headers: { host: new URL(f.endpoint).host }, on() { consumed = true; } }, { writeHead(code) { status = code; }, end() {} });
  assert.equal(status, 403); assert.equal(consumed, false);
  let readWithoutAuth = false;
  await f.gateway.handler({ url: '/mcp/memory', socket: { remoteAddress: '127.0.0.1' }, headers: { host: new URL(f.endpoint).host, 'content-length': '99999999' }, on() { readWithoutAuth = true; } }, { writeHead(code) { status = code; }, end() {} });
  assert.equal(status, 401); assert.equal(readWithoutAuth, false);
});

test('slow/chunked requests recheck the current lease after body and cap concurrency before parsing', async t => {
  const f = await fixture(t), grant = await f.issue(), start = f.arrivals();
  const open = () => {
    const done = deferred(), req = httpRequest(f.endpoint, { method: 'POST', headers: f.headers(grant) }, res => { let body = ''; res.on('data', b => { body += b; }); res.on('end', () => done.resolve({ status: res.statusCode, body })); });
    req.on('error', error => done.resolve({ error })); req.flushHeaders(); req.write('{'); return { req, done: done.promise };
  };
  const slow = open(); await f.waitArrivals(start + 1);
  f.gateway.invalidateForRestore(); slow.req.end('"jsonrpc":"2.0","id":1,"method":"tools/list"}');
  assert.equal((await slow.done).status, 401);
  const fresh = await f.issue(); Object.assign(grant, fresh);
  const before = f.arrivals(), slots = Array.from({ length: 32 }, open); await f.waitArrivals(before + 32);
  assert.equal((await f.rpc(fresh, 'tools/list')).status, 429);
  for (const item of slots) item.req.end('"jsonrpc":"2.0","id":1,"method":"tools/list"}');
  for (const item of slots) assert.equal((await item.done).status, 200);
  assert.equal((await f.rpc(fresh, 'tools/list')).status, 200);
});

test('close invalidates already queued service work, closes raw requests, and denies new actions', async t => {
  const f = await fixture(t), grant = await f.issue({ access: 'read-write' }), held = await holdStore(f);
  const called = f.waitCall(), pending = f.call(grant, 'remember', remember(f)).catch(() => null); await called;
  const closing = f.gateway.close(); held.release(); await held.pending; await closing; await pending;
  assert.equal(f.store.read().events.some(e => e.type === 'memory.record'), false);
  await assert.rejects(f.issue(), { code: 'MEMORY_MCP_CLOSED' });
  assert.equal((await f.call(grant, 'list')).status, 503);
});
