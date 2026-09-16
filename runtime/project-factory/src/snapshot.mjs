import fs from 'node:fs';
import path from 'node:path';
import {canonicalJson, nowIso, sha256, safeResolve} from './core.mjs';

function walk(root, current, entries, excluded) {
  for (const item of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(current, item.name);
    if (excluded.has(path.resolve(full))) continue;
    if (item.isDirectory()) walk(root, full, entries, excluded);
    else if (item.isFile()) entries.push({path: path.relative(root, full).split(path.sep).join('/'), bytes: fs.statSync(full).size, sha256: sha256(fs.readFileSync(full))});
  }
}

export function createSnapshot(root, {exclude = [], metadata = {}} = {}) {
  const resolved = path.resolve(root);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`SNAPSHOT_ROOT_NOT_DIRECTORY:${resolved}`);
  const excluded = new Set(exclude.map(item => path.resolve(item)));
  const entries = [];
  walk(resolved, resolved, entries, excluded);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {schema_version: '1.0.0', snapshot_id: sha256(canonicalJson({schema_version: '1.0.0', entries})), root: resolved, created_at: nowIso(), metadata, excluded: [...excluded].sort(), entries};
}

export function verifySnapshot(root, manifest) {
  const fresh = createSnapshot(root, {exclude: manifest.excluded || [], metadata: {}});
  return {ok: fresh.snapshot_id === manifest.snapshot_id, expected: manifest.snapshot_id, actual: fresh.snapshot_id, entries: fresh.entries.length};
}

export function freezeCandidate(root, outputPath, metadata = {}) {
  const resolvedOutput = path.resolve(outputPath);
  safeResolve(path.dirname(resolvedOutput), resolvedOutput);
  const snapshot = createSnapshot(root, {exclude: [resolvedOutput], metadata});
  fs.mkdirSync(path.dirname(resolvedOutput), {recursive: true});
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}
