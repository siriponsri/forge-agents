import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createService, createReportService } from '../app/reports/service.mjs';
import { atomicJSON, sha256, unzip, checkedFile } from '../app/reports/files.mjs';

// All adapters/format payloads in this file are labelled lifecycle fixtures.
// They prove orchestration behavior only, never WordCraft/PdfCraft fidelity.
const INPUT = { operationId: 'fixture-op', projectId: 'p', reportId: 'r', expectedRevision: 1 };
const PDF = Buffer.from('%PDF-1.7\nLIFECYCLE_FIXTURE_NOT_REAL_PDF\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function crc(bytes) { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function fixtureDOCX() {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, text] of Object.entries({ '[Content_Types].xml': '<Types/>', '_rels/.rels': '<Relationships/>', 'word/document.xml': '<w:document>LIFECYCLE_FIXTURE</w:document>' })) {
    const key = Buffer.from(name), data = Buffer.from(text), head = Buffer.alloc(30), central = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc(data), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(key.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(key.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(head, key, data); directory.push(central, key); offset += head.length + key.length + data.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}
async function fixture(t, mode = {}) {
  const root = await mkdtemp(join(tmpdir(), 'forge-report-lifecycle-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const file = join(root, 'state.json');
  const initial = { revision: 1, projects: [{ id: 'p', workspace }], reports: [{ id: 'r', projectId: 'p', revision: 1, spec: {
    schemaVersion: 1, title: 'Lifecycle fixture', language: 'en', fontFamily: 'Fixture Font', template: { id: 'blank', version: 1 },
    sections: [{ heading: 'Section', text: 'Frozen source text' }], citations: [], inputs: [],
  } }], jobs: [], artifacts: [], receipts: [] };
  await atomicJSON(file, initial);
  let queue = Promise.resolve();
  const store = {
    async read() { return JSON.parse(await readFile(file, 'utf8')); },
    transaction(fn) {
      const result = queue.then(async () => { const state = await store.read(); const value = await fn(state); state.revision++; await atomicJSON(file, state); return value; });
      queue = result.catch(() => {}); return result;
    },
  };
  const counts = { starts: 0, closes: 0 }; const docs = new Map();
  const adapters = {
    probe: async () => ({ status: 'fixture', ready: true }),
    sessionFactory: async ({ engine, root, onSession, signal }) => {
      counts.starts++;
      if (mode.startFailure) throw Error('FIXTURE engine failed to launch');
      let text = docs.get(root) ?? '';
      let release;
      const session = {
        pid: null, identity: { name: `FIXTURE-${engine}`, version: 'fixture-only' },
        async close() { counts.closes++; release?.(); return { confirmed: !mode.unconfirmedStop }; },
        async execute(name, args) {
          if (name === 'font.list') return { families: mode.missingFont ? [] : ['Fixture Font'] };
          if (name === 'font.missing') return { missing: [] };
          if (name === 'file.strictReport') return { strict: 'passed' };
          if (name === 'file.exportPdf') {
            if (mode.hold) { mode.entered?.(); await new Promise(resolve => { release = resolve; }); signal.throwIfAborted(); }
            await writeFile(args.path, mode.corruptPDF ? '%PDF-partial' : PDF);
            if (mode.partialFailure) throw Error('FIXTURE export failed after partial write');
          }
          return {};
        },
        async call(name, args) {
          if (name === 'new_document') return { id: 1 };
          if (name === 'type_text') { text += args.text + ' '; docs.set(root, text); }
          if (name === 'insert_table') { text += args.values.flat().join(' '); docs.set(root, text); }
          if (name === 'inspect_document') return { text };
          if (name === 'open_document') return { id: 1 };
          if (name === 'save_document') await writeFile(args.path, mode.corruptDOCX ? 'PKbroken' : fixtureDOCX());
          if (name === 'doc_open') return { doc: 1, pages: 1 };
          if (name === 'doc_inspect') return { pages: [{ page: 1 }], fonts: [], repairs: [], unreadable_objects: [] };
          if (name === 'text_extract') return { pages: [{ page: 1, text: docs.get(root) ?? '' }] };
          if (name === 'render_preview') return { content: [{ type: 'image', mimeType: 'image/png', data: PNG.toString('base64') }] };
          return {};
        },
      };
      onSession(session); return session;
    },
  };
  const service = createService({ dataDir: root, store }, adapters);
  t.after(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }); });
  return { root, workspace, file, store, service, adapters, counts };
}
async function settled(service, id) {
  for (let n = 0; n < 500; n++) { const j = await service.getJob(id); if (['ready', 'failed', 'unknown', 'interrupted'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 5)); }
  throw Error('fixture timeout');
}

test('FIXTURE concurrent duplicate effects, immutable source revisions, conflict and persisted downloads', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.service.generate(INPUT), f.service.generate(INPUT)]);
  assert.equal(a.id, b.id);
  await f.store.transaction(s => { s.reports[0].revision = 2; s.reports[0].spec.sections[0].text = 'Newer text must remain'; });
  const j = await settled(f.service, a.id);
  assert.equal(j.status, 'ready', JSON.stringify(j.error)); assert.equal(j.sourceRevision, 1); assert.equal(f.counts.starts, 2);
  assert.equal((await f.store.read()).reports[0].spec.sections[0].text, 'Newer text must remain');
  await assert.rejects(f.service.generate({ ...INPUT, operationId: 'new-stale' }), e => e.code === 'REVISION_CONFLICT');
  await assert.rejects(f.service.generate({ ...INPUT, expectedRevision: 2 }), e => e.code === 'OPERATION_CONFLICT');
  const restarted = createService({ dataDir: f.root, store: f.store }, f.adapters);
  assert.equal((await restarted.generate(INPUT)).id, a.id); assert.equal(f.counts.starts, 2);
  assert.equal((await restarted.getJob(a.id)).artifactIds.length, 3);
  assert.ok((await restarted.download(j.artifactIds[0])).filename.endsWith('.docx'));
  const snapshot = await f.store.read();
  assert.equal(snapshot.jobs.length, 1); assert.equal(snapshot.artifacts.length, 3);
  assert.equal(snapshot.artifacts[0].sourceRevision, 1); assert.ok(snapshot.artifacts[0].sha256);
  await writeFile(snapshot.artifacts[0].path, 'bad');
  await assert.rejects(restarted.download(j.artifactIds[0]), e => ['INVALID_ARCHIVE', 'INVALID_OUTPUT'].includes(e.code));
});
for (const [name, mode, code] of [
  ['launch failure', { startFailure: true }, 'ENGINE_FAILURE'], ['missing font', { missingFont: true }, 'FONT_MISSING'],
  ['partial write and engine error', { partialFailure: true }, 'ENGINE_FAILURE'], ['corrupt PDF', { corruptPDF: true }, 'INVALID_OUTPUT'], ['corrupt DOCX', { corruptDOCX: true }, 'INVALID_ARCHIVE'],
]) test(`FIXTURE ${name}: no published artifact or duplicate retry effects`, async t => {
  const f = await fixture(t, mode); const a = await f.service.generate(INPUT); const j = await settled(f.service, a.id);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, code); assert.equal((await f.store.read()).artifacts.length, 0);
  const starts = f.counts.starts; assert.equal((await f.service.generate(INPUT)).id, a.id); assert.equal(f.counts.starts, starts);
  assert.deepEqual(await readdir(join(f.root, 'reports/published')), []);
});

