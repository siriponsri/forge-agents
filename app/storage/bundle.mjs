import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { find, fail } from '../server/domain.mjs';
import { json, hash, safeRelative, scoped, inside, verify } from './common.mjs';

export const portableCollections = ['bots','conversations','plans','phases','tasks','documents','reports','notebooks','artifacts'];
const secretKey = /^(?:access_?token|refresh_?token|client_?secret|api_?key|authorization|password|credentials?|secretRef|sessionId|providerSessionId|cookies?|headers|env|environment)$/i;
export function portable(value) {
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !secretKey.test(k) && !['__proto__','constructor','prototype'].includes(k)).map(([k,v]) => [k, portable(v)]));
  if (typeof value === 'string' && /^(?:env|vault):/.test(value)) return '[machine binding excluded]';
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    try { const url = new URL(value); if (url.username || url.password || [...url.searchParams.keys()].some(k => /token|key|secret|signature|credential/i.test(k))) return '[authenticated URL excluded]'; } catch {}
  }
  return value;
}
export function recordsFor(snapshot, projectId, artifactIds) {
  const project = find(snapshot, 'projects', projectId);
  const records = { project: { id: project.id, name: project.name, description: project.description, createdAt: project.createdAt }, ...Object.fromEntries(portableCollections.map(k => [k, snapshot[k].filter(x => x.projectId === projectId && (k !== 'artifacts' || !artifactIds || artifactIds.includes(x.id))).map(x => {
    const copy = structuredClone(x);
    if (k === 'artifacts') {
      delete copy.path; delete copy.locations; delete copy.companionFiles;
      // Saved run IDs/revisions are provenance, never reattached to a live execution on import.
      copy.lineage = { ...x.lineage, originalArtifactId: x.id, originalJobId: x.jobId ?? null, runId: x.runId ?? x.source?.runId ?? null, attemptId: x.attemptId ?? x.source?.attemptId ?? null, source: x.source ?? null };
    }
    if (k === 'tasks') { copy.originalRunIds = copy.runIds ?? []; copy.runIds = []; }
    return portable(copy);
  })])) };
  return records;
}
export async function filePlan(snapshot, projectId, artifactIds, { dataDir } = {}) {
  const project = find(snapshot, 'projects', projectId), workspace = await realpath(project.workspace), files = new Map(), bindings = [];
  for (const artifact of snapshot.artifacts.filter(a => a.projectId === projectId && (!artifactIds || artifactIds.includes(a.id)))) {
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '') || artifact.status !== 'verified') fail('INTEGRITY', 'Every artifact must have a verified recorded checksum', 409);
    const desktopScreenshot=artifact.type==='desktop-screenshot'&&!artifact.restoredFrom;
    const entries = [{ path:desktopScreenshot&&dataDir?path.join(dataDir,'desktop','screenshots',artifact.id+'.png'):artifact.path, sha256: artifact.sha256, bytes: artifact.bytes??artifact.size, primary: true }, ...(artifact.companionFiles ?? []).map(x => typeof x === 'string' ? { path: x } : x)];
    for (const entry of entries) {
      if (typeof entry.path !== 'string') fail('PATH_SCOPE', 'Artifact path is required', 403);
      const source = path.resolve(workspace, entry.path);
      let relative, file;
      if (inside(workspace, source)) {
        relative = safeRelative(path.relative(workspace, source).split(path.sep).join('/'));
        file = await scoped(workspace, relative);
      } else if(desktopScreenshot){
        const receipt=snapshot.receipts.find(r=>r.type==='desktop.action'&&r.result?.status==='completed'&&r.result.projectId===projectId&&r.result.targetId===artifact.targetId&&r.result.result?.artifactId===artifact.id);
        if(!dataDir||!entry.primary||!receipt||source!==path.join(dataDir,'desktop','screenshots',artifact.id+'.png'))fail('PATH_SCOPE','Screenshot does not match an authoritative desktop action',403);
        file=await scoped(dataDir,`desktop/screenshots/${artifact.id}.png`);relative=safeRelative(`.forge-artifacts/desktop/${artifact.id}.png`);
      } else {
        // Native Report Studio owns this one published root; credentials/config/staging remain excluded.
        // Require the authoritative report job membership, not a user-supplied arbitrary external path.
        const job = snapshot.jobs.find(j => j.id === artifact.jobId && j.projectId === projectId && j.owner === 'reports' && j.status === 'ready' && j.artifactIds?.includes(artifact.id));
        const name = artifact.filename;
        if (!dataDir || !job || typeof name !== 'string' || name !== path.basename(name)) fail('PATH_SCOPE', 'Artifact is outside an authorized project-owned root', 403);
        const reportRoot = path.join(dataDir, 'reports', 'published', job.id);
        if (!inside(reportRoot, source) || (entry.primary && source !== path.join(reportRoot, name))) fail('PATH_SCOPE', 'Artifact does not match its owning report job', 403);
        const ownedRelative = path.relative(dataDir, source).split(path.sep).join('/');
        file = await scoped(dataDir, ownedRelative);
        relative = safeRelative(`.forge-artifacts/reports/${job.id}/${path.relative(reportRoot, source).split(path.sep).join('/')}`);
      }
      const info = await stat(file);
      if (!info.isFile()) fail('PATH_SCOPE', 'Artifact must be a regular file', 403);
      if (info.size > 512 * 1024 * 1024) fail('SIZE', 'Current verification limit is 512 MiB per file');
      const bytes = await readFile(file), sha256 = entry.sha256 ?? hash(bytes);
      verify(bytes, sha256, entry.bytes);
      const previous = files.get(relative.toLowerCase());
      if (previous && (previous.sha256 !== sha256 || previous.relative !== relative)) fail('INTEGRITY', 'Conflicting retained artifact revisions or case-colliding paths', 409);
      files.set(relative.toLowerCase(), { relative, sha256, bytes: bytes.length, source: file });
      bindings.push({ artifactId: artifact.id, relative, primary: !!entry.primary });
    }
  }
  if (artifactIds && artifactIds.some(id => !snapshot.artifacts.some(a => a.id === id && a.projectId === projectId))) fail('NOT_FOUND', 'Selected artifact was not found in this project', 404);
  return { files: [...files.values()].sort((a,b) => a.relative.localeCompare(b.relative)), bindings };
}
export function validateManifest(bytes, sha256) {
  verify(bytes, sha256);
  let manifest;
  try { manifest = JSON.parse(bytes); } catch { fail('INTEGRITY', 'Invalid bundle manifest', 409); }
  if (manifest?.format !== 'forge.project-bundle.v1' || !Array.isArray(manifest.files) || !Array.isArray(manifest.bindings) || !manifest.records?.project?.id || !manifest.completeProject) fail('INTEGRITY', 'Select a complete project backup for restore', 409);
  const names = new Set();
  for (const f of manifest.files) {
    safeRelative(f.relative);
    if (names.has(f.relative.toLowerCase()) || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 512 * 1024 * 1024) fail('INTEGRITY', 'Invalid bundle file table', 409);
    names.add(f.relative.toLowerCase());
  }
  for (const key of portableCollections) {
    if (!Array.isArray(manifest.records[key]) || new Set(manifest.records[key].map(x => x.id)).size !== manifest.records[key].length) fail('INTEGRITY', 'Invalid portable project records', 409);
    if (manifest.records[key].some(x => x.projectId !== manifest.records.project.id || typeof x.id !== 'string')) fail('INTEGRITY', 'Cross-project bundle records', 409);
  }
  for (const binding of manifest.bindings) {
    if (!manifest.files.some(f => f.relative === binding.relative) || !manifest.records.artifacts.some(a => a.id === binding.artifactId)) fail('INTEGRITY', 'Invalid artifact file binding', 409);
  }
  for (const a of manifest.records.artifacts) {
    const primary = manifest.bindings.filter(b => b.artifactId === a.id && b.primary);
    if (primary.length !== 1 || manifest.files.find(f => f.relative === primary[0].relative)?.sha256 !== a.sha256) fail('INTEGRITY', 'Artifact checksum does not match its file', 409);
  }
  const artifactIds = new Set(manifest.records.artifacts.map(a => a.id));
  for (const doc of manifest.records.documents) {
    const serialized = JSON.stringify({ snapshot: doc.snapshot, resources: doc.resources, history: doc.history });
    if (/blob:/.test(serialized)) fail('INTEGRITY', 'Document contains a nonportable temporary resource', 409);
    for (const match of serialized.matchAll(/\/api\/artifacts\/([a-zA-Z0-9_-]+)\/download/g)) {
      if (!artifactIds.has(match[1])) fail('INTEGRITY', 'Document resource is outside this project backup', 409);
    }
  }
  return manifest;
}
export const sourceFingerprint = (snapshot, projectId, artifactIds) => hash(json(recordsFor(snapshot, projectId, artifactIds)));
