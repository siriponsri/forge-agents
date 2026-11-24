import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createArtifactService } from '../app/server/artifacts.mjs';
import { createStorageService } from '../app/storage/service.mjs';
import { createLocalAdapter } from '../app/storage/local.mjs';
import { hash, json } from '../app/storage/common.mjs';

const operationId = () => crypto.randomUUID();
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-storage-fixture-')), dataDir = path.join(root, 'state'), workspace = path.join(root, 'workspace'), directory = path.join(root, 'backups');
  let store = await openStore(dataDir);
  const project = (await command(store, { operationId: operationId(), type: 'project.create', data: { name: 'Disposable storage fixture', workspace } })).entity;
  const artifacts = createArtifactService({ store, dataDir });
  await mkdir(path.join(workspace, 'model'));
  await writeFile(path.join(workspace, 'model', 'weights.bin'), Buffer.from([0,1,2,3,255]));
  await writeFile(path.join(workspace, 'model', 'preprocess.json'), '{"scale":2}');
  await writeFile(path.join(workspace, 'report.txt'), 'สวัสดี FORGE\n');
  const model = await artifacts.register({ projectId: project.id, path: 'model/weights.bin', kind: 'model', source: { runId: 'original-run', attemptId: 'original-attempt', configRevision: 4, environmentRevision: 2 } });
  await store.transaction(s => { s.artifacts.find(a => a.id === model.id).companionFiles = [{ path: 'model/preprocess.json', sha256: hash('{"scale":2}') }]; });
  const report = await artifacts.register({ projectId: project.id, path: 'report.txt', kind: 'report' });
  const document = (await command(store, { operationId: operationId(), type: 'document.create', projectId: project.id, data: { name: 'Native document', kind: 'doc', snapshot: { text: 'เนื้อหา mixed English' } } })).entity;
  let service = await createStorageService({ dataDir, store, artifacts, ...options });
  const configured = await service.configure({ operationId: operationId(), projectId: project.id, expectedRevision: 1, destinations: [{ id: 'archive', name: 'Local archive', kind: 'local', directory }], routes: [{ kinds: ['*'], destinationIds: ['archive'] }], retention: { keepLast: 1 } });
  const adapter = await createLocalAdapter({ directory, workspace, dataDir });
  const input = () => ({ projectId: project.id, operationId: operationId(), destinationId: 'archive' });
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, dataDir, workspace, directory, project, model, report, document, artifacts, configured, adapter, input, get store() { return store; }, get service() { return service; }, async restart(opts = {}) {
    await store.close(); store = await openStore(dataDir);
    service = await createStorageService({ dataDir, store, artifacts: createArtifactService({ store, dataDir }), ...opts });
  } };
}
const assertAbsent = file => assert.rejects(access(file), { code: 'ENOENT' });

test('service shutdown interrupts staged transfer before publication and preserves resumable bytes',async t=>{
  let f,closing;
  f=await fixture(t,{transferHook:event=>{if(event.phase==='afterFile'&&!closing)closing=f.service.shutdown();}});
  const job=await f.service.backup(f.input());await closing;
  assert.equal(job.status,'interrupted');assert.equal(job.error.code,'INTERRUPTED');
  assert.equal((await f.service.status({projectId:f.project.id})).sync.archive.lastVerified??null,null);
  assert.ok(job.completedFiles.length>0);
  const key=`projects/${f.project.id}/bundles/${job.bundleId}/manifest.json`;assert.equal(await f.adapter.get(key),null);
  await f.restart();const resumed=await f.service.retry({...f.input(),jobId:job.id,mode:'resume'});assert.equal(resumed.status,'completed',JSON.stringify(resumed.error));
});