for (const unconfirmed of [false, true]) test(`FIXTURE stop owned synchronous export, confirmed=${!unconfirmed}`, async t => {
  let entered; const waiting = new Promise(r => { entered = r; });
  const f = await fixture(t, { hold: true, entered, unconfirmedStop: unconfirmed });
  const job = await f.service.generate(INPUT); await waiting;
  const stopped = await f.service.stop(job.id);
  assert.equal(stopped.status, unconfirmed ? 'unknown' : 'interrupted');
  assert.equal((await f.store.read()).artifacts.length, 0); assert.ok(f.counts.closes > 0);
  assert.ok(stopped.stagedFiles.some(f => f.name === 'report.docx' && !f.published));
});

test('FIXTURE restart reconciles complete manifest once and never replays unknown mutation', async t => {
  const f = await fixture(t); const job = await f.service.generate(INPUT); const ready = await settled(f.service, job.id);
  assert.equal(ready.status, 'ready');
  // Simulate crash after immutable file publication but before authoritative state commit.
  await f.store.transaction(s => { s.artifacts = []; const j = s.jobs[0]; j.status = 'validating'; j.artifactIds = []; });
  const starts = f.counts.starts;
  const restart = createService({ dataDir: f.root, store: f.store }, f.adapters);
  assert.equal((await restart.getJob(job.id)).status, 'ready'); assert.equal((await f.store.read()).artifacts.length, 3); assert.equal(f.counts.starts, starts);
  await f.store.transaction(s => { s.jobs[0].status = 'rendering'; s.jobs[0].artifactIds = []; s.artifacts = []; });
  const state = await f.store.read(); await writeFile(state.jobs[0] ? join(f.root, 'reports/published', job.id, 'report.pdf') : '', 'corrupt');
  const unknown = createService({ dataDir: f.root, store: f.store }, f.adapters);
  const j = await unknown.getJob(job.id); assert.equal(j.status, 'unknown'); assert.equal(j.error.code, 'RESTART_OUTCOME_UNKNOWN');
  assert.equal((await unknown.generate(INPUT)).id, job.id); assert.equal(f.counts.starts, starts); assert.equal((await f.store.read()).artifacts.length, 0);
});

