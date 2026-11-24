import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createGovernanceService, validateProjectContext } from '../app/governance/service.mjs';
import { recordsFor } from '../app/storage/bundle.mjs';
import { createStorageService } from '../app/storage/service.mjs';
import { createArtifactService } from '../app/server/artifacts.mjs';

const actor = { kind: 'human', id: 'local-owner' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-governance-context-'));
  let store = await openStore(dir), serial = 0;
  const run = (type, projectId, data) => command(store, { operationId: `fixture-${++serial}`, type, ...(projectId ? { projectId } : {}), data });
  const p1 = (await run('project.create', null, { name: 'Disposable context fixture', workspace: path.join(dir, 'workspace') })).entity;
  const p2 = (await run('project.create', null, { name: 'Disposable isolation fixture', workspace: path.join(dir, 'other') })).entity;
  const plan = (await run('plan.create', p1.id, { name: 'Reviewed fixture goal', approved: true })).entity;
  const otherGoal = (await run('plan.create', p2.id, { name: 'Other project' })).entity;
  const bots = await Promise.all(['Manager', 'Worker', 'Helper'].map(name => run('bot.create', p1.id, { name, role: name, kind: 'resident' }).then(x => x.entity)));
  const foreignBot = (await run('bot.create', p2.id, { name: 'Foreign bot' })).entity;
  const tasks = await Promise.all(['Parent', 'Child', 'Grandchild'].map(title => run('task.create', p1.id, { title, planId: plan.id, botId: bots[1].id, status: 'ready' }).then(x => x.entity)));
  const foreignTask = (await run('task.create', p2.id, { title: 'Foreign task', planId: otherGoal.id, botId: foreignBot.id })).entity;
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return {
    get store() { return store; }, get service() { return createGovernanceService({ store }); },
    dir, p1, p2, plan, otherGoal, bots, foreignBot, tasks, foreignTask,
    async reopen() { await store.close(); store = await openStore(dir); },
  };
}
function botInput(f, index, managerBotId, operationId) {
  const b = f.store.read().bots.find(x => x.id === f.bots[index].id);
  return { operationId, projectId: f.p1.id, botId: b.id, expectedRevision: b.revision, managerBotId, responsibilities: ['Review fixture results'], actor };
}
function taskInput(f, index, parentTaskId, operationId) {
  const task = f.store.read().tasks.find(x => x.id === f.tasks[index].id);
  return { operationId, projectId: f.p1.id, taskId: task.id, expectedRevision: task.revision, parentTaskId, goalId: f.plan.id, nextAction: { kind: 'run', summary: 'Execute the reviewed bounded task' }, actor };
}

test('real bot/task/plan records retain reporting responsibilities and durable executable next action after restart', async t => {
  const f = await fixture(t), input = botInput(f, 1, f.bots[0].id, 'worker-manager');
  const saved = await f.service.setBotContext(input);
  assert.deepEqual(await f.service.setBotContext(input), saved);
  await f.service.setTaskContext(taskInput(f, 1, f.tasks[0].id, 'child-context'));
  await f.reopen();
  const org = f.service.organization({ projectId: f.p1.id });
  assert.equal(org.bots.length, 3); assert.equal(org.bots.find(b => b.id === f.bots[1].id).managerBotId, f.bots[0].id);
  const ctx = f.service.taskContext({ projectId: f.p1.id, taskId: f.tasks[1].id });
  assert.deepEqual(ctx.ancestors.map(t => t.id), [f.tasks[0].id]);
  assert.equal(ctx.goal.kind, 'plan'); assert.equal(ctx.goal.id, f.plan.id);
  assert.equal(ctx.reportingChain[0].id, f.bots[0].id);
  assert.deepEqual(ctx.executable, { owner: 't3', method: 'POST', path: '/api/runs/start', input: { projectId: f.p1.id, taskId: f.tasks[1].id }, requiresNewOperationId: true });
  assert.equal(f.store.read().runs.length, 0, 'context commands never create an execution');
  assert.equal(f.store.read().tasks.length, 4, 'context commands never create a duplicate task');
  // Existing portable project records already carry context; no authority or connection is exported.
  const portable = recordsFor(f.store.read(), f.p1.id);
  assert.equal(portable.bots.find(b => b.id === saved.id).governance.managerBotId, f.bots[0].id);
  assert.equal(portable.tasks.find(t => t.id === f.tasks[1].id).governance.goalId, f.plan.id);
  assert.equal(portable.events, undefined); assert.equal(portable.connections, undefined);
});

