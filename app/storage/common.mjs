import { createHash } from 'node:crypto';
import { lstat, realpath, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../server/domain.mjs';

export const hash = b => createHash('sha256').update(b).digest('hex');
export const json = x => Buffer.from(JSON.stringify(x));
export const id = x => {
  if (typeof x !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(x)) fail('VALIDATION', 'Invalid storage identifier');
  return x;
};
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || /[\\:\x00-\x1f]/.test(value)) fail('PATH_SCOPE', 'Use a relative portable file path', 403);
  const segments = value.split('/');
  if (segments.some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s) || /[<>"|?*]/.test(s) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) fail('PATH_SCOPE', 'Unsafe portable file path', 403);
  if (segments.some(s => /^\.git$/i.test(s) || /^\.env(?:\.|$)/i.test(s) || /^(auth|credentials?|secrets?|tokens?)\.(json|ya?ml|toml)$/i.test(s) || /\.(pem|key)$/i.test(s))) fail('PATH_SCOPE', 'Git internals and credential files are excluded', 403);
  if (value.toLowerCase() === '.forge-storage-restore.json') fail('PATH_SCOPE', 'Reserved restore receipt path', 403);
  return value;
}
export function inside(root, candidate) {
  const r = path.relative(root, candidate);
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
}
// Reject links at every segment, including Windows junctions. Never traverse an untrusted parent during mkdir.
export async function scoped(root, key, { createParents = false } = {}) {
  safeRelative(key);
  const base = await realpath(root);
  let current = base;
  const parts = key.split('/');
  for (let n = 0; n < parts.length; n++) {
    current = path.join(current, parts[n]);
    let info;
    try { info = await lstat(current); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (n < parts.length - 1 && createParents) { await mkdir(current); info = await lstat(current); }
      else if (n < parts.length - 1) return current + path.sep + parts.slice(n + 1).join(path.sep);
    }
    if (info?.isSymbolicLink()) fail('PATH_SCOPE', 'Linked storage paths are not allowed', 403);
    if (info && !inside(base, await realpath(current))) fail('PATH_SCOPE', 'Storage path escaped selected folder', 403);
    if (info && n < parts.length - 1 && !info.isDirectory()) fail('PATH_SCOPE', 'A storage parent is not a directory', 403);
  }
  return current;
}
export async function maybeRead(file) { try { return await readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
export function verify(bytes, sha256, size) {
  if (!bytes || hash(bytes) !== sha256 || (size !== undefined && bytes.length !== size)) fail('INTEGRITY', 'Checksum or byte size mismatch; destination was not accepted', 409);
  return bytes;
}
export function safeError(e) {
  // Neither provider bodies nor filesystem/HTTP exception text is durable/logged.
  const known = {
    INTEGRITY:'Checksum or byte size mismatch. Inspect the source and retry.', PATH_SCOPE:'A path is outside the selected folder, linked, or reserved.',
    SOURCE_CHANGED:'Project files or revisions changed. Restart to capture a new bundle.', DESTINATION_CONFLICT:'Destination changed. Review its current head and explicitly resolve the conflict.',
    AUTH_REQUIRED:'Connect Google Drive in Settings or supply the configured environment secret.', DRIVE_PERMISSION:'Google Drive denied access. Check folder access and Drive API enablement.',
    DRIVE_RATE_LIMIT:'Google Drive is rate limited. Retry later.', DRIVE_UNAVAILABLE:'Google Drive is unavailable. Retry to reuse verified transferred files.',
    DESTINATION_EXISTS:'Choose a new restore folder; existing destinations are never overwritten.', SETUP_REQUIRED:'Complete storage setup in project Settings.',
    REVISION_CONFLICT:'The project changed. Reload before restoring.', INTERRUPTED:'Transfer interrupted. Resume verified files or restart.',
    DRIVE_AMBIGUOUS:'Drive contains duplicate storage object keys. Resolve the duplicate files before retrying.', SIZE:'File exceeds the current 512 MiB verification limit.',
  };
  return { code: known[e.code] ? e.code : 'STORAGE_IO', message: known[e.code] ?? 'Storage operation failed. Check selected folder permissions, free space and connection, then retry.' };
}
