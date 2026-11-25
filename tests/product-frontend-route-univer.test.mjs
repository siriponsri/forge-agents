import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Univer, LocaleType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService, UniverDocsPlugin } from '@univerjs/docs';
import '@univerjs/docs/facade';

const root = fileURLToPath(new URL('..', import.meta.url));
async function component(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-frontend-univer-'));
  await symlink(realpathSync(path.join(root, 'node_modules')), path.join(dir, 'node_modules'), 'junction');
  const result = await build({ entryPoints: [path.join(root, 'app/web/src/FrontendTools.jsx')], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
  const output = path.join(dir, 'component.mjs'); await writeFile(output, result.outputFiles[0].contents);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return import(pathToFileURL(output));
}

// Actual installed Univer 1.6.1 document unit + selection service. This headless
// fixture qualifies exported API reading; full Office mounting is lead-owned.
test('actual Univer Doc selection supplies bounded UTF-16 text from same saved revision', async t => {
  const { readSavedDocSelection } = await component(t);
  const univer = new Univer({ locale: LocaleType.EN_US }); univer.registerPlugin(UniverDocsPlugin);
  t.after(() => univer.dispose());
  const api = FUniver.newAPI(univer), unit = api.createDocument({ id: 'native-doc', title: 'Saved', body: { dataStream: 'Hello ไทย😀 world\r\n', paragraphs: [{ startIndex: 17 }], sectionBreaks: [{ startIndex: 18 }] } });
  const saved = unit.save(), record = { id: 'doc', projectId: 'project', kind: 'doc', revision: 3, snapshot: structuredClone(saved) };
  const editor = { univer, unit, ready: true, record, currentRevision: 3, dirty: false, saving: false, pendingEdit: false, baseline: JSON.stringify(saved), rawSnapshot: () => unit.save() };
  const service = univer.__getInjector().get(DocSelectionManagerService);
  const target = { unitId: unit.getId(), subUnitId: unit.getId() };
  // Public logical-selection writer, no render layer or test-only method.
  const select = textRanges => service.replaceSelectionInfoWithoutRefresh({ textRanges, rectRanges: [], segmentId: '', segmentPage: -1, isEditing: false }, target);
  select([{ startOffset: 6, endOffset: 11 }]);
  const pending = { arguments: { documentId: 'doc', expectedRevision: 3 } };
  const result = await readSavedDocSelection(pending, () => editor);
  assert.deepEqual(result, { status: 'ok', documentId: 'doc', revision: 3, selection: { start: 6, end: 11, text: 'ไทย😀' } });
  assert.equal(result.selection.end - result.selection.start, result.selection.text.length);
  assert.deepEqual(unit.save(), saved, 'read changes no snapshot or revision');
  for (const patch of [{ dirty: true }, { saving: true }, { pendingEdit: true }, { currentRevision: 4 }, { baseline: 'stale' }, { record: { ...record, revision: 4 } }]) {
    assert.equal((await readSavedDocSelection(pending, () => ({ ...editor, ...patch }))).error.code, 'REVISION_CONFLICT');
  }
  select([{ startOffset: 2, endOffset: 2 }]);
  assert.equal((await readSavedDocSelection(pending, () => editor)).error.code, 'NO_SELECTION');
  select([{ startOffset: 0, endOffset: 1 }, { startOffset: 2, endOffset: 3 }]);
  assert.equal((await readSavedDocSelection(pending, () => editor)).error.code, 'NO_SELECTION');
  assert.equal((await readSavedDocSelection(pending, () => null)).error.code, 'EDITOR_UNAVAILABLE');
  assert.equal((await readSavedDocSelection(pending, () => ({ ...editor, record: { ...record, kind: 'sheet' } }))).error.code, 'EDITOR_UNAVAILABLE');
});

test('Office control renders TH default / EN, approved existing tasks, saved Doc gate and actual controls', async t => {
  const { default: FrontendTools, FrontendRunControl } = await component(t);
  const props = { projectId: 'p', state: { tasks: [{ id: 'a', projectId: 'p', planId: 'approved', title: 'Read saved selection' }, { id: 'b', projectId: 'p', planId: 'draft', title: 'Unapproved task' }], plans: [{ id: 'approved', projectId: 'p', approved: true }, { id: 'draft', projectId: 'p', approved: false }] }, record: { id: 'doc', kind: 'doc', revision: 1 }, dirty: true };
  const th = renderToStaticMarkup(React.createElement(FrontendRunControl, props));
  assert.match(th, /บันทึกเอกสารก่อนเริ่มงาน/); assert.match(th, /Read saved selection/); assert.doesNotMatch(th, /Unapproved task/); assert.match(th, /disabled=""/);
  const en = renderToStaticMarkup(React.createElement(FrontendRunControl, { ...props, t: (_th, en) => en }));
  assert.match(en, /Save the document before starting/);
  assert.equal(renderToStaticMarkup(React.createElement(FrontendTools, { projectId: 'p', run: { id: 'ordinary' } })), '');
  const pending = renderToStaticMarkup(React.createElement(FrontendTools, { projectId: 'p', run: { id: 'run', projectId: 'p', attemptId: 'attempt', frontendContext: {} }, t: (_th, en) => en }));
  assert.match(pending, /Requests appear here/); assert.doesNotMatch(pending, /script|execute JavaScript|saved edit/i);
});
