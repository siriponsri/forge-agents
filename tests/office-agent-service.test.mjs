import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { command } from '../app/server/domain.mjs';
import { fixture } from './office-agent-fixtures.test.mjs';
import { LIMITS, validateOfficeAgentSave } from '../app/office/agent-contract.mjs';

test('queue is durable and scoped; reading/status never writes document snapshots', async t => {
  const f = await fixture(t), input = f.input();
  const initial = structuredClone(f.store.read().documents);
  assert.equal((await f.service.requestEdit(input)).request.status, 'pending');
  const read = f.service.readDocument({ ...f.scope, expectedRevision: 1, selection: { sheetId: 'second', range: 'A1:B1' } });
  assert.equal(read.source, 'durable-snapshot'); assert.deepEqual(read.content.cells, [[{ value: null }, { value: null }]]);
  await f.restart(); assert.equal((await f.service.status(f.key(input))).request.status, 'pending');
  assert.deepEqual(f.store.read().documents, initial);
  assert.equal((await f.service.requestEdit(input)).replayed, true);
});

test('same mounted session issues only one apply permit; completion needs matching durable save', async t => {
  const f = await fixture(t), input = f.input(), { lease, permit } = await f.begin(input);
  assert.equal((await f.service.beginApply(f.editor(input, lease))).mayApply, false);
  assert.equal((await f.service.ack(f.ackInput(input, lease))).request.status, 'applying');
  await f.saveWithProposedLeadReceiptFixture(permit, f.editorSnapshotFixture(input));
  const result = await f.service.ack(f.ackInput(input, lease));
  assert.equal(result.request.status, 'completed'); assert.equal(result.request.receipt.baseRevision, 1); assert.equal(result.request.receipt.revision, 2);
  assert.equal(result.request.receipt.durability, 'saved'); assert.deepEqual(result.request.receipt.actor, permit.saveCommand.data.actor);
  assert.equal((await f.service.requestEdit(input)).request.status, 'completed');
  await f.restart(); assert.equal((await f.service.requestEdit(input)).request.status, 'completed');
  assert.equal(f.store.read().receipts.filter(r => r.operationId === input.operationId).length, 1);
  assert.equal(f.store.read().documents[0].revision, 2);
});

