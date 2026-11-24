// Disposable engineering fixtures. No provider/account/prototype is executed.
// The mounted editor and lead's accepted receipt extension are injected below;
// these fixtures DO NOT establish real Univer GUI/undo qualification.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { covertCellValue, Styles } from '@univerjs/core';
import { getCellType, getCellValue } from '@univerjs/sheets';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createOfficeAgentService } from '../app/office/agent-service.mjs';
import { rangeOf } from '../app/office/agent-contract.mjs';

export async function fixture(t, kind = 'sheet') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-office-agent-fixture-'));
  const dataDir = path.join(root, 'state');
  let store = await openStore(dataDir), clock = 100000;
  const execute = input => command(store, input, {clock:()=>clock});
  const cmd = (type, projectId, data) => execute({ type, projectId, data, operationId: randomUUID() });
  const project = (await cmd('project.create', undefined, { name: 'Disposable office agent fixture', workspace: path.join(root, 'project') })).entity;
  const bot = (await cmd('bot.create', project.id, { name: 'Fixture bot' })).entity;
  const task = (await cmd('task.create', project.id, { title: 'Fixture task', botId: bot.id })).entity;
  const run = { id: randomUUID(), attemptId: randomUUID(), projectId: project.id, botId: bot.id, taskId: task.id, status: 'running', fixture: true };
  await store.transaction(s => s.runs.push(run));
  const snapshot = kind === 'sheet' ? { id: randomUUID(), sheetOrder: ['first', 'second'], sheets: Object.fromEntries(['first', 'second'].map(id => [id, { id, name: id, rowCount: 50, columnCount: 30, cellData: {} }])) } : { id: randomUUID(), body: { dataStream: 'hello\r\n', paragraphs: [{ startIndex: 5 }], sectionBreaks: [{ startIndex: 6 }] } };
  const document = (await cmd('document.create', project.id, { name: 'Fixture document', kind, snapshot, packageVersion: '1.6.1' })).entity;
  const scope = { projectId: project.id, documentId: document.id, botId: bot.id, taskId: task.id, runId: run.id, attemptId: run.attemptId };
  const f = {
    root, dataDir, scope, document, command:execute, get store() { return store; },
    service: createOfficeAgentService({ store, dataDir, now: () => clock }),
    advance(ms) { clock += ms; },
    input(edit = kind === 'sheet' ? { kind: 'sheet.setValues', sheetId: 'second', range: 'A1:B1', text: 'ไทย\t=1+2' } : { kind: 'doc.insertText', index: 2, text: 'ไทย' }) { return { ...scope, operationId: randomUUID(), expectedRevision: 1, edit }; },
    key(input) { return { ...scope, operationId: input.operationId }; },
    async lease(session = randomUUID(), revision = 1) {
      const lease = await f.service.claim({ projectId: scope.projectId, documentId: scope.documentId, editorSessionId: session, expectedRevision: revision, dirty: false });
      return { projectId: scope.projectId, documentId: scope.documentId, editorSessionId: session, leaseToken: lease.leaseToken, expectedRevision: revision, dirty: false };
    },
    editor(input, lease) { return { ...f.key(input), ...lease }; },
    ackInput(input, lease) { return { ...f.key(input), editorSessionId: lease.editorSessionId, leaseToken: lease.leaseToken }; },
    async begin(input, lease = undefined) {
      await f.service.requestEdit(input); lease ??= await f.lease();
      await f.service.review(f.editor(input, lease));
      const permit = await f.service.beginApply(f.editor(input, lease)); assert.equal(permit.mayApply, true);
      return { lease, permit };
    },
    // An injected mounted-editor effect, not a second production writer.
    editorSnapshotFixture(input) {
      const current = store.read().documents.find(d => d.id === scope.documentId), after = structuredClone(current.snapshot), edit = input.edit;
      if (edit.kind === 'doc.insertText') after.body.dataStream = after.body.dataStream.slice(0, edit.index) + edit.text + after.body.dataStream.slice(edit.index);
      else {
        const a = rangeOf(edit.range), rows = edit.text.replace(/\r/g, '').split('\n').map(row => row.split('\t')), styles = new Styles(after.styles ?? {});
        for (let r = a.top; r <= a.bottom; r++) for (let c = a.left; c <= a.right; c++) {
          const data = after.sheets[edit.sheetId].cellData; data[r] ??= {}; const value = rows[r - a.top][c - a.left];
          const converted = covertCellValue(value), type = getCellType(styles, converted, data[r][c] ?? {});
          data[r][c] = value.startsWith('=') ? { f: value, v: 3 } : { ...converted, v: getCellValue(type, converted), t: type };
        }
      }
      return after;
    },
    async saveWithProposedLeadReceiptFixture(permit, after) {
      const input = { ...permit.saveCommand, data: { ...permit.saveCommand.data, snapshot: after } };
      // Use the integrated domain guard and its real durable receipt.
      await execute(input);
      return store.read().receipts.find(r => r.operationId === input.operationId).result;
    },
    async restart() { await store.close(); store = await openStore(dataDir); f.service = createOfficeAgentService({ store, dataDir, now: () => clock }); await f.service.recover(); },
  };
  t.after(async () => { await store.close(); assert.ok(path.basename(root).startsWith('forge-office-agent-fixture-')); await rm(root, { recursive: true, force: true }); });
  return f;
}