test('org cycles, missing and cross-project managers are rejected with revision conflicts', async t => {
  const f = await fixture(t);
  await f.service.setBotContext(botInput(f, 1, f.bots[0].id, 'worker-manager'));
  await f.service.setBotContext(botInput(f, 2, f.bots[1].id, 'helper-manager'));
  await assert.rejects(f.service.setBotContext(botInput(f, 0, f.bots[2].id, 'cycle')), { code: 'CYCLE' });
  await assert.rejects(f.service.setBotContext(botInput(f, 0, f.bots[0].id, 'self-cycle')), { code: 'CYCLE' });
  for (const [name, id] of [['foreign', f.foreignBot.id], ['missing', 'missing-bot']]) await assert.rejects(f.service.setBotContext(botInput(f, 0, id, name)), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.setBotContext({ ...botInput(f, 1, null, 'stale'), expectedRevision: 1 }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.service.setBotContext({ ...botInput(f, 1, null, 'actor'), actor: { kind: 'agent' } }), { code: 'HUMAN_REQUIRED' });
});

test('parent cycles and invalid task/goal references cannot broaden plan scope', async t => {
  const f = await fixture(t);
  await f.service.setTaskContext(taskInput(f, 1, f.tasks[0].id, 'child'));
  await f.service.setTaskContext(taskInput(f, 2, f.tasks[1].id, 'grandchild'));
  await assert.rejects(f.service.setTaskContext(taskInput(f, 0, f.tasks[2].id, 'cycle')), { code: 'CYCLE' });
  for (const [name, change] of [
    ['foreign-task', { parentTaskId: f.foreignTask.id }], ['missing-task', { parentTaskId: 'missing' }],
    ['foreign-goal', { goalId: f.otherGoal.id }], ['missing-goal', { goalId: 'missing' }],
    ['missing-bot', { actor: { kind: 'agent', botId: 'missing', runId: 'missing', attemptId: 'missing' } }],
  ]) await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 0, null, name), ...change }), { code: 'NOT_FOUND' });
  await f.store.transaction(s => s.plans.push({ id: 'other-local-plan', projectId: f.p1.id, revision: 1 }));
  await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 0, null, 'broaden-goal'), goalId: 'other-local-plan' }), { code: 'GOAL_SCOPE' });
  await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 0, null, 'wrong-run-action'), nextAction: { kind: 'run', summary: 'Must use same T3 owner', runId: 'missing' } }), { code: 'NOT_FOUND' });
});

test('agent progress is bound to actual task bot/run/attempt and never competes for task checkout', async t => {
  const f = await fixture(t), task = f.tasks[1], bot = f.bots[1];
  await f.store.transaction(s => {
    s.runs.push({ id: 'run-1', projectId: f.p1.id, taskId: task.id, botId: bot.id, attemptId: 'attempt-1', status: 'running' });
    s.tasks.find(t => t.id === task.id).runIds.push('run-1');
  });
  const agent = { kind: 'agent', botId: bot.id, runId: 'run-1', attemptId: 'attempt-1' };
  const saved = await f.service.setTaskContext({ ...taskInput(f, 1, f.tasks[0].id, 'agent-progress'), actor: agent });
  assert.equal(saved.governance.updatedBy.runId, 'run-1');
  let ctx = f.service.taskContext({ projectId: f.p1.id, taskId: task.id });
  assert.equal(ctx.executable, null); assert.ok(ctx.blockers.includes('existing_execution_requires_reconciliation'));
  for (const [name, change] of [['wrong-bot', { botId: f.bots[0].id }], ['wrong-attempt', { attemptId: 'other-attempt' }]]) {
    await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 1, null, name), actor: { ...agent, ...change } }), { code: 'TASK_OWNER' });
  }
  await f.store.transaction(s => s.runs.push({ id: 'run-2', projectId: f.p1.id, taskId: task.id, botId: bot.id, attemptId: 'attempt-2', status: 'unknown' }));
  await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 1, null, 'competing-owner'), actor: agent }), { code: 'TASK_OWNER' });
  await f.store.transaction(s => { s.runs.forEach(r => { r.status = 'completed'; }); s.tasks.find(t => t.id === task.id).runIds.push('run-2'); });
  await assert.rejects(f.service.setTaskContext({ ...taskInput(f, 1, null, 'stale-owner'), actor: agent }), { code: 'TASK_OWNER' });
  await f.service.setTaskContext({ ...taskInput(f, 1, null, 'latest-owner'), actor: { ...agent, runId: 'run-2', attemptId: 'attempt-2' } });
  ctx = f.service.taskContext({ projectId: f.p1.id, taskId: task.id }); assert.equal(ctx.executable.owner, 't3');
  await f.store.transaction(s => { s.plans[0].approved = false; });
  assert.equal(f.service.taskContext({ projectId: f.p1.id, taskId: task.id }).executable, null);
  assert.equal(f.store.read().runs.length, 2);
});