test('competing tabs and parallel edit requests cannot both obtain a writer', async t => {
  const f = await fixture(t), a = f.input(), b = f.input();
  await Promise.all([f.service.requestEdit(a), f.service.requestEdit(b)]);
  const claims = await Promise.allSettled([f.lease('tab-a'), f.lease('tab-b')]);
  assert.equal(claims.filter(x => x.status === 'fulfilled').length, 1);
  const lease = claims.find(x => x.status === 'fulfilled').value;
  for (const input of [a, b]) await f.service.review(f.editor(input, lease));
  const grants = await Promise.allSettled([f.service.beginApply(f.editor(a, lease)), f.service.beginApply(f.editor(b, lease))]);
  assert.equal(grants.filter(x => x.status === 'fulfilled' && x.value.mayApply).length, 1);
  assert.equal(grants.find(x => x.status === 'rejected').reason.code, 'EDITOR_OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(f.store.read()).includes(lease.leaseToken), false);
  assert.match(f.store.read().officeAgent.leases[0].leaseTokenHash, /^[a-f0-9]{64}$/);
});

test('dirty human work and unknown dirty state are refused before review/apply', async t => {
  const f = await fixture(t), input = f.input();
  await f.service.requestEdit(input);
  const claim = { projectId: f.scope.projectId, documentId: f.scope.documentId, editorSessionId: 'human', expectedRevision: 1 };
  await assert.rejects(f.service.claim({ ...claim, dirty: true }), { code: 'HUMAN_DIRTY' });
  await assert.rejects(f.service.claim(claim), { code: 'HUMAN_DIRTY' });
  const lease = await f.lease();
  await assert.rejects(f.service.review({ ...f.editor(input, lease), dirty: true }), { code: 'HUMAN_DIRTY' });
  await f.service.review(f.editor(input, lease));
  await assert.rejects(f.service.beginApply({ ...f.editor(input, lease), dirty: true }), { code: 'HUMAN_DIRTY' });
  assert.equal((await f.service.status(f.key(input))).request.status, 'review');
});

test('stale revisions conflict before requests and before applying reviewed work', async t => {
  const f = await fixture(t), input = f.input();
  await assert.rejects(f.service.requestEdit({ ...input, expectedRevision: 2 }), { code: 'REVISION_CONFLICT' });
  await f.service.requestEdit(input); const lease = await f.lease(); await f.service.review(f.editor(input, lease));
  const d = f.store.read().documents[0];
  await command(f.store, { type: 'document.save', operationId: randomUUID(), projectId: f.scope.projectId, id: d.id, expectedRevision: 1, data: { snapshot: d.snapshot, actor: { kind: 'human' } } });
  const result = await f.service.beginApply(f.editor(input, lease)); assert.equal(result.mayApply, false); assert.equal(result.request.status, 'conflict');
  assert.throws(() => f.service.readDocument({ ...f.scope, expectedRevision: 1, selection: { sheetId: 'first', range: 'A1' } }), { code: 'REVISION_CONFLICT' });
});

test('operation fingerprint prevents scope/payload reuse, including after restart', async t => {
  const f = await fixture(t), input = f.input(); await f.service.requestEdit(input); await f.restart();
  await assert.rejects(f.service.requestEdit({ ...input, edit: { ...input.edit, text: 'different\t=1+2' } }), { code: 'OPERATION_REUSE' });
  for (const k of ['projectId', 'documentId', 'botId', 'taskId', 'runId', 'attemptId']) {
    await assert.rejects(f.service.status({ ...f.key(input), [k]: randomUUID() }), e => ['SCOPE', 'NOT_FOUND'].includes(e.code));
    const missing = { ...input }; delete missing[k]; await assert.rejects(f.service.requestEdit(missing), { code: 'VALIDATION' });
  }
  await f.store.transaction(s => s.runs.push({ ...s.runs[0], id: randomUUID() }));
  await assert.rejects(f.service.requestEdit({ ...input, runId: f.store.read().runs[1].id }), { code: 'OPERATION_REUSE' });
});

test('invalid arguments, arbitrary JS, wrong sheet and document offsets fail without queueing', async t => {
  const f = await fixture(t);
  for (const edit of [{ kind: 'javascript', text: 'alert(1)' }, { ...f.input().edit, script: 'x' }, { ...f.input().edit, range: 'A1:XFD999999' }, { ...f.input().edit, sheetId: 'missing' }, { ...f.input().edit, range: 'A1:B2' }, { ...f.input().edit, text: 'x'.repeat(10001) }]) await assert.rejects(f.service.requestEdit(f.input(edit)), { code: 'VALIDATION' });
  assert.equal(f.store.read().officeAgent?.requests.length ?? 0, 0);
  const doc = await fixture(t, 'doc');
  for (const edit of [{ kind: 'doc.insertText', index: '2', text: 'x' }, { kind: 'doc.insertText', index: 6, text: 'x' }, { kind: 'doc.insertText', index: 0, text: 'one\ntwo' }, { kind: 'doc.insertText', index: 0, text: '' }]) await assert.rejects(doc.service.requestEdit(doc.input(edit)), { code: 'VALIDATION' });
});

test('expired claim before application may be reviewed in a new session; stale tab is fenced', async t => {
  const f = await fixture(t), input = f.input(); await f.service.requestEdit(input);
  const old = await f.lease('old'); await f.service.review(f.editor(input, old)); f.advance(LIMITS.leaseMs + 1);
  const next = await f.lease('next');
  await assert.rejects(f.service.beginApply(f.editor(input, old)), { code: 'EDITOR_LEASE' });
  await assert.rejects(f.service.beginApply(f.editor(input, next)), { code: 'REVIEW_REQUIRED' });
  await f.service.review(f.editor(input, next)); assert.equal((await f.service.beginApply(f.editor(input, next))).mayApply, true);
});

test('uncertain apply after expiry/restart cannot be reassigned or replayed', async t => {
  const f = await fixture(t), input = f.input(), { lease } = await f.begin(input);
  f.advance(LIMITS.leaseMs + 1); assert.equal((await f.service.status(f.key(input))).request.status, 'uncertain');
  await assert.rejects(f.lease('second'), { code: 'EDITOR_OUTCOME_UNKNOWN' });
  await f.restart(); assert.equal((await f.service.requestEdit(input)).request.status, 'uncertain');
  await assert.rejects(f.lease('third'), { code: 'EDITOR_OUTCOME_UNKNOWN' });
  await assert.rejects(f.service.beginApply(f.editor(input, lease)), { code: 'EDITOR_LEASE' });
  assert.equal(f.store.read().documents[0].revision, 1);
});

test('lost save response reconciles after restart without another editor mutation', async t => {
  const f = await fixture(t, 'doc'), input = f.input(), { permit } = await f.begin(input);
  let fixtureMutations = 0;
  const after = f.editorSnapshotFixture(input); fixtureMutations++;
  await f.saveWithProposedLeadReceiptFixture(permit, after); // response deliberately not acknowledged
  await f.restart(); const result = await f.service.requestEdit(input);
  assert.equal(result.request.status, 'completed'); assert.equal(fixtureMutations, 1);
  assert.equal(f.store.read().documents[0].snapshot.body.dataStream, 'heไทยllo\r\n');
  assert.equal(f.service.readDocument({ ...f.scope, expectedRevision: 2, selection: { index: 0, length: 100 } }).content.text, 'heไทยllo');
});

test('generic/frontend fabricated ack and save without attributed receipt cannot complete', async t => {
  const f = await fixture(t), input = f.input(), { permit, lease } = await f.begin(input);
  await assert.rejects(f.service.ack({ ...f.ackInput(input, lease), receipt: { outcome: 'applied', revision: 2 } }), { code: 'VALIDATION' });
  const after = f.editorSnapshotFixture(input);
  await command(f.store, { ...permit.saveCommand, data: { ...permit.saveCommand.data, snapshot: after } });
  const result = await f.service.ack(f.ackInput(input, lease));
  assert.equal(result.request.status, 'uncertain'); assert.equal(result.request.reason, 'RECEIPT_UNVERIFIED');
});

test('false durable receipt with wrong content, region, actor, scope or revision stays unverified', async t => {
  for (const corrupt of ['snapshot', 'region', 'actor', 'project', 'base', 'revision', 'entity']) {
    const f = await fixture(t, 'doc'), input = f.input(), { permit, lease } = await f.begin(input);
    await f.saveWithProposedLeadReceiptFixture(permit, f.editorSnapshotFixture(input));
    await f.store.transaction(s => {
      const result = s.receipts.find(r => r.operationId === input.operationId).result;
      if (corrupt === 'snapshot') result.entity.snapshot.body.dataStream = 'wrong\r\n';
      if (corrupt === 'region') result.receipt.operation.region = 'body:0';
      if (corrupt === 'actor') result.receipt.actor.botId = randomUUID();
      if (corrupt === 'project') result.receipt.projectId = randomUUID();
      if (corrupt === 'base') result.receipt.baseRevision++;
      if (corrupt === 'revision') result.receipt.revision++;
      if (corrupt === 'entity') result.entity.id = randomUUID();
    });
    const result = await f.service.ack(f.ackInput(input, lease)); assert.equal(result.request.status, 'uncertain', corrupt);
  }
});

test('later human revision retains verified agent receipt and replay never restores old content', async t => {
  const f = await fixture(t, 'doc'), input = f.input(), { permit } = await f.begin(input);
  await f.saveWithProposedLeadReceiptFixture(permit, f.editorSnapshotFixture(input));
  const afterHuman = structuredClone(f.store.read().documents[0].snapshot); afterHuman.body.dataStream = 'human later\r\n';
  await command(f.store, { type: 'document.save', operationId: randomUUID(), projectId: f.scope.projectId, id: f.scope.documentId, expectedRevision: 2, data: { snapshot: afterHuman, actor: { kind: 'human' } } });
  await f.restart(); assert.equal((await f.service.requestEdit(input)).request.status, 'completed');
  assert.equal(f.store.read().documents[0].revision, 3); assert.equal(f.store.read().documents[0].snapshot.body.dataStream, 'human later\r\n');
});

test('review is required, rejecting is durable, renew cannot rotate or reveal lease token', async t => {
  const f = await fixture(t), input = f.input(); await f.service.requestEdit(input); const lease = await f.lease();
  await assert.rejects(f.service.beginApply(f.editor(input, lease)), { code: 'REVIEW_REQUIRED' });
  f.advance(10000); assert.deepEqual(await f.service.renew(lease), { expiresAt: 140000 });
  await assert.rejects(f.service.review({ ...f.editor(input, lease), leaseToken: 'wrong' }), { code: 'EDITOR_LEASE' });
  assert.equal((await f.service.reject(f.ackInput(input, lease))).request.status, 'rejected');
  await f.restart(); assert.equal((await f.service.requestEdit(input)).request.status, 'rejected');
});

test('bounded queue never evicts operation identity to make replay possible', async t => {
  const f = await fixture(t); const first = f.input(); await f.service.requestEdit(first);
  for (let i = 1; i < LIMITS.activePerDocument; i++) await f.service.requestEdit(f.input());
  await assert.rejects(f.service.requestEdit(f.input()), { code: 'OFFICE_QUEUE_FULL' });
  assert.equal((await f.service.requestEdit(first)).replayed, true);
  await f.store.transaction(s => { const original = s.officeAgent.requests[0]; for (let i = s.officeAgent.requests.length; i < LIMITS.requests; i++) s.officeAgent.requests.push({ ...original, operationId: randomUUID(), status: 'rejected' }); });
  const lease = await f.lease(); await f.service.reject(f.ackInput(first, lease));
  await assert.rejects(f.service.requestEdit(f.input()), { code: 'OFFICE_QUEUE_FULL' });
});

test('same-transaction save guard fences competing tabs, raw command bypasses and wrong effects', async t => {
  const f = await fixture(t), input = f.input(), { permit, lease } = await f.begin(input);
  const save = { ...permit.saveCommand, data: { ...permit.saveCommand.data, snapshot: f.editorSnapshotFixture(input) } };
  const guard = data => validateOfficeAgentSave(f.store.read(), data, { now: 100000 });
  assert.doesNotThrow(() => guard(save));
  assert.throws(() => guard({ ...save, officeAgent: undefined }), { code: 'VALIDATION' });
  assert.throws(() => guard({ ...save, officeAgent: { ...save.officeAgent, leaseToken: 'forged' } }), { code: 'EDITOR_LEASE' });
  assert.throws(() => guard({ ...save, officeAgent: { ...save.officeAgent, editorSessionId: 'competing-tab' } }), { code: 'EDITOR_LEASE' });
  assert.throws(() => guard({ ...save, data: { ...save.data, snapshot: f.document.snapshot } }), { code: 'EDIT_EFFECT_MISMATCH' });
  assert.throws(() => guard({ ...save, data: { ...save.data, actor: { kind: 'agent', botId: input.botId } } }), { code: 'SCOPE' });
  assert.throws(() => guard({ ...save, type: 'task.update' }), { code: 'OPERATION_REUSE' });
  for (const type of ['document.save', 'document.update', 'document.restore']) assert.throws(() => guard({ ...save, type, officeAgent: undefined, operationId: randomUUID(), data: { snapshot: f.document.snapshot, actor: { kind: 'human' } } }), { code: 'EDITOR_OUTCOME_UNKNOWN' });
  assert.throws(() => validateOfficeAgentSave(f.store.read(), save, { now: 130001 }), { code: 'EDITOR_LEASE' });
  assert.equal(JSON.stringify(f.store.read()).includes(lease.leaseToken), false);
});

test('pinned Univer scalar conversion verifies numeric/date/percent/boolean TSV and formula expressions', async t => {
  const f = await fixture(t), input = f.input({ kind: 'sheet.setValues', sheetId: 'second', range: 'A1:G1', text: '42\t12%\t2026-11-24\tTRUE\t1,234\tไทย\t=SUM(A1:B1)' });
  const { permit, lease } = await f.begin(input), snapshot = f.editorSnapshotFixture(input);
  assert.deepEqual(Object.values(snapshot.sheets.second.cellData[0]).map(c => c.f ?? c.v), [42, 0.12, 46350, 1, 1234, 'ไทย', '=SUM(A1:B1)']);
  assert.doesNotThrow(() => validateOfficeAgentSave(f.store.read(), { ...permit.saveCommand, data: { ...permit.saveCommand.data, snapshot } }, { now: 100000 }));
  await f.saveWithProposedLeadReceiptFixture(permit, snapshot);
  assert.equal((await f.service.ack(f.ackInput(input, lease))).request.status, 'completed');
});