test('project scope, input revision, changed bytes and path escape are rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.generate({ ...INPUT, projectId: 'other' }), e => e.code === 'PROJECT_NOT_FOUND');
  await f.store.transaction(s => { s.reports[0].spec.inputs = [{ artifactId: 'outside', revision: 1 }]; s.artifacts.push({ id: 'outside', projectId: 'p', revision: 1, sha256: sha256(PDF), kind: 'pdf', path: join(f.root, 'outside.pdf') }); });
  await writeFile(join(f.root, 'outside.pdf'), PDF);
  const job = await f.service.generate(INPUT); const j = await settled(f.service, job.id); assert.equal(j.error.code, 'PATH_SCOPE'); assert.equal(f.counts.starts, 0);
  await assert.rejects(f.service.pdfOperation({ operationId: 'p1', projectId: 'p', artifactId: 'outside', expectedRevision: 0, operation: 'inspect' }), e => e.code === 'REVISION_CONFLICT');
  await assert.rejects(f.service.pdfOperation({ operationId: 'p2', projectId: 'p', artifactId: 'outside', expectedRevision: 1, operation: 'rotate', degrees: 42 }), e => e.code === 'PDF_OPERATION');
  await assert.rejects(checkedFile(f.workspace, join(f.root, 'outside.pdf')), e => e.code === 'PATH_SCOPE');
  // Junctions work without Developer Mode on Windows and exercise canonical confinement.
  const link = join(f.workspace, 'escape'); await symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(checkedFile(f.workspace, join(link, 'outside.pdf')), e => e.code === 'PATH_SCOPE');
  await rm(link, { recursive: false, force: true });
});

test('missing engine and corrupted local settings are actionable; settings can explicitly reset', async t => {
  const f = await fixture(t); const real = createReportService({ dataDir: f.root, store: f.store });
  const health = await real.health(); assert.equal(health.ready, false); assert.equal(health.engines.wordcraft.error.code, 'ENGINE_NOT_INSTALLED');
  const job = await real.generate(INPUT); const failed = await settled(real, job.id); assert.equal(failed.error.code, 'ENGINE_NOT_INSTALLED');
  await writeFile(join(f.root, 'reports/machine-settings.json'), 'broken');
  await assert.rejects(real.health(), e => e.code === 'ENGINE_CONFIG_CORRUPT');
  assert.equal((await real.configure({ action: 'reset' })).ready, false);
  await assert.rejects(real.configure({ wordcraft: { path: 'cmd.exe' } }), e => e.code === 'ENGINE_PATH');
  await assert.rejects(real.configure({ fonts: [{ family: 'Absent', paths: [join(f.root, 'missing-font.ttf')] }] }), e => e.code === 'FONT_MISSING');
  assert.equal((await f.store.read()).artifacts.length, 0);
});

test('bounded ZIP reader detects corrupted central directory, CRC and traversal', () => {
  assert.equal(unzip(fixtureDOCX()).size, 3);
  const crcBad = Buffer.from(fixtureDOCX()); crcBad[55] ^= 4;
  assert.throws(() => unzip(crcBad), e => e.code === 'INVALID_ARCHIVE');
  assert.throws(() => unzip(Buffer.from('PKpartial')), e => e.code === 'INVALID_ARCHIVE');
  const traversal = Buffer.from(fixtureDOCX()); const at = traversal.lastIndexOf(Buffer.from('word/document.xml')); Buffer.from('../x/document.xml').copy(traversal, at);
  assert.throws(() => unzip(traversal), e => e.code === 'INVALID_ARCHIVE');
});
