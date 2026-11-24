import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopService } from '../app/desktop/index.mjs';
import { openStore } from '../app/server/store.mjs';
import { wait, fault } from '../app/desktop/common.mjs';
import { createGuestAgent } from '../app/desktop/guest-server.mjs';

async function harness(t, factories = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'forge-desktop-test-'));
  const store = await openStore(dataDir);
  await store.transaction(s => { s.projects.push({ id: 'p1' }, { id: 'p2' }); });
  const service = createDesktopService({ dataDir, store, driverFactories: factories });
  t.after(async () => { await service.shutdown(); await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, service };
}
const fake = () => ({
  resourceKey: 'test-physical-desktop',
  async health() { return { ready: true, capabilities: ['wait','inspect','type','screenshot'] }; },
  async listWindows() { return [{ id: 'owned-fixture' }]; },
  async acquire(windowId) { if (windowId !== 'owned-fixture') throw fault('TARGET_IDENTITY', 'Select the fixture'); return { windowId }; },
  async action(name, args, { signal, dispatch }) { if (name === 'type') { dispatch(); await wait(30000, signal); } return { text: 'transient-only-sensitive-inspection' }; },
  async stop() {}, async shutdown() {},
});
const setup = (service, projectId = 'p1', targetId = 't1') => service.setup({ projectId, targetId, name: 'Test fixture', kind: 'windows' });
const acquire = (service, targetId = 't1') => service.acquire({ projectId: 'p1', targetId, controllerId: 'bot1', windowId: 'owned-fixture', attemptId: 'attempt1' });
const action = (service, lease, operationId, name, args = {}) => service.action({ ...lease, projectId: 'p1', operationId, name, arguments: args });

test('target identity, project, physical desktop and attempt/lease isolation', async t => {
  const { service } = await harness(t, { windows: fake });
  await setup(service); await setup(service, 'p1', 't2');
  await assert.rejects(service.health({ projectId: 'p2', targetId: 't1' }), { code: 'NOT_FOUND' });
  await assert.rejects(service.acquire({ projectId: 'p1', targetId: 't1', controllerId: 'bot1', attemptId: 'attempt1', windowId: 'owner-other' }), { code: 'TARGET_IDENTITY' });
  const lease = await acquire(service);
  await assert.rejects(acquire(service), { code: 'TARGET_BUSY' });
  await assert.rejects(acquire(service, 't2'), { code: 'TARGET_BUSY' });
  await assert.rejects(action(service, { ...lease, attemptId: 'another-attempt' }, 'bad', 'inspect'), { code: 'LEASE_REQUIRED' });
  await assert.rejects(action(service, { ...lease, leaseId: 'stale' }, 'bad', 'inspect'), { code: 'LEASE_REQUIRED' });
  await assert.rejects(action(service, lease, 'bad', 'shell', { command: 'echo forbidden' }), { code: 'CAPABILITY' });
  await service.release({ ...lease, projectId: 'p1' });
  const second = await acquire(service, 't2'); assert.notEqual(second.leaseId, lease.leaseId);
});

test('Stop interrupts in-flight wait, blocks queued and stale input; takeover requires new lease', async t => {
  const { service, store } = await harness(t, { windows: fake }); await setup(service);
  const lease = await acquire(service);
  const pending = action(service, lease, 'waiting', 'wait', { ms: 30000 });
  await wait(30);
  await assert.rejects(action(service, lease, 'queued', 'inspect'), { code: 'TARGET_BUSY' });
  const start = Date.now(); const stop = await service.stop({ ...lease, projectId: 'p1' });
  assert.ok(Date.now() - start < 1000); assert.deepEqual(stop.interrupted, ['waiting']);
  assert.equal((await pending).status, 'cancelled');
  await assert.rejects(action(service, lease, 'after', 'inspect'), { code: 'LEASE_REQUIRED' });
  const second = await acquire(service);
  const typing = action(service, second, 'typing', 'type', { text: 'sensitive-not-logged' }); await wait(30);
  assert.equal((await service.takeover({ projectId: 'p1', targetId: 't1' })).controlState, 'human_control');
  assert.equal((await typing).status, 'unknown');
  assert.equal(store.read().desktopTargets[0].controllerId, null);
  assert.ok(!JSON.stringify(store.read()).includes('sensitive-not-logged'));
});

test('completed and uncertain receipts prevent replay and operation reuse across attempts', async t => {
  const { service, store } = await harness(t, { windows: fake }); await setup(service); const lease = await acquire(service);
  const first = await action(service, lease, 'read', 'inspect'); assert.equal(first.status, 'completed');
  assert.equal((await action(service, lease, 'read', 'inspect')).result.text, first.result.text);
  assert.ok(!JSON.stringify(store.read()).includes('transient-only-sensitive-inspection'));
  await assert.rejects(action(service, lease, 'read', 'wait', { ms: 1 }), { code: 'OPERATION_REUSE' });
  await service.release({ ...lease, projectId: 'p1' }); const next = await acquire(service);
  await assert.rejects(action(service, next, 'read', 'inspect'), { code: 'OPERATION_REUSE' });
  await store.transaction(s => s.receipts.push({ operationId: 'crashed', type: 'desktop.action', fingerprint: 'other', result: { status: 'running' } }));
  await assert.rejects(action(service, next, 'crashed', 'inspect'), { code: 'OPERATION_REUSE' });
});