test('unified inbox is a read-only projection with existing native/Office/task/storage authorities', async t => {
  const f = await fixture(t);
  await f.store.transaction(s => {
    s.tasks[0].status = 'review';
    s.documents.push({ id: 'doc-1', projectId: f.p1.id });
    s.runs.push({ id: 'run-1', projectId: f.p1.id, taskId: f.tasks[0].id, pendingApprovals: [{ requestId: 'pending', prompt: 'Review actual native operation' }, { requestId: 'uncertain' }, { requestId: 'already-accepted' }] }, { id: 'foreign-run', projectId: f.p2.id, pendingApprovals: [{ requestId: 'foreign' }] });
    s.receipts.push({ operationId: 'native-response-1', type: 't3.permission-response', runId: 'run-1', requestId: 'uncertain', status: 'unknown' }, { operationId: 'native-response-2', type: 't3.permission-response', runId: 'run-1', requestId: 'already-accepted', status: 'accepted' });
    s.officeAgent = { requests: [{ projectId: f.p1.id, documentId: 'doc-1', operationId: 'office-1', status: 'review', edit: { kind: 'sheet.setValues' }, applyLeaseTokenHash: 'private-not-an-inbox-field' }, { projectId: f.p2.id, operationId: 'office-foreign', status: 'pending' }] };
    s.jobs.push({ id: 'storage-1', projectId: f.p1.id, kind: 'storage', action: 'sync', status: 'conflict' });
  });
  const before = f.store.read(), inbox = f.service.reviewInbox({ projectId: f.p1.id });
  assert.deepEqual(f.store.read(), before); assert.equal(inbox.items.length, 5);
  assert.deepEqual(inbox.items.filter(i => i.source === 't3').map(i => i.authority.method), ['respondApproval', 'reconcile']);
  assert.equal(inbox.items.find(i => i.source === 'office').authority.owner, 'office-agent');
  assert.equal(inbox.items.find(i => i.source === 'task').authority.method, 'task.update');
  assert.equal(inbox.items.find(i => i.source === 'storage').authority.method, 'retry');
  assert.doesNotMatch(JSON.stringify(inbox), /private-not-an-inbox-field|foreign/);
});

test('actual portable backup/restore remaps bot manager/task parent/goal context without migrating approval authority', async t => {
  const f = await fixture(t), external = await mkdtemp(path.join(os.tmpdir(), 'forge-governance-portable-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await f.service.setBotContext(botInput(f, 1, f.bots[0].id, 'portable-bot'));
  await f.service.setTaskContext(taskInput(f, 1, f.tasks[0].id, 'portable-task'));
  const storage = await createStorageService({ store: f.store, dataDir: f.dir, artifacts: createArtifactService({ store: f.store, dataDir: f.dir }) });
  await storage.configure({ operationId: 'storage-config', projectId: f.p1.id, expectedRevision: f.p1.revision, destinations: [{ id: 'archive', name: 'Disposable archive', kind: 'local', directory: path.join(external, 'archive') }] });
  const input = { projectId: f.p1.id, destinationId: 'archive' };
  const saved = await storage.backup({ ...input, operationId: 'backup' });
  assert.equal(saved.status, 'completed', JSON.stringify(saved.error));
  const restored = await storage.restore({ ...input, operationId: 'restore', bundleId: saved.bundleId, manifestSha256: saved.manifestSha256, expectedRevision: 2, targetDirectory: path.join(external, 'restored-project') });
  assert.equal(restored.status, 'completed', JSON.stringify(restored.error));
  const s = f.store.read(), projectId = restored.restoredProjectId;
  assert.equal(validateProjectContext(s, { projectId }), true);
  const worker = s.bots.find(b => b.projectId === projectId && b.name === 'Worker'), manager = s.bots.find(b => b.projectId === projectId && b.name === 'Manager');
  assert.equal(worker.governance.managerBotId, manager.id); assert.notEqual(manager.id, f.bots[0].id);
  const child = s.tasks.find(t => t.projectId === projectId && t.title === 'Child'), parent = s.tasks.find(t => t.projectId === projectId && t.title === 'Parent');
  const plan = s.plans.find(p => p.projectId === projectId);
  assert.equal(child.governance.parentTaskId, parent.id); assert.equal(child.governance.goalId, plan.id);
  assert.equal(child.governance.nextAction.taskId, child.id);
  assert.equal(f.service.taskContext({ projectId, taskId: child.id }).executable.owner, 't3');
  assert.equal(s.events.filter(e => e.projectId === projectId && e.type.startsWith('governance.')).length, 0);
  assert.equal(s.connections.filter(c => c.projectId === projectId).length, 0);
  assert.equal(s.runs.filter(r => r.projectId === projectId).length, 0);
});