test('complete backup restores artifact/companion bytes, native content and lineage into an independent project after restart', async t => {
  const f = await fixture(t);
  await f.store.transaction(s => { s.settings.storageSecret = 'DO-NOT-EXPORT'; s.projects[0].profile.provider = { secretRef: 'env:PRIVATE', access_token: 'DO-NOT-EXPORT' }; });
  const request = f.input(), saved = await f.service.backup(request);
  assert.equal(saved.status, 'completed', JSON.stringify(saved.error));
  assert.equal(saved.totalFiles, 3);
  assert.equal((await f.service.backup(request)).id, saved.id);
  await assert.rejects(f.service.backup({ ...request, artifactIds: [f.model.id] }), { code: 'VALIDATION' });
  const manifestKey = `projects/${f.project.id}/bundles/${saved.bundleId}/manifest.json`;
  const manifestBytes = await f.adapter.get(manifestKey);
  assert.equal(hash(manifestBytes), saved.manifestSha256);
  assert.doesNotMatch(manifestBytes.toString(), /DO-NOT-EXPORT|PRIVATE|secretRef|access_token/);
  await f.restart();
  const target = path.join(f.root, 'recovered'), restored = await f.service.restore({ ...f.input(), bundleId: saved.bundleId, manifestSha256: saved.manifestSha256, targetDirectory: target, expectedRevision: 2 });
  assert.equal(restored.status, 'completed', JSON.stringify(restored.error));
  assert.equal(restored.filesRestored, 3);
  assert.deepEqual(await readFile(path.join(target, 'model', 'weights.bin')), Buffer.from([0,1,2,3,255]));
  assert.equal(await readFile(path.join(target, 'report.txt'), 'utf8'), 'สวัสดี FORGE\n');
  assert.equal(await readFile(path.join(target, 'model', 'preprocess.json'), 'utf8'), '{"scale":2}');
  const snapshot = f.store.read(), recovered = snapshot.projects.find(p => p.id === restored.restoredProjectId);
  assert.equal(recovered.workspace, target); assert.notEqual(recovered.id, f.project.id);
  const model = snapshot.artifacts.find(a => a.projectId === recovered.id && a.kind === 'model');
  assert.equal(model.lineage.originalArtifactId, f.model.id); assert.equal(model.lineage.runId, 'original-run');
  assert.equal(model.source.configRevision, 4); assert.equal(model.locations[0].kind, 'local');
  assert.equal(snapshot.documents.find(d => d.projectId === recovered.id).snapshot.text, 'เนื้อหา mixed English');
  const status = await f.service.status({ projectId: f.project.id });
  assert.equal(status.save.status, 'saved'); assert.equal(status.sync.archive.status, 'completed');
  assert.equal(status.git.commit.status, 'not_run'); assert.equal(status.git.push.status, 'not_run');
  assert.equal((await f.service.inspect(f.input())).heads.length, 1);
});

test('interrupted transfer persists staged work, resumes only verified files, and replay never dispatches effects again', async t => {
  let stop = true, uploads = [];
  const f = await fixture(t, { transferHook: async e => {
    if (e.phase === 'beforeFile') uploads.push(e.file);
    if (e.phase === 'afterFile' && stop) { stop = false; throw Object.assign(new Error('disconnected'), { code: 'INTERRUPTED' }); }
  } });
  const interrupted = await f.service.backup(f.input());
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.completedFiles.length, 1);
  assert.equal((await f.service.inspect(f.input())).token, null);
  await f.restart({ transferHook: async e => { if (e.phase === 'beforeFile') uploads.push(e.file); } });
  const retry = { ...f.input(), jobId: interrupted.id, mode: 'resume' }; delete retry.destinationId;
  const done = await f.service.retry(retry);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(done.id, interrupted.id); assert.equal(done.attempt, 2);
  assert.equal(uploads.filter(x => x === interrupted.completedFiles[0]).length, 1);
  const count = uploads.length;
  assert.equal((await f.service.retry(retry)).id, done.id); assert.equal(uploads.length, count);
  assert.equal(f.store.read().jobs.filter(j => j.kind === 'storage').length, 1);
});

test('source mutation during transfer rejects publication; restart captures a newly registered revision', async t => {
  let mutate = true;
  const f = await fixture(t, { transferHook: async e => {
    if (e.phase === 'afterFile' && mutate) { mutate = false; await writeFile(path.join(f.workspace, 'report.txt'), 'updated'); }
  } });
  const failed = await f.service.backup(f.input());
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'SOURCE_CHANGED'); assert.equal((await f.service.inspect(f.input())).token, null);
  assert.equal((await f.service.status({ projectId: f.project.id })).sync.archive.status, 'failed');
  // Retire an unavailable superseded revision explicitly; no backup silently skips it.
  await f.store.transaction(s => { s.artifacts = s.artifacts.filter(a => a.id !== f.report.id); });
  await f.artifacts.register({ projectId: f.project.id, path: 'report.txt', kind: 'report' });
  const done = await f.service.retry({ operationId: operationId(), projectId: f.project.id, jobId: failed.id, mode: 'restart' });
  assert.equal(done.status, 'completed'); assert.notEqual(done.bundleId, failed.bundleId);
});

