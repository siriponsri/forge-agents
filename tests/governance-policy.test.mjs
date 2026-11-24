import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../app/server/store.mjs';
import { createGovernanceService } from '../app/governance/service.mjs';

const actor = { kind: 'human', id: 'local-user' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-governance-SQLite-'));
  let store = await openStore(dir);
  await store.transaction(s => {
    s.projects.push({ id: 'p1' }, { id: 'p2' });
    s.connections.push(...['p1', 'p2'].map((projectId, n) => ({ id: `c${n + 1}`, projectId, revision: 1, kind: 'mcp', enabled: true, route: 'http', url: `https://fixture.invalid/${n}`, config: {}, discoveryStale: false,
      lastCheck: { capabilities: ['write', 'read'].map(name => ({ name, inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false } })) } })));
  });
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return {
    dir,
    get store() { return store; }, get service() { return createGovernanceService({ store }); },
    async reopen() { await store.close(); store = await openStore(dir); return createGovernanceService({ store }); },
  };
}
const op = (id = 'write-1') => ({ projectId: 'p1', connectionId: 'c1', operationId: id, name: 'write', arguments: { value: 'one exact change' } });
async function configure(f, mode = 'ask', tools = {}) {
  const policy = f.service.policy(op());
  return f.service.configurePolicy({ projectId: 'p1', connectionId: 'c1', operationId: `policy-${policy.revision}-${mode}`, expectedRevision: policy.revision, mode, tools, actor });
}
async function approve(f, input) {
  const a = await f.service.requestTool(input);
  return f.service.decideTool({ projectId: input.projectId, operationId: `decide-${input.operationId}`, approvalId: a.id, expectedRevision: a.revision, decision: 'approved', actor });
}

