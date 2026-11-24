import { mkdir, readFile, writeFile, stat, lstat, realpath, copyFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { find, fail, revision, changed, entity, now } from '../server/domain.mjs';
import { hash, json, id, scoped, maybeRead, verify, inside, safeError } from './common.mjs';
import { createLocalAdapter } from './local.mjs';
import { createDriveAdapter } from './drive.mjs';
import { createDriveAuth } from './auth.mjs';
import { recordsFor, filePlan, sourceFingerprint, validateManifest, portableCollections, portable } from './bundle.mjs';

const ACTIVE = ['queued','running','validating','publishing'];
const rootSource = fileURLToPath(new URL('../../', import.meta.url));
const markerName = '.forge-storage-restore.json';
const optionKeys = new Set(['operationId','projectId','destinationId','artifactIds','resolution','jobId','mode','bundleId','manifestSha256','targetDirectory','expectedRevision','expectedHead','keepLast','dryRun']);
function validateInput(input) {
  if (!input || typeof input.operationId !== 'string' || !input.operationId.trim() || input.operationId.length > 200) fail('VALIDATION', 'operationId is required');
  for (const key of Object.keys(input)) if (!optionKeys.has(key)) fail('VALIDATION', `Unsupported storage parameter: ${key}`);
  if (input.artifactIds && (!Array.isArray(input.artifactIds) || input.artifactIds.some(x => typeof x !== 'string'))) fail('VALIDATION', 'artifactIds must be a list');
  if (input.resolution && (input.resolution.strategy !== 'replace' || !(input.resolution.expectedHead === null || /^[0-9a-f]{64}$/.test(input.resolution.expectedHead)))) fail('VALIDATION', 'Review the observed destination head before resolving');
}
const prefix = projectId => `projects/${id(projectId)}`;

// Append-only commits avoid destructive head replacement. Concurrent Drive writers can create a fork;
// readHead detects it, retains both bundles and requires an explicit merge acknowledgement.
async function readHead(adapter, projectId) {
  const keys = await adapter.list(`${prefix(projectId)}/commits`), commits = [];
  for (const key of keys) {
    const sha = /^([0-9a-f]{64})\.json$/.exec(key.split('/').at(-1))?.[1];
    if (!sha) fail('INTEGRITY', 'Invalid destination commit object', 409);
    const bytes = verify(await adapter.get(key), sha);
    const commit = JSON.parse(bytes);
    if (commit.projectId !== projectId || !Array.isArray(commit.parents) || !/^[0-9a-f]{64}$/.test(commit.manifestSha256)) fail('INTEGRITY', 'Invalid destination commit lineage', 409);
    id(commit.bundleId);
    commits.push({ ...commit, sha256: sha });
  }
  const ancestors = new Set(commits.flatMap(c => c.parents));
  const leaves = commits.filter(c => !ancestors.has(c.sha256)).map(c => c.sha256).sort();
  if (commits.length && !leaves.length) fail('INTEGRITY', 'Invalid destination commit graph', 409);
  return { token: leaves.length ? hash(json(leaves)) : null, heads: leaves, conflicted: leaves.length > 1, commits };
}
function acceptedHead(head, baseline, resolution) {
  if (resolution) {
    if (resolution.expectedHead !== head.token) fail('DESTINATION_CONFLICT', 'The destination changed again after review', 409, { currentHead: head.token, heads: head.heads });
  } else if (head.conflicted || baseline !== head.token) fail('DESTINATION_CONFLICT', 'Destination changed since last verified synchronization', 409, { currentHead: head.token, heads: head.heads });
}

export async function createStorageService({ dataDir, store, artifacts, vault, env, fetchImpl, wait, adapters = {}, transferHook } = {}) {
  if (!store || !dataDir || !artifacts) fail('VALIDATION', 'Storage requires the authoritative store, artifact service and data directory');
  const stageRoot = path.join(dataDir, 'storage', 'jobs');
  await mkdir(stageRoot, { recursive: true });
  const auth = createDriveAuth({ vault, env, fetchImpl }), inFlight = new Map();
  await store.transaction(s => {
    for (const j of s.jobs.filter(j => j.kind === 'storage' && ACTIVE.includes(j.status))) {
      j.status = 'interrupted'; j.error = safeError({ code: 'INTERRUPTED' }); j.updatedAt = now();
      s.events.push(entity({ type: 'storage.interrupted', jobId: j.id }, j.projectId));
    }
  });
  function config(projectId) {
    const project = find(store.read(), 'projects', projectId);
    return { project, storage: project.profile?.storage ?? {} };
  }
  function destination(projectId, destinationId) {
    const { project, storage } = config(projectId), found = storage.destinations?.find(d => d.id === destinationId);
    if (!found) fail('SETUP_REQUIRED', 'Configure the selected storage destination');
    return { project, storage, destination: found };
  }
  async function adapterFor(projectId, destinationId) {
    const target = destination(projectId, destinationId);
    if (adapters[destinationId]) return adapters[destinationId];
    return target.destination.kind === 'local'
      ? createLocalAdapter({ ...target.destination, workspace: target.project.workspace, dataDir })
      : createDriveAdapter({ ...target.destination, auth, fetchImpl, wait });
  }
  const jobFile = async (jobId, key, createParents = false) => {
    id(jobId); const root = path.join(stageRoot, jobId);
    await mkdir(root, { recursive: true });
    return scoped(root, key, { createParents });
  };
  async function update(jobId, patch) {
    return store.transaction(s => {
      const job = find(s, 'jobs', jobId);
      Object.assign(job, patch, { updatedAt: now() });
      s.events.push(entity({ type: `storage.${job.status}`, jobId, action: job.action, destinationId: job.destinationId }, job.projectId));
      return job;
    });
  }
  async function reserve(action, input, extra = {}) {
    validateInput(input); find(store.read(), 'projects', input.projectId);
    const fingerprint = hash(json({ action, input }));
    return store.transaction(s => {
      const prior = s.jobs.find(j => j.kind === 'storage' && j.operationId === input.operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Operation ID belongs to another storage request', 409);
        return { ...prior, replayed: true };
      }
      const job = entity({ kind: 'storage', action, operationId: input.operationId, fingerprint, request: structuredClone(input), status: 'queued', attempt: 1, completedFiles: [], ...extra }, input.projectId);
      s.jobs.push(job); s.events.push(entity({ type: 'storage.queued', jobId: job.id, action }, input.projectId));
      return job;
    });
  }
  async function guarded(job, work) {
    try { await update(job.id, { status: 'running', error: null }); return await work(); }
    catch (error) {
      const code = error.code;
      return update(job.id, { status: code === 'DESTINATION_CONFLICT' ? 'conflict' : code === 'INTERRUPTED' ? 'interrupted' : 'failed', error: safeError(error), ...(code === 'DESTINATION_CONFLICT' ? { conflict: { currentHead: error.details?.currentHead ?? null, heads: error.details?.heads ?? [] } } : {}) });
    }
  }
  async function single(jobId, fn) {
    if (inFlight.has(jobId)) return inFlight.get(jobId);
    const run = fn(); inFlight.set(jobId, run);
    try { return await run; } finally { inFlight.delete(jobId); }
  }
  async function runTransfer(initial, resume = false) {
    return single(initial.id, () => guarded(initial, async () => {
      let job = find(store.read(), 'jobs', initial.id), adapter = await adapterFor(job.projectId, job.destinationId);
      if (hash(json(destination(job.projectId, job.destinationId).destination)) !== job.destinationFingerprint) fail('SOURCE_CHANGED', 'Destination configuration changed; restart transfer', 409);
      let manifest;
      const manifestPath = await jobFile(job.id, 'manifest.json', true);
      if (resume && await maybeRead(manifestPath)) {
        manifest = JSON.parse(await readFile(manifestPath));
        if (hash(json(manifest)) !== job.manifestSha256) fail('INTEGRITY', 'Staged manifest changed', 409);
      } else {
        const snapshot = store.read(), plan = await filePlan(snapshot, job.projectId, job.artifactIds, { dataDir }), records = recordsFor(snapshot, job.projectId, job.artifactIds);
        manifest = { format: 'forge.project-bundle.v1', bundleId: job.bundleId, projectId: job.projectId, createdAt: now(), completeProject: job.action === 'backup', scope: 'Registered artifact and companion files, native project records. Unregistered workspace files, credentials, connections, machine settings and execution sessions excluded.', sourceFingerprint: sourceFingerprint(snapshot, job.projectId, job.artifactIds), records, files: plan.files.map(({source,...f}) => f), bindings: plan.bindings };
        for (const f of plan.files) {
          const file = await jobFile(job.id, `files/${f.relative}`, true), bytes = verify(await readFile(f.source), f.sha256, f.bytes);
          await writeFile(file, bytes); verify(await readFile(file), f.sha256, f.bytes);
        }
        await writeFile(manifestPath, json(manifest));
        job = await update(job.id, { manifestSha256: hash(json(manifest)), sourceFingerprint: manifest.sourceFingerprint, totalFiles: manifest.files.length, totalBytes: manifest.files.reduce((sum,f) => sum + f.bytes, 0) });
      }
      const head = await readHead(adapter, job.projectId);
      // A crash after append but before recording success can reconcile this exact immutable commit.
      const published = head.commits.find(c => c.bundleId === job.bundleId && c.manifestSha256 === job.manifestSha256);
      if (!published) acceptedHead(head, job.baseHead, job.request.resolution);
      const objectRoot = `${prefix(job.projectId)}/bundles/${job.bundleId}`;
      for (const f of manifest.files) {
        const bytes = verify(await readFile(await jobFile(job.id, `files/${f.relative}`)), f.sha256, f.bytes), key = `${objectRoot}/files/${f.relative}`;
        // Never trust a durable progress flag: verify the actual destination on every resumed file.
        const existing = await adapter.get(key);
        if (existing) verify(existing, f.sha256, f.bytes);
        else { await transferHook?.({ phase: 'beforeFile', jobId: job.id, file: f.relative }); await adapter.put(key, bytes); }
        verify(await adapter.get(key), f.sha256, f.bytes);
        const current = find(store.read(), 'jobs', job.id);
        if (!current.completedFiles.includes(f.relative)) await update(job.id, { completedFiles: [...current.completedFiles, f.relative] });
        await transferHook?.({ phase: 'afterFile', jobId: job.id, file: f.relative });
      }
      await update(job.id, { status: 'validating' });
      if (sourceFingerprint(store.read(), job.projectId, job.artifactIds) !== manifest.sourceFingerprint) fail('SOURCE_CHANGED', 'Project revision changed; restart to capture it', 409);
      if (hash(json(destination(job.projectId, job.destinationId).destination)) !== job.destinationFingerprint) fail('SOURCE_CHANGED', 'Destination configuration changed during transfer', 409);
      let livePlan;
      try { livePlan = await filePlan(store.read(), job.projectId, job.artifactIds, { dataDir }); }
      catch (e) { if (e.code === 'INTEGRITY' || e.code === 'ENOENT') fail('SOURCE_CHANGED', 'Source bytes changed or disappeared during transfer', 409); throw e; }
      if (hash(json(livePlan.files.map(({source,...f}) => f))) !== hash(json(manifest.files))) fail('SOURCE_CHANGED', 'Project bytes changed; restart to capture them', 409);
      await adapter.put(`${objectRoot}/manifest.json`, json(manifest));
      verify(await adapter.get(`${objectRoot}/manifest.json`), job.manifestSha256);
      let commit = published;
      if (!commit) {
        const latest = await readHead(adapter, job.projectId);
        acceptedHead(latest, job.baseHead, job.request.resolution);
        const content = { projectId: job.projectId, bundleId: job.bundleId, manifestSha256: job.manifestSha256, parents: latest.heads, createdAt: now(), action: job.action };
        const sha256 = hash(json(content));
        await update(job.id, { status: 'publishing' });
        await adapter.put(`${prefix(job.projectId)}/commits/${sha256}.json`, json(content));
        commit = { ...content, sha256 };
      }
      const finalHead = await readHead(adapter, job.projectId);
      if (finalHead.conflicted || !finalHead.heads.includes(commit.sha256)) fail('DESTINATION_CONFLICT', 'Concurrent transfer created a fork. Both revisions are retained for review.', 409, { currentHead: finalHead.token, heads: finalHead.heads });
      return store.transaction(s => {
        const live = find(s, 'jobs', job.id), project = find(s, 'projects', job.projectId);
        const storage = project.profile.storage;
        if (hash(json(storage.destinations.find(d => d.id === job.destinationId))) !== job.destinationFingerprint) fail('SOURCE_CHANGED', 'Destination configuration changed before recording verification', 409);
        storage.sync ??= {}; storage.sync[job.destinationId] = { status: 'completed', bundleId: job.bundleId, head: finalHead.token, manifestSha256: job.manifestSha256, verifiedAt: now(), jobId: job.id };
        for (const a of s.artifacts.filter(a => a.projectId === job.projectId && manifest.records.artifacts.some(x => x.id === a.id && x.sha256 === a.sha256))) {
          a.locations ??= [];
          a.locations.push({ kind: destination(job.projectId, job.destinationId).destination.kind, destinationId: job.destinationId, bundleId: job.bundleId, manifestSha256: job.manifestSha256, verifiedAt: now() });
        }
        Object.assign(live, { status: 'completed', head: finalHead.token, commitSha256: commit.sha256, scope: manifest.scope, finishedAt: now(), updatedAt: now() });
        s.events.push(entity({ type: 'storage.completed', jobId: job.id, destinationId: job.destinationId, bundleId: job.bundleId }, job.projectId));
        return live;
      });
    }));
  }
  async function transfer(action, input) {
    validateInput(input);
    if (action === 'backup' && input.artifactIds) fail('VALIDATION', 'Complete backups always include every registered artifact');
    const { project, storage } = config(input.projectId);
    if (!input.destinationId) {
      const selected = store.read().artifacts.filter(a => a.projectId === input.projectId && (!input.artifactIds || input.artifactIds.includes(a.id)));
      const targets = new Set(selected.flatMap(a => (storage.routes ?? []).filter(r => r.kinds.includes('*') || r.kinds.includes(a.kind)).flatMap(r => r.destinationIds)));
      if (action === 'backup') for (const d of storage.destinations ?? []) targets.add(d.id);
      if (!targets.size) fail('SETUP_REQUIRED', 'Select a destination or configure artifact routes');
      const jobs = [];
      for (const destinationId of targets) {
        const artifactIds = action === 'backup' ? undefined : selected.filter(a => (storage.routes ?? []).some(r => r.destinationIds.includes(destinationId) && (r.kinds.includes('*') || r.kinds.includes(a.kind)))).map(a => a.id);
        jobs.push(await transfer(action, { ...input, operationId: `${input.operationId}:${destinationId}`, destinationId, ...(artifactIds ? { artifactIds } : {}) }));
      }
      return { jobs }; // Every destination has its own result; aggregate success is never inferred.
    }
    const target = destination(project.id, input.destinationId);
    const job = await reserve(action, input, { destinationId: input.destinationId, destinationFingerprint: hash(json(target.destination)), artifactIds: input.artifactIds, baseHead: storage.sync?.[input.destinationId]?.head ?? null, bundleId: randomUUID() });
    if (job.replayed) return job;
    return runTransfer(job);
  }
  async function restoreTarget(input) {
    if (typeof input.targetDirectory !== 'string' || !path.isAbsolute(input.targetDirectory)) fail('VALIDATION', 'Select a new absolute restore folder');
    const parent = await realpath(path.dirname(input.targetDirectory)), target = path.join(parent, path.basename(input.targetDirectory));
    for (const forbidden of [dataDir, rootSource, ...store.read().projects.map(p => p.workspace)]) {
      const root = await realpath(forbidden);
      if (inside(root, target) || inside(target, root)) fail('PATH_SCOPE', 'Restore folder must be separate from existing projects and FORGE state/source', 403);
    }
    for (const d of config(input.projectId).storage.destinations ?? []) if (d.kind === 'local') {
      const root = await realpath(d.directory);
      if (inside(root, target) || inside(target, root)) fail('PATH_SCOPE', 'Restore folder must be separate from storage destinations', 403);
    }
    return target;
  }
  async function runRestore(initial, resume = false) {
    return single(initial.id, () => guarded(initial, async () => {
      const job = find(store.read(), 'jobs', initial.id), input = job.request;
      revision(config(job.projectId).project, input.expectedRevision);
      const target = await restoreTarget(input), adapter = await adapterFor(job.projectId, job.destinationId);
      const root = `${prefix(job.projectId)}/bundles/${id(input.bundleId)}`;
      const bytes = await adapter.get(`${root}/manifest.json`), manifest = validateManifest(bytes, input.manifestSha256);
      if (manifest.projectId !== job.projectId || manifest.bundleId !== input.bundleId) fail('INTEGRITY', 'Backup identity does not match selection', 409);
      const existing = await lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (existing) {
        const markerFile = path.join(target, markerName);
        const markerInfo = !existing.isSymbolicLink() && existing.isDirectory() ? await lstat(markerFile).catch(e => { if (e.code !== 'ENOENT') throw e; return null; }) : null;
        const marker = markerInfo?.isFile() && !markerInfo.isSymbolicLink() ? await maybeRead(markerFile) : null;
        if (!resume || !marker || JSON.parse(marker).jobId !== job.id || JSON.parse(marker).manifestSha256 !== input.manifestSha256) fail('DESTINATION_EXISTS', 'Choose a new restore folder', 409);
      }
      for (const f of manifest.files) {
        const staged = await jobFile(job.id, `restore/${f.relative}`, true), previous = await maybeRead(staged);
        if (previous) verify(previous, f.sha256, f.bytes);
        else await writeFile(staged, verify(await adapter.get(`${root}/files/${f.relative}`), f.sha256, f.bytes), { flag: 'wx' });
        verify(await readFile(staged), f.sha256, f.bytes);
      }
      await transferHook?.({ phase: 'beforeRestorePublish', jobId: job.id });
      revision(config(job.projectId).project, input.expectedRevision);
      await update(job.id, { status: 'publishing', restoredProjectId: job.restoredProjectId ?? randomUUID(), manifestSha256: input.manifestSha256 });
      if (!existing) {
        try { await mkdir(target); } catch (e) { if (e.code === 'EEXIST') fail('DESTINATION_EXISTS', 'Restore folder was created by another writer', 409); throw e; }
        await writeFile(path.join(target, markerName), json({ jobId: job.id, manifestSha256: input.manifestSha256 }), { flag: 'wx' });
      }
      for (const f of manifest.files) {
        if (f.relative.toLowerCase() === markerName) fail('PATH_SCOPE', 'Reserved restore marker path', 403);
        const file = await scoped(target, f.relative, { createParents: true }), prior = await maybeRead(file);
        if (prior) verify(prior, f.sha256, f.bytes);
        else await copyFile(await jobFile(job.id, `restore/${f.relative}`), file, constants.COPYFILE_EXCL);
        verify(await readFile(file), f.sha256, f.bytes);
        await transferHook?.({ phase: 'afterRestoreFile', jobId: job.id, file: f.relative });
      }
      const result = await store.transaction(s => {
        revision(find(s, 'projects', job.projectId), input.expectedRevision);
        const live = find(s, 'jobs', job.id), projectId = live.restoredProjectId;
        if (s.projects.some(p => p.workspace.toLowerCase() === target.toLowerCase())) fail('DESTINATION_EXISTS', 'A project already owns this folder', 409);
        const mapping = new Map([[manifest.records.project.id, projectId]]);
        for (const key of portableCollections) for (const x of manifest.records[key]) mapping.set(x.id, randomUUID());
        function remap(value, key = '') {
          if (Array.isArray(value)) return value.map(v => remap(v, key));
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, k === 'lineage' || k === 'source' ? portable(v) : remap(v, k)]));
          if (typeof value !== 'string') return value;
          if (key === 'id' || key.endsWith('Id') || key.endsWith('Ids')) return mapping.get(value) ?? value;
          return value.replace(/\/api\/artifacts\/([a-zA-Z0-9_-]+)\/download/g, (url, artifactId) => mapping.has(artifactId) ? `/api/artifacts/${mapping.get(artifactId)}/download` : url);
        }
        const project = { ...portable(manifest.records.project), id: projectId, workspace: target, name: `${manifest.records.project.name} (restored)`, profile: { storage: { kind: 'local' } }, revision: 1, createdAt: now(), updatedAt: now(), restoredFrom: { projectId: job.projectId, bundleId: input.bundleId, manifestSha256: input.manifestSha256 } };
        s.projects.push(project);
        for (const key of portableCollections) for (const record of manifest.records[key]) {
          const x = { ...remap(portable(record)), projectId, revision: 1, restoredAt: now() };
          if (key === 'artifacts') {
            const binding = manifest.bindings.find(b => b.artifactId === record.id && b.primary);
            x.path = path.join(target, ...binding.relative.split('/'));
            delete x.jobId;
            x.restoredFrom = { projectId: job.projectId, artifactId: record.id, bundleId: input.bundleId, manifestSha256: input.manifestSha256 };
            x.companionFiles = manifest.bindings.filter(b => b.artifactId === record.id && !b.primary).map(b => path.join(target, ...b.relative.split('/')));
            x.status = 'verified'; x.locations = [{ kind: 'local', path: x.path, verifiedAt: now(), restoredFrom: input.bundleId }];
          }
          s[key].push(x);
        }
        Object.assign(live, { status: 'completed', restoredProjectId: projectId, targetDirectory: target, filesRestored: manifest.files.length, bytesRestored: manifest.files.reduce((n,f) => n + f.bytes, 0), finishedAt: now(), updatedAt: now(), scope: manifest.scope });
        s.events.push(entity({ type: 'storage.restored', jobId: job.id, restoredProjectId: projectId, bundleId: input.bundleId }, job.projectId));
        return live;
      });
      // Receipt remains in the restored folder for provenance and crash recovery; it contains no credentials.
      return result;
    }));
  }
  const service = {
    async configure(input) {
      const { project } = config(input.projectId);
      if (!input.operationId || !Array.isArray(input.destinations) || !Array.isArray(input.routes ?? [])) fail('VALIDATION', 'Select storage destinations and routes');
      const destinations = [];
      for (const d of input.destinations) {
        id(d.id);
        if (destinations.some(x => x.id === d.id)) fail('VALIDATION', 'Destination IDs must be unique');
        if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 120) fail('VALIDATION', 'Name each destination');
        if (d.kind === 'local') {
          await createLocalAdapter({ directory: d.directory, workspace: project.workspace, dataDir });
          destinations.push({ id: d.id, name: d.name, kind: 'local', directory: d.directory });
        } else if (d.kind === 'drive') {
          if (!/^(env|vault):[A-Za-z0-9_-]{1,100}$/.test(d.secretRef ?? '')) fail('VALIDATION', 'Select a machine-local Drive credential reference');
          createDriveAdapter({ ...d, auth });
          destinations.push({ id: d.id, name: d.name, kind: 'drive', folderId: d.folderId, secretRef: d.secretRef });
        } else fail('VALIDATION', 'Select local or Google Drive; project Git is configured independently');
      }
      const routes = (input.routes ?? []).map(r => {
        if (!Array.isArray(r.kinds) || !r.kinds.length || r.kinds.some(k => typeof k !== 'string' || k.length > 100) || !Array.isArray(r.destinationIds) || r.destinationIds.some(x => !destinations.some(d => d.id === x))) fail('VALIDATION', 'Choose valid artifact kinds and destinations');
        return { kinds: r.kinds, destinationIds: r.destinationIds };
      });
      const keepLast = input.retention?.keepLast ?? 5;
      if (!Number.isInteger(keepLast) || keepLast < 1 || keepLast > 10000) fail('VALIDATION', 'Retention must keep at least one revision');
      const fingerprint = hash(json({ ...input, destinations, routes }));
      return store.transaction(s => {
        const receipt = s.receipts.find(r => r.operationId === input.operationId);
        if (receipt) { if (receipt.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Storage settings operation ID was reused', 409); return receipt.result; }
        const live = find(s, 'projects', project.id); revision(live, input.expectedRevision);
        const previous = live.profile?.storage ?? {};
        const sync = Object.fromEntries(Object.entries(previous.sync ?? {}).filter(([key]) => hash(json(previous.destinations?.find(d => d.id === key) ?? null)) === hash(json(destinations.find(d => d.id === key) ?? null))));
        live.profile ??= {}; live.profile.storage = { ...previous, destinations, routes, retention: { keepLast }, sync }; changed(live);
        const result = { projectId: live.id, revision: live.revision, storage: live.profile.storage };
        s.receipts.push({ operationId: input.operationId, fingerprint, result });
        s.events.push(entity({ type: 'storage.configured', destinationIds: destinations.map(d => d.id) }, project.id)); return result;
      });
    },
    async health({ projectId, destinationId }) {
      try { return await (await adapterFor(projectId, destinationId)).health(); }
      catch (e) { return { status: 'setup_required', kind: destination(projectId, destinationId).destination.kind, error: safeError(e) }; }
    },
    sync: input => transfer('sync', input),
    backup: input => transfer('backup', input),
    async status({ projectId }) {
      const { project, storage } = config(projectId), snapshot = store.read();
      const jobs = snapshot.jobs.filter(j => j.kind === 'storage' && j.projectId === projectId);
      const sync = Object.fromEntries((storage.destinations ?? []).map(d => {
        const latest = jobs.filter(j => j.destinationId === d.id && ['sync','backup'].includes(j.action)).at(-1);
        return [d.id, { ...storage.sync?.[d.id], status: latest?.status ?? 'not_run', jobId: latest?.id, error: latest?.error ?? null, lastVerified: storage.sync?.[d.id] ?? null }];
      }));
      return { projectId, save: { status: 'saved', projectRevision: project.revision, stateRevision: snapshot.revision }, sync, destinations: storage.destinations ?? [], routes: storage.routes ?? [], retention: storage.retention ?? { keepLast: 5 }, jobs, git: { commit: snapshot.events.filter(e => e.type === 'storage.git' && e.projectId === projectId && e.action === 'commit').at(-1) ?? { status: 'not_run' }, push: snapshot.events.filter(e => e.type === 'storage.git' && e.projectId === projectId && e.action === 'push').at(-1) ?? { status: 'not_run' } } };
    },
    async inspect({ projectId, destinationId }) { return readHead(await adapterFor(projectId, destinationId), projectId); },
    async retry(input) {
      validateInput(input); const previous = find(store.read(), 'jobs', input.jobId, input.projectId);
      if (previous.kind !== 'storage' || !['sync','backup','restore'].includes(previous.action)) fail('VALIDATION', 'Select a storage transfer or restore job');
      if (!['resume','restart'].includes(input.mode)) fail('VALIDATION', 'Choose resume or restart');
      if (ACTIVE.includes(previous.status) || inFlight.has(previous.id)) fail('JOB_ACTIVE', 'This transfer is active', 409);
      if (previous.status === 'completed') return previous;
      if (input.mode === 'restart') {
        if (previous.action === 'restore') return service.restore({ ...previous.request, operationId: input.operationId, ...(input.targetDirectory ? { targetDirectory: input.targetDirectory } : {}), ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}) });
        return transfer(previous.action, { ...previous.request, operationId: input.operationId, ...(input.resolution ? { resolution: input.resolution } : {}) });
      }
      const fingerprint = hash(json(input));
      const job = await store.transaction(s => {
        const receipt = s.receipts.find(r => r.operationId === input.operationId);
        if (receipt) { if (receipt.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Retry operation ID was reused', 409); return { ...find(s, 'jobs', receipt.jobId), replayed: true }; }
        const live = find(s, 'jobs', previous.id); live.attempt++; live.status = 'queued';
        if (input.resolution) live.request.resolution = input.resolution;
        if (live.action === 'restore' && input.expectedRevision !== undefined) live.request.expectedRevision = input.expectedRevision;
        s.receipts.push({ operationId: input.operationId, fingerprint, jobId: live.id }); return live;
      });
      if (job.replayed) return job;
      return job.action === 'restore' ? runRestore(job, true) : runTransfer(job, true);
    },
    async restore(input) {
      validateInput(input); id(input.bundleId);
      if (!/^[0-9a-f]{64}$/.test(input.manifestSha256)) fail('VALIDATION', 'Select the verified manifest checksum');
      destination(input.projectId, input.destinationId);
      const job = await reserve('restore', input, { destinationId: input.destinationId });
      if (job.replayed) return job;
      return runRestore(job);
    },
    async retention(input) {
      validateInput(input);
      const { storage } = config(input.projectId), keepLast = input.keepLast ?? storage.retention?.keepLast ?? 5;
      if (!Number.isInteger(keepLast) || keepLast < 1 || keepLast > 10000) fail('VALIDATION', 'Keep at least one revision');
      const job = await reserve('retention', input, { destinationId: input.destinationId });
      if (job.replayed) return job;
      return guarded(job, async () => {
        const adapter = await adapterFor(input.projectId, input.destinationId), head = await readHead(adapter, input.projectId);
        // Never delete from an ambiguous branch, even when acknowledged; first create an explicitly merged backup.
        if (head.conflicted) fail('DESTINATION_CONFLICT', 'Resolve destination forks before retention', 409, { currentHead: head.token, heads: head.heads });
        acceptedHead(head, storage.sync?.[input.destinationId]?.head ?? null, input.expectedHead !== undefined ? { strategy: 'replace', expectedHead: input.expectedHead } : input.resolution);
        const active = store.read().jobs.filter(j => j.kind === 'storage' && j.projectId === input.projectId && j.destinationId === input.destinationId && j.action === 'restore' && j.status !== 'completed').map(j => j.request.bundleId);
        const present = [];
        for (const c of head.commits) if (await adapter.get(`${prefix(input.projectId)}/bundles/${c.bundleId}/manifest.json`)) present.push(c);
        present.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.bundleId.localeCompare(a.bundleId));
        const protectedIds = new Set([...present.slice(0, keepLast).map(c => c.bundleId), ...head.commits.filter(c => head.heads.includes(c.sha256)).map(c => c.bundleId), ...active]);
        // Always retain a complete project backup even when newer artifact-only syncs exist.
        const latestBackup = present.find(c => c.action === 'backup'); if (latestBackup) protectedIds.add(latestBackup.bundleId);
        const candidates = present.filter(c => !protectedIds.has(c.bundleId)).map(c => c.bundleId);
        await update(job.id, { candidates, protectedBundleIds: [...protectedIds], dryRun: input.dryRun !== false });
        if (input.dryRun === false) {
          // Do not prune older recoverable bytes until every protected revision has been verified again.
          for (const c of present.filter(c => protectedIds.has(c.bundleId))) {
            const root = `${prefix(input.projectId)}/bundles/${c.bundleId}`;
            const bytes = verify(await adapter.get(`${root}/manifest.json`), c.manifestSha256);
            const manifest = JSON.parse(bytes);
            if (!Array.isArray(manifest.files)) fail('INTEGRITY', 'Retained manifest is invalid', 409);
            for (const f of manifest.files) verify(await adapter.get(`${root}/files/${f.relative}`), f.sha256, f.bytes);
          }
          const latest = await readHead(adapter, input.projectId);
          if (latest.token !== head.token) fail('DESTINATION_CONFLICT', 'Destination changed before retention', 409, { currentHead: latest.token, heads: latest.heads });
          for (const bundleId of candidates) {
            const keys = await adapter.list(`${prefix(input.projectId)}/bundles/${bundleId}`);
            // Commit lineage is retained. Remove manifest last; a deleted backup is never advertised as restorable.
            keys.sort((a,b) => Number(a.endsWith('/manifest.json')) - Number(b.endsWith('/manifest.json')));
            for (const key of keys) await adapter.delete(key);
          }
        }
        return update(job.id, { status: 'completed', deletedBundleIds: input.dryRun === false ? candidates : [], finishedAt: now() });
      });
    },
    beginDriveAuth: input => auth.begin(input),
    finishDriveAuth: input => auth.finish(input),
    async listDriveFolders(input) { return (await adapterFor(input.projectId, input.destinationId)).folders(); },
    async createDriveFolder(input) { return (await adapterFor(input.projectId, input.destinationId)).createFolder(input.name); },
  };
  return service;
}
