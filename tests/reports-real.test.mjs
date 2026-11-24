import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createReportService } from '../app/reports/service.mjs';
import { atomicJSON, sha256 } from '../app/reports/files.mjs';
import { openSession } from '../app/reports/engine.mjs';

// Engineering qualification fixture. No provider, credentials, real project or cloud.
export async function testStore(path, seed) {
  if (process.env.FORGE_REPORT_STORE_MODULE) {
    const { openStore } = await import(pathToFileURL(process.env.FORGE_REPORT_STORE_MODULE));
    const store = await openStore(join(path, '..', 'shared-sqlite'));
    if (seed) await store.transaction(state => Object.assign(state, seed));
    return store;
  }
  let queue = Promise.resolve();
  if (seed) await atomicJSON(path, seed);
  return {
    async close() {},
    read: async () => JSON.parse(await readFile(path, 'utf8')),
    transaction(fn) {
      const result = queue.then(async () => { const state = JSON.parse(await readFile(path, 'utf8')); const result = await fn(state); state.revision++; await atomicJSON(path, state); return result; });
      queue = result.catch(() => {}); return result;
    },
  };
}
export function fixtureState(workspace) {
  return { schemaVersion: 1, revision: 1, projects: [{ id: 'fixture-project', name: 'Engineering qualification fixture', workspace, revision: 1 }], jobs: [], artifacts: [], receipts: [], reports: [{
    id: 'fixture-report', projectId: 'fixture-project', revision: 1,
    spec: { schemaVersion: 1, title: 'FORGE Engineering Qualification', language: 'th', fontFamily: 'Tahoma', template: { id: 'engineering', version: 1 },
      sections: [{ heading: 'ผลการตรวจสอบ Mixed Thai/English', text: 'ทดสอบสระและวรรณยุกต์ น้ำ กำลัง เก้าอี้ ผู้ใช้ สวัสดี English searchable text.',
        table: { header: true, values: [['รายการ Item', 'ค่า Value'], ...Array.from({ length: 45 }, (_, i) => [`แถว Row ${i + 1}`, i + 1])] } },
        { heading: 'หน้าถัดไป Page break', text: 'Source revision one. ข้อมูลทดสอบทางวิศวกรรม', pageBreakBefore: true }],
      citations: [{ title: 'Fixture source reference', url: 'https://example.org/engineering-fixture' }], inputs: [] },
  }] };
}
export async function settled(service, id) {
  for (let n = 0; n < 600; n++) {
    const job = await service.getJob(id);
    if (['ready', 'failed', 'unknown', 'interrupted'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Report job failed to settle within 30 seconds');
}
function crc(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(data));
  return Buffer.concat([header, data, tail]);
}
function fixturePNG() {
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(32 * (1 + 32 * 3));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const p = y * 97 + 1 + x * 3; pixels[p] = 225; pixels[p + 1] = 90; pixels[p + 2] = 35; }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

test('REAL Windows released WordCraft/PdfCraft: Thai/English DOCX+PDF, preview, rotation, strict glyph error, checksum download', { skip: process.env.FORGE_REPORT_REAL !== '1', timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'forge-report-real-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const state = fixtureState(workspace);
  // Actual harmless generated PNG figure, not a substitute for an engine-produced report.
  const png = fixturePNG();
  await writeFile(join(workspace, 'fixture.png'), png);
  state.artifacts.push({ id: 'fixture-image', projectId: 'fixture-project', revision: 1, kind: 'png', path: join(workspace, 'fixture.png'), sha256: sha256(png) });
  state.reports[0].spec.sections[1].figure = { artifactId: 'fixture-image', revision: 1, caption: 'รูปทดสอบ Fixture image', width: 100 };
  const store = await testStore(join(root, 'state.json'), state);
  const service = createReportService({ dataDir: root, store });
  const cache = join(process.env.LOCALAPPDATA, 'FORGE/report-engine-research');
  const engine = (name, version) => ({ path: join(cache, `${name}-${version}/${name}-${version}-windows-x64-portable/${name}-cli.exe`) });
  t.after(async () => { await service.shutdown(); await store.close(); if (process.env.FORGE_REPORT_KEEP !== '1') await rm(root, { recursive: true, force: true }); });
  const health = await service.configure({ wordcraft: engine('wordcraft', '0.18.1'), pdfcraft: engine('pdfcraft', '0.22.0'), fonts: [{ family: 'Tahoma', version: 'local-Windows-file-hash', paths: [join(process.env.WINDIR, 'Fonts/tahoma.ttf'), join(process.env.WINDIR, 'Fonts/tahomabd.ttf')], license: 'Windows font, local only, not redistributed' }] });
  assert.equal(health.ready, true);
  const input = { operationId: 'real-generate-1', projectId: 'fixture-project', reportId: 'fixture-report', expectedRevision: 1 };
  const job = await service.generate(input);
  const ready = await settled(service, job.id);
  assert.equal(ready.status, 'ready', JSON.stringify(ready.error));
  const snapshot = await store.read();
  const pdf = snapshot.artifacts.find(a => a.jobId === job.id && a.kind === 'pdf');
  assert.ok(pdf);
  assert.equal(ready.artifactIds.length, 3);
  assert.ok(ready.validation.pdf.fonts.every(font => font.embedded));
  assert.ok(ready.validation.text.pages.some(page => page.text.includes('น้ำ')));
  assert.ok(JSON.stringify(ready.validation.pdf.links).includes('https://example.org/engineering-fixture'));
  assert.equal((await service.generate(input)).id, job.id);
  const rotated = await service.pdfOperation({ operationId: 'real-rotate-1', projectId: 'fixture-project', artifactId: pdf.id, expectedRevision: 1, operation: 'rotate', degrees: 90, pages: [1] });
  const derived = await settled(service, rotated.id);
  assert.equal(derived.status, 'ready', JSON.stringify(derived.error));
  assert.equal(derived.validation.pdf.pages[0].rotation, 90);
  assert.deepEqual((await store.read()).artifacts.find(a => a.jobId === derived.id && a.kind === 'pdf').parentArtifactIds, [pdf.id]);
  assert.equal((await service.download(pdf.id)).contentType, 'application/pdf');
  await store.transaction(s => { s.reports[0].revision++; s.reports[0].spec.sections[0].text = 'Missing private glyph \u{10FFFF}'; });
  const strict = await service.generate({ ...input, expectedRevision: 2, operationId: 'real-strict-failure' });
  const failed = await settled(service, strict.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'STRICT_EXPORT');
  assert.equal(failed.artifactIds.length, 0);
  // Both actual engine roots refuse a sibling path. This is a real tool error,
  // independently of the service's input path checks.
  const confined = join(root, 'confined'); await mkdir(confined);
  for (const [name, version, tool] of [['wordcraft', '0.18.1', 'open_document'], ['pdfcraft', '0.22.0', 'doc_open']]) {
    const session = await openSession({ engine: name, config: engine(name, version), root: confined });
    try { await assert.rejects(session.call(tool, { path: pdf.path }), e => e.code === 'ENGINE_FAILURE' && /root|access|outside/i.test(e.message)); }
    finally { assert.equal((await session.close()).confirmed, true); }
  }
  // Restore ordinary text, then use undecodable real image bytes. Strict checks
  // must refuse a missing picture instead of silently omitting the figure.
  const invalidImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'); await writeFile(join(workspace, 'fixture.png'), invalidImage);
  await store.transaction(s => {
    s.reports[0].revision++; s.reports[0].spec.sections[0].text = 'Ordinary source text';
    s.artifacts.find(a => a.id === 'fixture-image').revision = 2;
    s.artifacts.find(a => a.id === 'fixture-image').sha256 = sha256(invalidImage);
    s.reports[0].spec.sections[1].figure.revision = 2;
  });
  const imageJob = await service.generate({ ...input, expectedRevision: 3, operationId: 'real-image-failure' });
  const imageFailed = await settled(service, imageJob.id);
  assert.equal(imageFailed.status, 'failed'); assert.equal(imageFailed.error.code, 'STRICT_EXPORT');
  assert.ok(imageFailed.error.details.total_missing_pictures > 0);
  // Two concurrent real owned sessions: stopping one does not kill the other.
  await store.transaction(s => { s.reports[0].revision++; delete s.reports[0].spec.sections[1].figure; });
  const stopped = await service.generate({ ...input, expectedRevision: 4, operationId: 'real-stop' });
  const survivor = await service.generate({ ...input, expectedRevision: 4, operationId: 'real-survivor' });
  for (let n = 0; n < 200 && !(await service.getJob(stopped.id)).processes?.length; n++) await new Promise(r => setTimeout(r, 5));
  const cancelled = await service.stop(stopped.id);
  assert.equal(cancelled.status, 'interrupted', JSON.stringify(cancelled.error));
  assert.equal(cancelled.artifactIds.length, 0);
  assert.equal((await settled(service, survivor.id)).status, 'ready');
  const originalPDF = await readFile(pdf.path);
  await writeFile(pdf.path, '%PDF-1.7\ncorrupt');
  await assert.rejects(service.download(pdf.id), e => ['INVALID_OUTPUT', 'ARTIFACT_CHANGED'].includes(e.code));
  await writeFile(pdf.path, originalPDF);
  console.log(JSON.stringify({ evidence: 'REAL_RELEASED_WINDOWS_ENGINES', root, engines: ready.provenance.engines, outputHashes: snapshot.artifacts.filter(a => a.jobId === job.id).map(({ kind, sha256, size }) => ({ kind, sha256, size })), pages: ready.validation.pdf.pages.length, embeddedFonts: ready.validation.pdf.fonts, strictFailure: failed.error.code }));
});

test('REAL no-code Windows release acquisition, checksums, schema discovery, persistent rediscovery', { skip: process.env.FORGE_REPORT_ACQUIRE !== '1', timeout: 240000 }, async t => {
  const root = await mkdtemp(join(process.env.LOCALAPPDATA, 'FORGE/report-acquisition-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const store = await testStore(join(root, 'state.json'), fixtureState(workspace));
  const service = createReportService({ dataDir: root, store });
  t.after(async () => { await service.shutdown(); await store.close(); });
  await service.configure({ action: 'install', engine: 'wordcraft' });
  const health = await service.configure({ action: 'install', engine: 'pdfcraft' });
  assert.equal(health.ready, true);
  const rediscovered = await service.configure({ action: 'discover', engine: 'wordcraft' });
  assert.equal(rediscovered.ready, true);
  const restart = createReportService({ dataDir: root, store });
  assert.equal((await restart.health()).ready, true);
  console.log(JSON.stringify({ evidence: 'REAL_NO_CODE_ACQUISITION', root, versions: Object.fromEntries(Object.entries(health.engines).map(([name, value]) => [name, { version: value.identity.version, sha256: value.identity.binarySha256 }])) }));
});