test('Ask persists exact approval and atomic single consumption across SQLite reopen and competing callers', async t => {
  const f = await fixture(t); await configure(f);
  const input = op();
  assert.equal(await f.service.authorizeTool(input), false);
  const a = await approve(f, input); assert.equal(a.status, 'approved');
  const reopened = await f.reopen();
  const results = await Promise.all(Array.from({ length: 8 }, () => createGovernanceService({ store: f.store }).authorizeTool(input)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(reopened.validateAdmission(input), true);
  await f.reopen(); assert.equal(await f.service.authorizeTool(input), false);
  const record = (await f.service.requestTool(input)); assert.equal(record.status, 'consumed');
  assert.equal(record.admission, 'human');
  assert.equal(f.store.read().receipts.some(r => r.operationId === input.operationId), false);
  assert.equal(f.store.read().events.some(e => e.operationId === input.operationId), false);
  assert.equal(f.store.read().events.filter(e => e.type === 'governance.audit' && e.action === 'tool.consumed').length, 1);
  // The dispatch owner can reserve the same *raw* ID, with no governance collision.
  await f.store.transaction(s => s.events.push({ id: 'native-effect', projectId: input.projectId, operationId: input.operationId, type: 'mcp.call', status: 'unknown' }));
  assert.equal(await f.service.authorizeTool(input), false);
  assert.deepEqual(await f.service.recover(), { invalidated: 0, redispatched: 0 });
});

test('exact values/scopes/tool names and JSON argument identity cannot borrow an approval', async t => {
  const f = await fixture(t); await configure(f); await approve(f, op());
  for (const change of [{ arguments: { value: 'different' } }, { projectId: 'p2', connectionId: 'c2' }, { name: 'read' }]) {
    await assert.rejects(f.service.requestTool({ ...op(), ...change }), { code: 'OPERATION_REUSE' });
    await assert.rejects(f.service.authorizeTool({ ...op(), ...change }), { code: 'OPERATION_REUSE' });
  }
  await assert.rejects(f.service.requestTool({ ...op('undefined'), arguments: { value: undefined } }), { code: 'VALIDATION' });
  await assert.rejects(f.service.requestTool({ ...op('not-finite'), arguments: { value: NaN } }), { code: 'VALIDATION' });
  await assert.rejects(f.service.requestTool({ ...op(), operationId: ' write-1' }), { code: 'VALIDATION' });
  await assert.rejects(f.service.requestTool({ ...op('other-project'), projectId: 'p2' }), { code: 'NOT_FOUND' });
  assert.equal(await f.service.authorizeTool(op()), true);
});

test('Allowed / Ask / Off ceiling, absent policy and explicit denials survive restart', async t => {
  const f = await fixture(t);
  assert.equal(await f.service.authorizeTool(op('default-off')), false);
  await configure(f, 'ask', { write: 'allowed' });
  assert.equal(await f.service.authorizeTool(op('narrow-ceiling')), false);
  const pending = await f.service.requestTool(op('denied'));
  const denial = { projectId: 'p1', operationId: 'decision-deny', approvalId: pending.id, expectedRevision: pending.revision, decision: 'denied', actor };
  assert.equal((await f.service.decideTool(denial)).status, 'denied');
  assert.equal((await f.service.decideTool(denial)).status, 'denied');
  await assert.rejects(f.service.decideTool({ ...denial, decision: 'approved' }), { code: 'OPERATION_REUSE' });
  await f.reopen(); assert.equal(await f.service.authorizeTool(op('denied')), false);
  await configure(f, 'allowed', { write: 'off', read: 'ask' });
  assert.equal(await f.service.authorizeTool(op('off-override')), false);
  assert.equal(await f.service.authorizeTool({ ...op('read-ask'), name: 'read' }), false);
  await configure(f, 'allowed');
  assert.equal(await f.service.authorizeTool(op('allowed')), true);
  assert.equal(await f.service.authorizeTool(op('allowed')), false);
});

test('stale policy revisions, endpoint/schema changes, refresh and disable revoke exact admissions', async t => {
  const f = await fixture(t); const p = await configure(f);
  await assert.rejects(f.service.configurePolicy({ projectId: 'p1', connectionId: 'c1', operationId: 'stale-edit', expectedRevision: 0, mode: 'allowed', actor }), { code: 'REVISION_CONFLICT' });
  await approve(f, op('policy-change')); await configure(f, 'off');
  assert.equal((await f.service.requestTool(op('policy-change'))).status, 'stale');
  assert.equal(await f.service.authorizeTool(op('policy-change')), false);
  await configure(f, 'ask');
  for (const [name, change] of [
    ['endpoint', c => { c.url += '/changed'; }],
    ['schema', c => { c.lastCheck.capabilities[0].inputSchema.required = ['value']; }],
    ['disabled', c => { c.enabled = false; }],
    ['undiscovered', c => { c.discoveryStale = true; }],
    ['revision', c => { c.revision++; }],
    ['disable-reenable', c => { c.enabled = false; c.revision++; c.enabled = true; c.revision++; }],
  ]) {
    const input = op(name); await approve(f, input);
    const before = f.store.read().connections[0];
    await f.store.transaction(s => change(s.connections[0]));
    assert.equal(await f.service.authorizeTool(input), false);
    assert.equal((await f.service.requestTool(input)).status, 'stale');
    await f.store.transaction(s => { s.connections[0] = before; });
    assert.equal(await f.service.authorizeTool(input), false, 'restoring settings must not resurrect stale operation');
  }
  const input = op('consumed-recheck'); await approve(f, input); assert.equal(await f.service.authorizeTool(input), true);
  await f.store.transaction(s => { s.connections[0].enabled = false; });
  assert.equal(f.service.validateAdmission(input), false);
  assert.equal(p.revision, 1);
});

test('only explicit human decisions, optimistic approval revisions, cancellation and new operation after stale', async t => {
  const f = await fixture(t); await configure(f);
  const input = op('race'), a = await f.service.requestTool(input);
  const decide = { projectId: 'p1', approvalId: a.id, expectedRevision: a.revision, actor };
  await assert.rejects(f.service.decideTool({ ...decide, operationId: 'agent-cannot-approve', decision: 'approved', actor: { kind: 'agent', botId: 'b1' } }), { code: 'HUMAN_REQUIRED' });
  await assert.rejects(f.service.decideTool({ ...decide, operationId: 'wrong-project', projectId: 'p2', decision: 'approved' }), { code: 'NOT_FOUND' });
  const results = await Promise.allSettled(['approved', 'denied'].map(decision => f.service.decideTool({ ...decide, operationId: decision, decision })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const controller = new AbortController(); controller.abort();
  assert.equal(await f.service.authorizeTool({ ...input, signal: controller.signal }), false);
  assert.equal((await f.service.requestTool(input)).status, 'approved');
  await f.store.transaction(s => { s.connections[0].url += '/replacement'; });
  assert.deepEqual(await f.service.recover(), { invalidated: 1, redispatched: 0 });
  await configure(f, 'ask');
  await approve(f, op('new-explicit-operation'));
  assert.equal(await f.service.authorizeTool(op('new-explicit-operation')), true);
});

test('explicit metadata restore invalidates unconsumed grants while preserving consumed tombstones', async t => {
  const f = await fixture(t); await configure(f);
  await approve(f, op('old-snapshot-grant')); await approve(f, op('already-consumed'));
  assert.equal(await f.service.authorizeTool(op('already-consumed')), true);
  assert.deepEqual(await f.service.recover({ invalidateUnconsumed: true }), { invalidated: 1, redispatched: 0 });
  assert.equal((await f.service.requestTool(op('old-snapshot-grant'))).reason, 'explicit_restore');
  assert.equal(await f.service.authorizeTool(op('old-snapshot-grant')), false);
  assert.equal(await f.service.authorizeTool(op('already-consumed')), false);
});

test('independent service processes consume the same actual SQLite approval only once', async t => {
  const f = await fixture(t); await configure(f); await approve(f, op('cross-process'));
  const script = `
    import {openStore} from ${JSON.stringify(new URL('../app/server/store.mjs', import.meta.url).href)};
    import {createGovernanceService} from ${JSON.stringify(new URL('../app/governance/service.mjs', import.meta.url).href)};
    const store=await openStore(process.argv[1]);
    try { process.stdout.write(JSON.stringify(await createGovernanceService({store}).authorizeTool(JSON.parse(process.argv[2])))); }
    finally { await store.close(); }
  `;
  const run = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, f.dir, JSON.stringify(op('cross-process'))], { timeout: 10000 });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map(r => JSON.parse(r.stdout)).sort(), [false, true]);
  assert.equal((await f.service.requestTool(op('cross-process'))).status, 'consumed');
});

test('Allowed cannot silently expand onto a changed endpoint, account reference or discovered tool catalog', async t => {
  const f = await fixture(t); await configure(f, 'allowed');
  assert.equal(await f.service.authorizeTool(op('original-target')), true);
  for (const [name, change] of [
    ['endpoint', c => { c.url += '/new-target'; c.revision++; }],
    ['account-reference', c => { c.config.authEnv = 'DIFFERENT_MACHINE_ACCOUNT'; c.revision++; }],
    ['catalog', c => { c.lastCheck.capabilities.push({ name: 'new-tool', inputSchema: { type: 'object' } }); c.revision++; }],
  ]) {
    await f.store.transaction(s => change(s.connections[0]));
    assert.equal(f.service.policy(op()).bindingCurrent, false);
    assert.equal(f.service.policy(op()).effectiveMode, 'off');
    assert.equal(await f.service.authorizeTool(op(`unreviewed-${name}`)), false);
    const current = f.service.policy(op());
    await assert.rejects(f.service.configurePolicy({ projectId: 'p1', connectionId: 'c1', operationId: `stale-target-${name}`, expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision - 1, mode: 'allowed', actor }), { code: 'REVISION_CONFLICT' });
    await f.service.configurePolicy({ projectId: 'p1', connectionId: 'c1', operationId: `review-new-${name}`, expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision, mode: 'allowed', actor });
    assert.equal(await f.service.authorizeTool(op(`reviewed-${name}`)), true);
  }
});
