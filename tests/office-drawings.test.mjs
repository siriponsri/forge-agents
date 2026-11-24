import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_RESOURCE, imageAssets, resolveSheet, snapshotWithImages } from '../app/web/src/office-drawings.mjs';

const asset = { artifactId: 'artifact-1', projectId: 'project-1', sha256: 'a'.repeat(64),
  source: '/api/artifacts/artifact-1/download', mimeType: 'image/png', bytes: 100, name: 'chart.png' };
const drawing = { imageSourceType: 'URL', source: asset.source };
test('native drawing resources retain asset identity, plugin data, removal and undo restoration', () => {
  const plugin = { name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ sheet1: { image1: drawing } }) };
  const snapshot = { resources: [plugin, { name: 'other-supported-plugin', data: 'opaque' }], untouched: { styles: [1, 2] } };
  const saved = snapshotWithImages(snapshot, [asset], asset.projectId);
  assert.deepEqual(saved.resources.slice(0, 2), snapshot.resources);
  assert.deepEqual(imageAssets(saved, asset.projectId), [asset]);
  assert.equal(snapshot.resources.length, 2, 'does not mutate live/save input');
  assert.equal(snapshotWithImages({ resources: [] }, [asset], asset.projectId).resources.length, 0);
  assert.deepEqual(snapshotWithImages(snapshot, [asset], asset.projectId), saved, 'undo can reattach the same asset');
  const shape = { drawingType: 1, imageSourceType: 'BASE64', source: 'data:image/svg+xml;base64,PHN2Zy8+' };
  assert.deepEqual(snapshotWithImages({ drawings: { shape } }, [], asset.projectId).drawings.shape, shape,
    'native vector shape resources remain plugin-owned');
});
test('wrong-project manifests and non-durable native drawing sources fail without stripping recovery data', () => {
  const saved = snapshotWithImages({ drawings: { image1: drawing } }, [asset], asset.projectId);
  assert.throws(() => imageAssets(saved, 'project-2'), /another project/);
  for (const source of ['blob:temporary', 'file:///local.png', 'data:image/png;base64,eA==', 'https://external.test/a.png', '/api/artifacts/unknown/download']) {
    const input = { drawings: { image1: { ...drawing, source } } };
    assert.throws(() => snapshotWithImages(input, [asset], asset.projectId), /Upload this image/);
    assert.equal(snapshotWithImages(input, [asset], asset.projectId, { validate: false }).drawings.image1.source, source);
  }
  assert.throws(() => imageAssets({ resources: [{ name: IMAGE_RESOURCE, data: '{' }] }, asset.projectId), /unreadable/);
});
test('explicit sheet IDs never fall back to the active sheet', () => {
  const active = { id: 'active' }, other = { id: 'other' };
  const unit = { getActiveSheet: () => active, getSheetBySheetId: id => id === 'other' ? other : null };
  assert.equal(resolveSheet(unit), active);
  assert.equal(resolveSheet(unit, 'other'), other);
  for (const id of ['absent', '', null]) assert.throws(() => resolveSheet(unit, id), /unavailable/);
});