test('destination changes require exact explicit conflict resolution and preserve both revision bundles', async t => {
  const f = await fixture(t), first = await f.service.backup(f.input());
  const baseline = f.store.read().projects[0].profile.storage.sync.archive;
  // Model a second installation with a previously observed destination baseline.
  await f.store.transaction(s => { s.projects[0].profile.storage.sync = {}; });
  const conflict = await f.service.backup(f.input());
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.error.code, 'DESTINATION_CONFLICT'); assert.equal(conflict.conflict.currentHead, baseline.head);
  assert.equal((await f.service.inspect(f.input())).commits.length, 1);
  const stale = await f.service.retry({ operationId: operationId(), projectId: f.project.id, jobId: conflict.id, mode: 'resume', resolution: { strategy: 'replace', expectedHead: '0'.repeat(64) } });
  assert.equal(stale.status, 'conflict');
  const done = await f.service.retry({ operationId: operationId(), projectId: f.project.id, jobId: conflict.id, mode: 'resume', resolution: { strategy: 'replace', expectedHead: baseline.head } });
  assert.equal(done.status, 'completed');
  const head = await f.service.inspect(f.input()); assert.equal(head.commits.length, 2); assert.equal(head.heads.length, 1);
  assert.ok(await f.adapter.get(`projects/${f.project.id}/bundles/${first.bundleId}/manifest.json`));
});

test('tampered artifact, manifest and malicious paths never alter a rejected restore destination', async t => {
  const f = await fixture(t), backup = await f.service.backup(f.input()), rootKey = `projects/${f.project.id}/bundles/${backup.bundleId}`;
  const target = path.join(f.root, 'must-stay-absent');
  const restore = () => f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: target, expectedRevision: 2 });
  const file = path.join(f.directory, ...`${rootKey}/files/report.txt`.split('/')), original = await readFile(file);
  await writeFile(file, 'tampered'); assert.equal((await restore()).error.code, 'INTEGRITY'); await assertAbsent(target);
  await writeFile(file, original);
  const manifestFile = path.join(f.directory, ...`${rootKey}/manifest.json`.split('/')), manifest = await readFile(manifestFile);
  await writeFile(manifestFile, 'invalid'); assert.equal((await restore()).error.code, 'INTEGRITY'); await assertAbsent(target);
  const hostile = JSON.parse(manifest); hostile.files[0].relative = '../outside.txt';
  await writeFile(manifestFile, json(hostile));
  const failed = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: hash(json(hostile)), targetDirectory: target, expectedRevision: 2 });
  assert.equal(failed.error.code, 'PATH_SCOPE'); await assertAbsent(target); await assertAbsent(path.join(f.root, 'outside.txt'));
  const crossProject = JSON.parse(manifest); crossProject.records.documents[0].snapshot.imageUrl = '/api/artifacts/foreign-project-artifact/download';
  await writeFile(manifestFile, json(crossProject));
  const resourceRejected = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: hash(json(crossProject)), targetDirectory: target, expectedRevision: 2 });
  assert.equal(resourceRejected.error.code, 'INTEGRITY'); await assertAbsent(target);
  await writeFile(manifestFile, manifest);
  const existing = path.join(f.root, 'existing'); await mkdir(existing); await writeFile(path.join(existing, 'precious.txt'), 'keep exactly');
  const rejection = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: existing, expectedRevision: 2 });
  assert.equal(rejection.error.code, 'DESTINATION_EXISTS'); assert.deepEqual(await readdir(existing), ['precious.txt']); assert.equal(await readFile(path.join(existing, 'precious.txt'), 'utf8'), 'keep exactly');
});

test('path confinement excludes credential files, Git internals, symlinks and unsafe restore roots', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.workspace, '.env'), 'secret fixture');
  await f.artifacts.register({ projectId: f.project.id, path: '.env' });
  assert.equal((await f.service.backup(f.input())).error.code, 'PATH_SCOPE');
  await f.store.transaction(s => { s.artifacts = s.artifacts.filter(a => a.name !== '.env'); });
  const external = path.join(f.root, 'external'); await mkdir(external); await writeFile(path.join(external, 'outside.txt'), 'outside');
  await symlink(external, path.join(f.workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await f.store.transaction(s => { s.artifacts[0].companionFiles = ['link/outside.txt']; });
  assert.equal((await f.service.backup(f.input())).error.code, 'PATH_SCOPE');
  await f.store.transaction(s => { s.artifacts[0].companionFiles = []; });
  const backup = await f.service.backup(f.input()); assert.equal(backup.status, 'completed');
  for (const target of [path.join(f.workspace, 'nested'), path.join(f.dataDir, 'nested'), path.join(f.directory, 'nested')]) {
    const rejected = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: target, expectedRevision: 2 });
    assert.equal(rejected.error.code, 'PATH_SCOPE'); await assertAbsent(target);
  }
  await assert.rejects(f.service.configure({ operationId: operationId(), projectId: f.project.id, expectedRevision: 2, destinations: [{ id: 'bad', name: 'Unsafe', kind: 'local', directory: f.workspace }] }), { code: 'PATH_SCOPE' });
});