test('expiry cancels active input and never reacquires automatically', async t => {
  const { service } = await harness(t, { windows: fake }); await setup(service);
  const lease = await service.acquire({ projectId: 'p1', targetId: 't1', controllerId: 'bot1', windowId: 'owned-fixture', attemptId: 'attempt1', ttlMs: 1000 });
  const pending = action(service, lease, 'expire', 'wait', { ms: 30000 });
  assert.equal((await pending).status, 'cancelled');
  await assert.rejects(action(service, lease, 'expired', 'inspect'), { code: 'LEASE_REQUIRED' });
});

test('unverified partial effect remains unknown and reconnect cannot replay an old operation', async t => {
  const partial = () => ({ ...fake(), async action(name, args, { dispatch }) { dispatch(); return { typed: true, verified: false }; } });
  const { service, store, dataDir } = await harness(t, { windows: partial }); await setup(service); const lease = await acquire(service);
  const result = await action(service, lease, 'partial', 'type', { text: 'bounded fixture' }); assert.equal(result.status, 'unknown');
  await service.shutdown();
  const recovered = createDesktopService({ dataDir, store, driverFactories: { windows: fake } }); t.after(() => recovered.shutdown());
  await assert.rejects(action(recovered, lease, 'late', 'inspect'), { code: 'LEASE_REQUIRED' });
  const next = await acquire(recovered);
  await assert.rejects(action(recovered, next, 'partial', 'type', { text: 'bounded fixture' }), { code: 'OPERATION_REUSE' });
  await recovered.shutdown();
});

test('unconfirmed teardown retains physical ownership until a successful explicit takeover retry', async t => {
  let unavailable = true;
  const uncertain = () => ({ ...fake(), async stop() { if (unavailable) throw fault('DISCONNECTED', 'Fixture disconnect'); } });
  const { service } = await harness(t, { windows: uncertain }); await setup(service); await setup(service, 'p1', 't2'); const lease = await acquire(service);
  assert.equal((await service.stop({ ...lease, projectId: 'p1' })).controlState, 'reconciliation_required');
  await assert.rejects(acquire(service, 't2'), { code: 'TARGET_BUSY' });
  unavailable = false;
  assert.equal((await service.takeover({ projectId: 'p1', targetId: 't1' })).controlState, 'human_control');
  await acquire(service, 't2');
});

test('machine settings exclude token values and guest endpoints reject unsafe authentication transport', async t => {
  const { service, dataDir, store } = await harness(t);
  await assert.rejects(service.setup({ projectId: 'p1', name: 'Guest', kind: 'guest', config: { endpoint: 'http://192.0.2.1:3000', tokenEnv: 'TEST_GUEST_TOKEN', agentId: 'guest1', remoteTargetId: 'native' } }), { code: 'VALIDATION' });
  const target = await service.setup({ projectId: 'p1', name: 'Guest', kind: 'guest', config: { endpoint: 'http://127.0.0.1:65530', tokenEnv: 'TEST_GUEST_TOKEN', token: 'secret-never-save', agentId: 'guest1', remoteTargetId: 'native' } });
  const config = await readFile(path.join(dataDir, 'desktop', 'config', `${target.id}.json`), 'utf8');
  assert.ok(!config.includes('secret-never-save')); assert.ok(!JSON.stringify(store.read()).includes('127.0.0.1'));
  const health = await service.health({ projectId: 'p1', targetId: target.id }); assert.equal(health.ready, false); assert.equal(health.blocker.code, 'AUTH_REQUIRED');
});

test('authenticated remote protocol pins agent/target and revokes actual remote in-flight lease (local contract fixture, not VM evidence)', async t => {
  const remote = await harness(t, { windows: fake }); await setup(remote.service);
  const token = 'test-only-remote-token-not-a-live-secret-0123456789';
  process.env.FORGE_DESKTOP_TEST_TOKEN = token; t.after(() => { delete process.env.FORGE_DESKTOP_TEST_TOKEN; });
  const agent = await createGuestAgent({ service: remote.service, projectId: 'p1', targetId: 't1', agentId: 'fixture-agent', token });
  t.after(() => agent.close());
  const denied = await fetch(`${agent.endpoint}/v1/health`, { method: 'POST', body: '{}' }); assert.equal(denied.status, 401);
  const wrong = await fetch(`${agent.endpoint}/v1/health`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ agentId: 'wrong', targetId: 't1' }) }); assert.equal(wrong.status, 409);
  const local = await harness(t);
  await local.service.setup({ projectId: 'p1', targetId: 'g1', name: 'Local protocol fixture', kind: 'guest', config: { endpoint: agent.endpoint, tokenEnv: 'FORGE_DESKTOP_TEST_TOKEN', agentId: 'fixture-agent', remoteTargetId: 't1' } });
  const health = await local.service.health({ projectId: 'p1', targetId: 'g1' }); assert.equal(health.ready, true); assert.equal(health.identity.kind, 'guest');
  const lease = await acquire(local.service, 'g1');
  const pending = action(local.service, lease, 'remote-type', 'type', { text: 'bounded fixture' }); await wait(50);
  const stop = await local.service.takeover({ projectId: 'p1', targetId: 'g1' });
  assert.equal(stop.controlState, 'human_control'); assert.equal((await pending).status, 'unknown');
  assert.equal(remote.store.read().desktopTargets[0].controllerId, null);
  assert.equal(remote.store.read().receipts.find(r => r.operationId === 'remote-type').result.status, 'unknown');
});
