// Actual pinned public Univer API, headless engineering fixture. This qualifies
// command/snapshot/undo semantics only, NOT the mounted FORGE GUI or a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Univer, LocaleType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import '@univerjs/sheets/facade';
import enUS from '@univerjs/sheets/locale/en-US';
import { boundedSheetEdit } from '../app/web/src/api.mjs';
import { verifyEffect, validateOfficeAgentSave } from '../app/office/agent-contract.mjs';
import { fixture } from './office-agent-fixtures.test.mjs';

test('actual Univer 1.6.1 Facade batch matches verifier and one undo/redo boundary', async t => {
  const f = await fixture(t);
  const input = f.input({ kind: 'sheet.setValues', sheetId: 'second', range: 'A1:G1', text: '42\t12%\t2026-11-24\tTRUE\t1,234\tไทย\t=SUM(A1:B1)' });
  const { permit, lease } = await f.begin(input);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: enUS } });
  t.after(() => univer.dispose()); univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer), book = api.createWorkbook(structuredClone(f.document.snapshot));
  const sheet = book.getSheetBySheetId(input.edit.sheetId), parsed = boundedSheetEdit(input.edit.range, input.edit.text);
  sheet.getRange(parsed.range).setValues(parsed.values);
  const after = book.save(), storedRequest = f.store.read().officeAgent.requests[0];
  assert.equal(verifyEffect(storedRequest, after), true);
  assert.equal(after.sheets.first.cellData[0]?.[0], undefined);
  assert.doesNotThrow(() => validateOfficeAgentSave(f.store.read(), { ...permit.saveCommand, data: { ...permit.saveCommand.data, snapshot: after } }, { now: 100000 }));
  await f.saveWithProposedLeadReceiptFixture(permit, after);
  assert.equal((await f.service.ack(f.ackInput(input, lease))).request.status, 'completed');
  // Workbook-scoped undo establishes focus, unlike global api.undo() in a
  // headless session that has never focused a workbook.
  book.undo(); assert.equal(book.save().sheets.second.cellData[0]?.[0]?.v, undefined);
  book.redo(); assert.equal(verifyEffect(storedRequest, book.save()), true);
  sheet.getRange('A2').setValue('human');
  book.undo(); assert.equal(book.save().sheets.second.cellData[1]?.[0]?.v, undefined);
  assert.equal(verifyEffect(storedRequest, book.save()), true);
  book.undo(); assert.equal(book.save().sheets.second.cellData[0]?.[0]?.v, undefined);
  sheet.getRange('B2').setValue('human after undo');
  book.redo(); assert.equal(book.save().sheets.second.cellData[0]?.[0]?.v, undefined);
  assert.equal(book.save().sheets.second.cellData[1]?.[1]?.v, 'human after undo');
});
