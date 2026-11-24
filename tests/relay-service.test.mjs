import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createRelayService, signBridgeBody, validateRelayAdmission } from '../app/relay/index.mjs';

// Engineering fixtures: real domain commands + real SQLite; T3/gateway execution INJECTED.
const secret = 'fixture-machine-secret-at-least-32-bytes';
const code = expected => e => { assert.equal(e.code, expected, e.stack); return true; };
async function fixture(t, gateway = 'hermes') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-relay-'));
  let store = await openStore(dir), count = 0, timestamp = Date.now(), starts = 0, stops = 0;
  const cmd = (type, projectId, data) => command(store, { operationId: `fixture-${++count}`, type, projectId, data });
  const project = (await cmd('project.create', undefined, { name: 'Disposable relay fixture', workspace: dir })).entity;
  const other = (await cmd('project.create', undefined, { name: 'Other fixture project', workspace: path.join(dir, 'other') })).entity;
  const plan = (await cmd('plan.create', project.id, { name: 'Reviewed fixture', approved: true })).entity;
  const task = (await cmd('task.create', project.id, { title: 'Bounded fixture task', description: 'No live provider action', planId: plan.id })).entity;
  const binding = { projectId: project.id, bindingId: 'fixture-binding', expectedRevision: 0, gateway, gatewayId: 'fixture-native-gateway', accountId: '900', platform: 'telegram', chatId: '100', threadId: null, ownerId: '200', secretRef: 'vault:relay/fixture', enabled: true };
  const t3 = { relayContextVersion: 1, async startRun(i) {
    starts++;
    return store.transaction(s => {
      const context = validateRelayAdmission(s, i);
      const run = { id: `fixture-run-${starts}`, revision: 1, projectId: i.projectId, taskId: i.taskId, operationId: i.operationId,
        relayContext: context, attemptId: `fixture-attempt-${starts}`, status: 'running' };
      s.runs.push(run); return run;
    });
  }, async stop(id) { stops++; return { id, status: 'requested' }; } };
  const make = () => createRelayService({ store, t3, resolveSecret: async ref => { assert.equal(ref, binding.secretRef); return secret; }, clock: () => new Date(timestamp).toISOString() });
  let service = make(); await service.configure(binding);
  function envelope(kind, extra = {}, override = {}) {
    const value = { version: 1, kind, bindingId: binding.bindingId, gatewayId: binding.gatewayId, accountId: binding.accountId, issuedAt: timestamp, nonce: `nonce-${++count}`, ...extra, ...override };
    const body = JSON.stringify(value); return { body, signature: signBridgeBody(body, secret) };
  }
  const native = (text, overrides = {}) => ({ platform: binding.platform, chatId: binding.chatId, threadId: binding.threadId, ownerId: binding.ownerId, messageId: `message-${++count}`, text, ...overrides });
  const send = (text, overrides = {}) => service.bridge(envelope('event', { native: native(text, overrides) }));
  const item = id => service.state({ projectId: project.id }).inbox.find(x => x.id === id);
  const work = async () => send('FORGE WORK Review this harmless fixture\nKeep all supervision');
  const link = async id => service.linkTask({ projectId: project.id, inboxId: id, taskId: task.id, expectedRevision: item(id).revision });
  async function approved() { const result = await work(); const linked = await link(result.inboxId); await send(`FORGE APPROVE ${linked.id} ${linked.challenge}`); return linked.id; }
  t.after(async () => { service.close(); await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { get store() { return store; }, get service() { return service; }, get starts() { return starts; }, get stops() { return stops; },
    project, other, plan, task, binding, t3, envelope, native, send, item, work, link, approved, cmd,
    tick(ms) { timestamp += ms; }, async restart() { service.close(); await store.close(); store = await openStore(dir); service = make(); await service.recover(); } };
}

test('both gateways enter durable scoped Inbox without starting; authentication and no caller actor/approval', async t => {
  for (const gateway of ['hermes', 'openclaw']) await t.test(gateway, async t => {
    const f = await fixture(t, gateway), received = await f.work();
    assert.equal(received.status, 'inbox'); assert.equal(f.starts, 0);
    await f.restart(); assert.match(f.item(received.inboxId).text, /harmless/);
    assert.equal(f.service.state({ projectId: f.other.id }).inbox.length, 0);
    const req = f.envelope('event', { native: { ...f.native('FORGE WORK forged'), approved: true, actor: { kind: 'human' } } });
    await assert.rejects(f.service.bridge(req), code('RELAY_SCHEMA'));
    const bad = f.envelope('event', { native: f.native('FORGE WORK forged') }); bad.signature = '0'.repeat(64);
    await assert.rejects(f.service.bridge(bad), code('RELAY_AUTH'));
  });
});

test('forged Owner, wrong account/gateway/channel/thread and cross-project link fail closed', async t => {
  const f = await fixture(t);
  for (const change of [{ ownerId: 'attacker' }, { chatId: 'other' }, { threadId: 'other' }, { platform: 'webhook' }]) {
    await assert.rejects(f.send('FORGE WORK forged', change), code('RELAY_OWNER_CHANNEL'));
  }
  for (const change of [{ gatewayId: 'other' }, { accountId: 'other' }]) await assert.rejects(f.service.bridge(f.envelope('event', { native: f.native('FORGE WORK forged') }, change)), code('RELAY_AUTH'));
  const id = (await f.work()).inboxId;
  await assert.rejects(f.service.linkTask({ projectId: f.other.id, inboxId: id, taskId: f.task.id, expectedRevision: 1 }), code('RELAY_SCOPE'));
  assert.equal(f.starts, 0);
});

test('HMAC covers raw bytes, stale timestamps and durable nonce replay are rejected', async t => {
  const f = await fixture(t), req = f.envelope('event', { native: f.native('FORGE WORK authentic') });
  await assert.rejects(f.service.bridge({ ...req, body: `${req.body} ` }), code('RELAY_AUTH'));
  await f.service.bridge(req); await f.restart();
  await assert.rejects(f.service.bridge(req), code('RELAY_REPLAY'));
  f.tick(301000); await assert.rejects(f.service.bridge(req), code('RELAY_STALE'));
});

test('stable native message ID deduplicates a retry with fresh MAC nonce; mutation is rejected', async t => {
  const f = await fixture(t), n = f.native('FORGE WORK duplicate');
  const one = await f.service.bridge(f.envelope('event', { native: n }));
  await f.restart();
  const two = await f.service.bridge(f.envelope('event', { native: n }));
  assert.equal(two.inboxId, one.inboxId); assert.equal(two.duplicate, true);
  await assert.rejects(f.service.bridge(f.envelope('event', { native: { ...n, text: 'FORGE WORK changed' } })), code('RELAY_EVENT_REUSE'));
  assert.equal(f.service.state({ projectId: f.project.id }).inbox.length, 1);
});

test('same-channel approval binds reviewed task and is not auto-started or self-approved', async t => {
  const f = await fixture(t), id = (await f.work()).inboxId;
  await assert.rejects(f.service.dispatch({ projectId: f.project.id, inboxId: id }), code('RELAY_START_DENIED'));
  const linked = await f.link(id);
  await assert.rejects(f.send(`FORGE APPROVE ${id} ${linked.challenge}`, { ownerId: 'bot' }), code('RELAY_OWNER_CHANNEL'));
  await assert.rejects(f.send(`FORGE APPROVE ${id} wrong`), code('RELAY_APPROVAL_DENIED'));
  const approval = f.native(`FORGE APPROVE ${id} ${linked.challenge}`);
  await f.service.bridge(f.envelope('event', { native: approval })); assert.equal(f.starts, 0);
  await f.service.bridge(f.envelope('event', { native: approval }));
  await Promise.all([f.service.dispatch({ projectId: f.project.id, inboxId: id }), f.service.dispatch({ projectId: f.project.id, inboxId: id })]);
  assert.equal(f.starts, 1); assert.equal(f.item(id).status, 'running');
  const run = f.store.read().runs[0]; assert.equal(run.relayContext.approvalEventId, f.item(id).approvalEventId);
  await assert.rejects(f.send(`FORGE APPROVE ${id} ${linked.challenge}`), code('RELAY_APPROVAL_DENIED'));
});

test('deny and expiry consume no start authority; plan/task/profile edits invalidate approval', async t => {
  const f = await fixture(t), id = (await f.work()).inboxId, linked = await f.link(id);
  await f.send(`FORGE DENY ${id}`);
  await assert.rejects(f.send(`FORGE APPROVE ${id} ${linked.challenge}`), code('RELAY_APPROVAL_DENIED'));
  const id2 = (await f.work()).inboxId, linked2 = await f.link(id2); f.tick(16 * 60 * 1000);
  await assert.rejects(f.send(`FORGE APPROVE ${id2} ${linked2.challenge}`), code('RELAY_APPROVAL_DENIED'));
  const id3 = (await f.work()).inboxId, linked3 = await f.link(id3);
  await f.store.transaction(s => { s.tasks.find(x => x.id === f.task.id).description = 'Changed instructions'; });
  await assert.rejects(f.send(`FORGE APPROVE ${id3} ${linked3.challenge}`), code('RELAY_APPROVAL_STALE'));
  assert.equal(f.starts, 0);
});

test('missing T3 shim fails explicitly before reservation; validator rejects forged and omitted contexts', async t => {
  const f = await fixture(t), id = await f.approved(); delete f.t3.relayContextVersion;
  await assert.rejects(f.service.dispatch({ projectId: f.project.id, inboxId: id }), code('RELAY_ADMISSION_SHIM_MISSING'));
  assert.equal(f.item(id).reservation, undefined); assert.equal(f.starts, 0);
  assert.throws(() => validateRelayAdmission(f.store.read(), { projectId: f.project.id, taskId: f.task.id, operationId: 'forged', relayContext: { inboxId: id } }), code('RELAY_ADMISSION_DENIED'));
  f.t3.relayContextVersion = 1;
  f.t3.startRun = async i => {
    assert.throws(() => validateRelayAdmission(f.store.read(), { ...i, relayContext: undefined }), code('RELAY_CONTEXT_REQUIRED'));
    assert.throws(() => validateRelayAdmission(f.store.read(), { ...i, relayContext: { ...i.relayContext, taskDigest: 'fake' } }), code('RELAY_APPROVAL_STALE'));
    throw new Error('fixture lost response');
  };
  await f.service.dispatch({ projectId: f.project.id, inboxId: id }); assert.equal(f.item(id).status, 'unknown');
});

test('generic task start with a fresh operation ID cannot bypass originating-channel approval or denial', async t => {
  const f = await fixture(t), id = (await f.work()).inboxId; await f.link(id);
  const direct = { operationId: 'generic-bypass', projectId: f.project.id, taskId: f.task.id };
  assert.throws(() => validateRelayAdmission(f.store.read(), direct), code('RELAY_TASK_CHANNEL_REQUIRED'));
  await f.send(`FORGE DENY ${id}`);
  assert.throws(() => validateRelayAdmission(f.store.read(), direct), code('RELAY_TASK_CHANNEL_REQUIRED'));
  const unrelated = (await f.cmd('task.create', f.project.id, { title: 'Unrelated normal task', planId: f.plan.id })).entity;
  assert.equal(validateRelayAdmission(f.store.read(), { ...direct, taskId: unrelated.id }), null);
});

test('response loss and restart retain a single reservation and reconcile exact run without redispatch', async t => {
  const f = await fixture(t), id = await f.approved(), start = f.t3.startRun;
  f.t3.startRun = async i => { await start(i); throw new Error('fixture lost response with credential-not-logged'); };
  await f.service.dispatch({ projectId: f.project.id, inboxId: id }); assert.equal(f.item(id).status, 'unknown');
  await f.restart(); await f.service.dispatch({ projectId: f.project.id, inboxId: id }); assert.equal(f.starts, 1);
  await f.service.reconcile({ projectId: f.project.id, inboxId: id }); assert.equal(f.item(id).status, 'running');
  assert.doesNotMatch(JSON.stringify(f.service.state({ projectId: f.project.id })), /credential-not-logged|fixture-machine-secret/);
});

test('crash during dispatch and no observed run remain unknown across restart; no redispatch', async t => {
  const f = await fixture(t), id = await f.approved(); let release, entered;
  const gate = new Promise(resolve => { entered = resolve; });
  f.t3.startRun = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = f.service.dispatch({ projectId: f.project.id, inboxId: id }); await gate;
  await f.service.recover(); assert.equal(f.item(id).status, 'unknown');
  release(); await pending; await f.restart();
  await f.service.dispatch({ projectId: f.project.id, inboxId: id });
  await assert.rejects(f.service.reconcile({ projectId: f.project.id, inboxId: id }), code('RELAY_RUN_NOT_OBSERVED'));
});

test('Stop before approval prevents start, and Stop during uncertain start is retained then cancels mapped run once', async t => {
  const f = await fixture(t), one = (await f.work()).inboxId;
  await f.send(`FORGE STOP ${one}`); assert.equal(f.item(one).status, 'stopped');
  await assert.rejects(f.service.dispatch({ projectId: f.project.id, inboxId: one }), code('RELAY_START_DENIED'));
  const id = await f.approved(), start = f.t3.startRun; let release, entered;
  const gate = new Promise(resolve => { entered = resolve; });
  f.t3.startRun = async i => { await start(i); entered(); await new Promise(resolve => { release = resolve; }); };
  const pending = f.service.dispatch({ projectId: f.project.id, inboxId: id }); await gate;
  await f.send(`FORGE STOP ${id}`); assert.equal(f.item(id).stopRequested, true);
  release(); await pending; assert.equal(f.stops, 1);
  await f.send(`FORGE STOP ${id}`); assert.equal(f.stops, 1);
  assert.equal(f.item(id).cancel.status, 'requested'); assert.notEqual(f.item(id).status, 'cancelled');
});

test('outbox durable claim, authenticated receipts, unknown on restart, no silent redelivery', async t => {
  const f = await fixture(t); await f.work();
  const { delivery } = await f.service.bridge(f.envelope('poll'));
  assert.ok(delivery.lease); await f.restart();
  assert.equal(f.service.state({ projectId: f.project.id }).outbox[0].status, 'unknown');
  assert.equal((await f.service.bridge(f.envelope('poll'))).delivery, null);
  const receipt = { outboxId: delivery.id, lease: delivery.lease, status: 'delivered', remoteMessageId: 'fixture-native-receipt' };
  await assert.rejects(f.service.bridge(f.envelope('receipt', { receipt: { ...receipt, lease: 'forged' } })), code('RELAY_DELIVERY_SCOPE'));
  await f.service.bridge(f.envelope('receipt', { receipt }));
  await f.service.bridge(f.envelope('receipt', { receipt }));
  await assert.rejects(f.service.bridge(f.envelope('receipt', { receipt: { ...receipt, remoteMessageId: 'changed' } })), code('RELAY_RECEIPT_REUSE'));
  assert.equal(f.service.state({ projectId: f.project.id }).outbox[0].status, 'delivered');
});

test('reports correlate project/task/run/attempt and final requires observed terminal state', async t => {
  const f = await fixture(t), id = await f.approved(); await f.service.dispatch({ projectId: f.project.id, inboxId: id });
  const item = f.item(id), input = { projectId: f.project.id, inboxId: id, runId: item.runId, attemptId: item.attemptId, eventId: 'fixture-progress', kind: 'progress', content: 'Observed fixture progress\nNo live provider' };
  const first = await f.service.report(input), again = await f.service.report(input); assert.equal(first.id, again.id);
  await assert.rejects(f.service.report({ ...input, content: 'changed' }), code('RELAY_REPORT_REUSE'));
  await assert.rejects(f.service.report({ ...input, attemptId: 'foreign' }), code('RELAY_RUN_SCOPE'));
  await assert.rejects(f.service.report({ ...input, projectId: f.other.id }), code('RELAY_SCOPE'));
  await assert.rejects(f.service.report({ ...input, eventId: 'final', kind: 'final' }), code('RELAY_RESULT_NOT_FINAL'));
  await f.store.transaction(s => { s.runs[0].status = 'completed'; });
  const final = await f.service.report({ ...input, eventId: 'final', kind: 'final' }); assert.equal(final.correlation.status, 'completed');
  await f.store.transaction(s => { s.runs[0].status = 'rolled_back'; });
  const rolledBack = await f.service.report({ ...input, eventId: 'rollback', kind: 'final' }); assert.equal(rolledBack.correlation.status, 'rolled_back');
});

test('bindings cannot be shared across projects, secrets are refs, disabled bindings revoke start', async t => {
  const f = await fixture(t), id = await f.approved();
  await assert.rejects(f.service.configure({ ...f.binding, bindingId: 'foreign', projectId: f.other.id }), code('RELAY_ROUTE_BOUND'));
  await assert.rejects(f.service.configure({ ...f.binding, bindingId: 'secret', secretRef: secret }), code('RELAY_SECRET_REF'));
  await f.store.transaction(s => { s.relay.inbox.find(x => x.id === id).status = 'completed'; });
  await assert.rejects(f.service.configure({ ...f.binding, expectedRevision: 1, chatId: 'new-recipient' }), code('RELAY_BINDING_BUSY'));
  await f.service.configure({ ...f.binding, expectedRevision: 1, enabled: false });
  await assert.rejects(f.service.dispatch({ projectId: f.project.id, inboxId: id }), code('RELAY_START_DENIED'));
  const ready = await f.service.readiness({ projectId: f.project.id });
  assert.equal(ready.bindings[0].secretAvailable, true); assert.equal(ready.publicProvisioning, false);
  assert.ok(ready.bindings[0].actions.includes('enable_after_review'));
  assert.doesNotMatch(JSON.stringify(ready), /fixture-machine-secret|vault:relay/);
});

test('approval cannot move to another configured native channel and reviewed profile cannot change before dispatch', async t => {
  const f = await fixture(t), id = (await f.work()).inboxId, linked = await f.link(id);
  const otherBinding = { ...f.binding, bindingId: 'second-channel', chatId: 'other-chat' };
  await f.service.configure(otherBinding);
  await assert.rejects(f.service.bridge(f.envelope('event', { native: f.native(`FORGE APPROVE ${id} ${linked.challenge}`, { chatId: otherBinding.chatId }) }, { bindingId: otherBinding.bindingId })), code('RELAY_OWNER_CHANNEL'));
  await f.send(`FORGE APPROVE ${id} ${linked.challenge}`);
  await f.store.transaction(s => { s.projects.find(x => x.id === f.project.id).profile.provider = { instanceId: 'changed-provider' }; });
  await assert.rejects(f.service.dispatch({ projectId: f.project.id, inboxId: id }), code('RELAY_APPROVAL_STALE'));
  assert.equal(f.starts, 0);
});

test('late delivery receipt can settle expired unknown lease without sending the message twice', async t => {
  const f = await fixture(t); await f.work();
  const { delivery } = await f.service.bridge(f.envelope('poll')); f.tick(61000);
  assert.equal((await f.service.bridge(f.envelope('poll'))).delivery, null);
  assert.equal(f.service.state({ projectId: f.project.id }).outbox[0].status, 'unknown');
  await f.service.bridge(f.envelope('receipt', { receipt: { outboxId: delivery.id, lease: delivery.lease, status: 'delivered', remoteMessageId: 'late-fixture-id' } }));
  assert.equal(f.service.state({ projectId: f.project.id }).outbox[0].status, 'delivered');
});