test('retention is previewable, protects current/latest complete backup, and retained bytes still restore', async t => {
  const f = await fixture(t), first = await f.service.backup(f.input()), second = await f.service.backup(f.input()), sync = await f.service.sync(f.input());
  const preview = await f.service.retention({ ...f.input(), dryRun: true, keepLast: 1, expectedHead: sync.head });
  assert.equal(preview.status, 'completed'); assert.deepEqual(preview.candidates, [first.bundleId]); assert.deepEqual(preview.deletedBundleIds, []);
  assert.ok(await f.adapter.get(`projects/${f.project.id}/bundles/${first.bundleId}/manifest.json`));
  const cleaned = await f.service.retention({ ...f.input(), dryRun: false, keepLast: 1, expectedHead: sync.head });
  assert.equal(cleaned.status, 'completed'); assert.deepEqual(cleaned.deletedBundleIds, [first.bundleId]);
  assert.equal(await f.adapter.get(`projects/${f.project.id}/bundles/${first.bundleId}/manifest.json`), null);
  assert.ok(await f.adapter.get(`projects/${f.project.id}/bundles/${second.bundleId}/manifest.json`));
  assert.equal((await f.service.inspect(f.input())).commits.length, 3);
  const restored = await f.service.restore({ ...f.input(), bundleId: second.bundleId, manifestSha256: second.manifestSha256, targetDirectory: path.join(f.root, 'retained-restore'), expectedRevision: 2 });
  assert.equal(restored.status, 'completed');
});

test('routing keeps destination and Git outcomes independent and settings conflicts scoped', async t => {
  const f = await fixture(t), other = path.join(f.root, 'models');
  await f.service.configure({ operationId: operationId(), projectId: f.project.id, expectedRevision: 2, destinations: [{ id: 'archive', name: 'Reports', kind: 'local', directory: f.directory }, { id: 'models', name: 'Models', kind: 'local', directory: other }], routes: [{ kinds: ['model'], destinationIds: ['models'] }, { kinds: ['report'], destinationIds: ['archive'] }] });
  const { jobs } = await f.service.sync({ operationId: operationId(), projectId: f.project.id });
  assert.equal(jobs.length, 2); assert.ok(jobs.every(j => j.status === 'completed'));
  assert.equal(jobs.find(j => j.destinationId === 'archive').totalFiles, 1); assert.equal(jobs.find(j => j.destinationId === 'models').totalFiles, 2);
  await assert.rejects(f.service.configure({ operationId: operationId(), projectId: f.project.id, expectedRevision: 2, destinations: [] }), { code: 'REVISION_CONFLICT' });
  const state = await f.service.status({ projectId: f.project.id });
  assert.equal(state.sync.archive.status, 'completed'); assert.equal(state.sync.models.status, 'completed'); assert.equal(state.git.push.status, 'not_run');
});

test('native report-job-owned output and document artifact URLs restore without retaining live job bindings', async t => {
  const f = await fixture(t), jobId = crypto.randomUUID(), artifactId = crypto.randomUUID(), filename = 'native-report.pdf';
  const published = path.join(f.dataDir, 'reports', 'published', jobId); await mkdir(published, { recursive: true });
  const bytes = Buffer.from('%PDF-1.7\nfixture bytes\n%%EOF'); await writeFile(path.join(published, filename), bytes);
  await f.store.transaction(s => {
    s.jobs.push({ id: jobId, owner: 'reports', projectId: f.project.id, status: 'ready', artifactIds: [artifactId] });
    s.artifacts.push({ id: artifactId, projectId: f.project.id, jobId, filename, name: filename, path: path.join(published, filename), kind: 'pdf', sha256: hash(bytes), bytes: bytes.length, status: 'verified', revision: 1, lineage: { reportId: 'report-fixture', sourceRevision: 7 } });
    s.documents[0].snapshot.imageUrl = `/api/artifacts/${artifactId}/download`;
  });
  const backup = await f.service.backup(f.input()); assert.equal(backup.status, 'completed', JSON.stringify(backup.error));
  const target = path.join(f.root, 'native-report-restored');
  const restored = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: target, expectedRevision: 2 });
  assert.equal(restored.status, 'completed', JSON.stringify(restored.error));
  const snapshot = f.store.read(), artifact = snapshot.artifacts.find(a => a.projectId === restored.restoredProjectId && a.kind === 'pdf');
  assert.equal(artifact.jobId, undefined); assert.equal(artifact.lineage.originalJobId, jobId); assert.equal(artifact.lineage.sourceRevision, 7);
  assert.equal(artifact.restoredFrom.artifactId, artifactId); assert.deepEqual(await readFile(artifact.path), bytes);
  assert.equal(snapshot.documents.find(d => d.projectId === restored.restoredProjectId).snapshot.imageUrl, `/api/artifacts/${artifact.id}/download`);
  assert.equal(snapshot.jobs.filter(j => j.projectId === restored.restoredProjectId).length, 0);
});

test('interrupted restore resumes its own folder after process recovery and never imports duplicate records', async t => {
  const f = await fixture(t), backup = await f.service.backup(f.input());
  let interrupt = true;
  await f.restart({ transferHook: async e => { if (e.phase === 'afterRestoreFile' && interrupt) { interrupt = false; throw Object.assign(new Error('process interruption'), { code: 'INTERRUPTED' }); } } });
  const target = path.join(f.root, 'partially-restored');
  const first = await f.service.restore({ ...f.input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: target, expectedRevision: 2 });
  assert.equal(first.status, 'interrupted'); assert.equal(f.store.read().projects.length, 1);
  // Simulate process exit with a durable active reservation; initialization reconciles it as interrupted.
  await f.store.transaction(s => { s.jobs.find(j => j.id === first.id).status = 'publishing'; });
  await f.restart();
  assert.equal(f.store.read().jobs.find(j => j.id === first.id).status, 'interrupted');
  const retry = { operationId: operationId(), projectId: f.project.id, jobId: first.id, mode: 'resume' };
  const restored = await f.service.retry(retry); assert.equal(restored.status, 'completed', JSON.stringify(restored.error));
  assert.equal((await f.service.retry(retry)).restoredProjectId, restored.restoredProjectId);
  assert.equal(f.store.read().projects.length, 2); assert.equal(await readFile(path.join(target, 'report.txt'), 'utf8'), 'สวัสดี FORGE\n');
});

test('retention rejects corrupt retained revisions before deleting any older recoverable bytes', async t => {
  const f = await fixture(t), first = await f.service.backup(f.input()), latest = await f.service.backup(f.input());
  await writeFile(path.join(f.directory, 'projects', f.project.id, 'bundles', latest.bundleId, 'files', 'report.txt'), 'corrupt newest');
  const result = await f.service.retention({ ...f.input(), keepLast: 1, dryRun: false, expectedHead: latest.head });
  assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'INTEGRITY');
  assert.ok(await f.adapter.get(`projects/${f.project.id}/bundles/${first.bundleId}/manifest.json`));
  const restored = await f.service.restore({ ...f.input(), bundleId: first.bundleId, manifestSha256: first.manifestSha256, targetDirectory: path.join(f.root, 'older-valid-restore'), expectedRevision: 2 });
  assert.equal(restored.status, 'completed');
});

test('concurrent destination branches remain intact and explicit resolution joins their lineage', async t => {
  const f = await fixture(t), initial = await f.service.backup(f.input());
  const head = await f.service.inspect(f.input()), original = head.commits[0];
  const concurrent = { projectId: f.project.id, bundleId: crypto.randomUUID(), manifestSha256: initial.manifestSha256, parents: [], createdAt: new Date().toISOString(), action: 'backup' };
  const key = `projects/${f.project.id}/commits/${hash(json(concurrent))}.json`;
  await f.adapter.put(key, json(concurrent));
  const forked = await f.service.inspect(f.input()); assert.equal(forked.conflicted, true); assert.equal(forked.heads.length, 2);
  const rejected = await f.service.backup(f.input()); assert.equal(rejected.status, 'conflict');
  const merged = await f.service.retry({ operationId: operationId(), projectId: f.project.id, jobId: rejected.id, mode: 'resume', resolution: { strategy: 'replace', expectedHead: forked.token } });
  assert.equal(merged.status, 'completed', JSON.stringify(merged.error));
  const after = await f.service.inspect(f.input()); assert.equal(after.heads.length, 1); assert.equal(after.commits.length, 3);
  const merge = after.commits.find(c => c.bundleId === merged.bundleId); assert.deepEqual(merge.parents, forked.heads);
  assert.ok(await f.adapter.get(`projects/${f.project.id}/commits/${original.sha256}.json`)); assert.ok(await f.adapter.get(key));
});
