// Static source-launcher publication only. Does not build, install, run or deploy FORGE.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from '../../app/reports/files.mjs';
import {downloadSourceDirectories,downloadSourcePaths} from '../../app/server/downloads.mjs';

const run = promisify(execFile);
const platforms = [
  { id: 'windows', label: 'Windows', filename: 'FORGE-Windows.zip', extension: 'cmd' },
  { id: 'macos', label: 'macOS', filename: 'FORGE-macOS.zip', extension: 'command' },
];
// Use the canonical source boundary to verify it, never a second ZIP writer.
const sourcePaths=downloadSourcePaths;
export const publicationFiles = Object.freeze([...platforms.map(p => p.filename), 'manifest.json', 'SHA256SUMS']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const qualification = () => ({ archiveValidation: 'PASSED', platformRuntime: 'NOT_RUN',
  nativeMacos: 'NOT_RUN', liveProduct: 'NOT_RUN', homeUat: 'NOT_RUN', productReleaseComplete: false });
const requirements = ['Node.js 24.13+', 'Internet on first launch for npm ci and pinned dependencies',
  'Extract the entire FORGE folder before using Start/Stop/Restart'];
const limitations = ['Unsigned development source launcher packages; no bundled Node.js or native runtime',
  'Packaging checks do not qualify Windows/macOS execution or complete the product release',
  'Native report-engine acquisition is currently qualified only on Windows x64; macOS qualification pending'];

async function git(root, args, encoding = 'utf8') {
  return (await run('git', args, { cwd: root, encoding, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout;
}
function safeSourcePath(name) {
  const parts = name.split('/');
  if (!name || /[\x00-\x1f\x7f<>:"\\|?*]/.test(name) || parts.some(part => !part || part === '.' || part === '..'
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    || /^(node_modules|dist|\.git|\.cache|browser-profile|user-data-dir|auth\.json|\.env(?:\..*)?)$/i.test(part)
    || /\.(exe|dll|so|dylib|pem|key|db|sqlite\d*)$/i.test(part))) return false;
  return sourcePaths.includes(name)||downloadSourceDirectories.some(prefix=>name.startsWith(prefix+'/'));
}
async function sourceSnapshot(sourceRoot, commit) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) throw new Error('sourceRoot is required');
  const root = await realpath(sourceRoot);
  const top = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim());
  if (path.relative(root, top)) throw new Error('sourceRoot must be the Git repository root');
  commit ??= (await git(root, ['rev-parse', 'HEAD'])).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full source commit SHA');
  const manifest = JSON.parse(await git(root, ['show', `${commit}:package.json`]));
  const entries = new Map();
  const tree = await git(root, ['ls-tree', '-r', '-z', commit, '--', ...sourcePaths]);
  for (const line of tree.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match || !safeSourcePath(match[3])) throw new Error('Unsafe or non-source file in the committed package boundary');
    const [, mode, blob, name] = match;
    if ([...entries.keys()].some(key => key.toLowerCase() === name.toLowerCase())) throw new Error('Case-colliding package paths');
    entries.set(name, { mode, blob });
  }
  for (const name of ['app/launcher.mjs', ...sourcePaths.filter(p => !downloadSourceDirectories.includes(p))]) {
    if (!entries.has(name)) throw new Error(`Committed source is missing ${name}`);
  }
  return { root, commit, version: manifest.version, entries };
}

// The shared unzip reader checks ZIP bounds, names, CRCs and forbids links. Check
// central-directory modes as well so Finder receives executable .command launchers.
function archiveModes(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)
    && !(bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length)) end--;
  if (end < 0) throw new Error('Missing ZIP directory');
  const modes = new Map();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const length = bytes.readUInt16LE(at + 28);
    modes.set(bytes.subarray(at + 46, at + 46 + length).toString('utf8'), bytes.readUInt32LE(at + 38) >>> 16);
    at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return modes;
}
function validateArchive(bytes, platform, snapshot) {
  const files = unzip(bytes, 64 * 1024 * 1024), modes = archiveModes(bytes);
  if (files.size !== snapshot.entries.size + 2) throw new Error('Archive source inventory differs from the Git commit');
  for (const [name, data] of files) {
    if (['FORGE/release-info.json', 'FORGE/README_FIRST.txt'].includes(name)) continue;
    const relative = name.startsWith('FORGE/') ? name.slice(6) : '';
    const expected = snapshot.entries.get(relative);
    if (!safeSourcePath(relative) || !expected) throw new Error(`Unexpected archive file: ${name}`);
    const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    if (blob !== expected.blob) throw new Error(`Archive bytes differ from the source commit: ${relative}`);
    if ((modes.get(name) & 0o170000) !== 0o100000) throw new Error(`Archive entry is not a regular file: ${name}`);
  }
  for (const action of ['Start', 'Stop', 'Restart']) {
    const name = `FORGE/${action}-FORGE.${platform.extension}`;
    if (!files.get(name)?.length) throw new Error(`Missing real launcher: ${name}`);
    if (platform.id === 'macos' && (modes.get(name) & 0o777) !== 0o755) throw new Error(`Launcher is not executable: ${name}`);
  }
  const info = JSON.parse(files.get('FORGE/release-info.json').toString('utf8'));
  if (info.product !== 'FORGE' || info.commit !== snapshot.commit || info.platform !== platform.id
    || info.version !== snapshot.version || !Array.isArray(info.sourceFiles)
    || info.sourceFiles.length !== snapshot.entries.size) throw new Error('Invalid embedded source manifest');
  const seen = new Set();
  for (const entry of info.sourceFiles) {
    if (!safeSourcePath(entry.path) || seen.has(entry.path) || !snapshot.entries.has(entry.path)
      || hash(files.get('FORGE/' + entry.path) ?? Buffer.alloc(0)) !== entry.sha256) throw new Error('Embedded source checksum mismatch');
    seen.add(entry.path);
  }
  if (!files.get('FORGE/README_FIRST.txt')?.length) throw new Error('Missing package instructions');
  return { sourceFiles: info.sourceFiles.length, embeddedQualification: info.qualification };
}
function checksums(manifest) {
  return manifest.platforms.map(p => `${p.sha256}  ${p.filename}\n`).join('');
}
async function publicationDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('outputDirectory is required');
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('outputDirectory cannot be a filesystem root');
  return resolved;
}

/** Verify published ZIPs against their manifest and the exact committed Git blobs. */
export async function verifyLauncherDownloads({ sourceRoot, outputDirectory } = {}) {
  const output = await publicationDirectory(outputDirectory);
  if (!(await lstat(output)).isDirectory() || (await lstat(output)).isSymbolicLink()) throw new Error('Publication must be a real directory');
  const names = (await readdir(output)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...publicationFiles].sort())) throw new Error('Unexpected publication files');
  for (const filename of publicationFiles) {
    const info = await lstat(path.join(output, filename));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Publication files must be regular files');
  }
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.product !== 'FORGE' || manifest.packageKind !== 'unsigned-development-source-launchers'
    || manifest.signed !== false || manifest.status !== 'alpha' || JSON.stringify(manifest.qualification) !== JSON.stringify(qualification())
    || JSON.stringify(manifest.requirements) !== JSON.stringify(requirements) || JSON.stringify(manifest.limitations) !== JSON.stringify(limitations)
    || manifest.platforms?.length !== 2) throw new Error('Invalid publication manifest or qualification');
  const snapshot = await sourceSnapshot(sourceRoot, manifest.commit);
  if (manifest.version !== snapshot.version) throw new Error('Publication version differs from committed source');
  for (const [index, expected] of platforms.entries()) {
    const p = manifest.platforms[index];
    if (p.id !== expected.id || p.label !== expected.label || p.filename !== expected.filename || p.url !== `/downloads/${expected.filename}`
      || p.path !== expected.filename || p.contentType !== 'application/zip'
      || JSON.stringify(p.qualification) !== JSON.stringify(qualification())) throw new Error('Unsafe or invalid platform manifest');
    const bytes = await readFile(path.join(output, expected.filename));
    if (bytes.length !== p.bytes || hash(bytes) !== p.sha256) throw new Error(`Publication checksum mismatch: ${expected.filename}`);
    const validation = validateArchive(bytes, expected, snapshot);
    if (p.sourceFiles !== validation.sourceFiles || p.embeddedQualification !== validation.embeddedQualification) throw new Error('Publication source validation mismatch');
  }
  if (await readFile(path.join(output, 'SHA256SUMS'), 'utf8') !== checksums(manifest)) throw new Error('SHA256SUMS mismatch');
  return manifest;
}

/** Generate into a NEW directory. A single directory rename publishes the full set.
 * Existing directories are refused; the caller owns any later website mount/swap.
 */
export async function generateLauncherDownloads({ sourceRoot, outputDirectory } = {}) {
  const output = await publicationDirectory(outputDirectory);
  const snapshot = await sourceSnapshot(sourceRoot);
  try { await lstat(output); throw new Error('outputDirectory already exists; use a fresh publication directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(output), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(output), '.forge-launcher-stage-'));
  let cache;
  try {
    cache = await mkdtemp(path.join(os.tmpdir(), 'forge-launcher-cache-'));
    // fflate uses local calendar fields for DOS ZIP timestamps. Pin TZ only in a
    // child process; never mutate the caller's environment or shared service.
    const built = await run(process.execPath, [fileURLToPath(new URL('./canonical-build.mjs', import.meta.url)), snapshot.root, cache],
      { env: { ...process.env, TZ: 'UTC' }, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const metadata = JSON.parse(built.stdout);
    if (metadata.commit !== snapshot.commit || metadata.version !== snapshot.version) throw new Error('Source HEAD changed during packaging; retry on a stable commit');
    const records = [];
    for (const platform of platforms) {
      const bytes = await readFile(path.join(cache, 'downloads', snapshot.commit, platform.filename));
      const validation = validateArchive(bytes, platform, snapshot);
      records.push({ id: platform.id, label: platform.label, filename: platform.filename, path: platform.filename,
        url: `/downloads/${platform.filename}`, contentType: 'application/zip', sha256: hash(bytes), bytes: bytes.length,
        ...validation, qualification: qualification() });
      await writeFile(path.join(stage, platform.filename), bytes, { flag: 'wx' });
    }
    const manifest = { schemaVersion: 1, product: 'FORGE', version: snapshot.version, commit: snapshot.commit,
      status: 'alpha', packageKind: 'unsigned-development-source-launchers', signed: false,
      requirements, limitations, qualification: qualification(), platforms: records };
    await writeFile(path.join(stage, 'manifest.json'), json(manifest), { flag: 'wx' });
    await writeFile(path.join(stage, 'SHA256SUMS'), checksums(manifest), { flag: 'wx' });
    await verifyLauncherDownloads({ sourceRoot: snapshot.root, outputDirectory: stage });
    if ((await git(snapshot.root, ['rev-parse', 'HEAD'])).trim() !== snapshot.commit) throw new Error('Source HEAD changed during packaging; retry on a stable commit');
    // No replacement and no per-file copy into an existing public directory.
    await rename(stage, output);
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (cache) await rm(cache, { recursive: true, force: true });
  }
}

async function main(args) {
  const options = {};
  let verify = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify') { verify = true; continue; }
    const key = { '--source-root': 'sourceRoot', '--output-directory': 'outputDirectory' }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) throw new Error('Usage: node tools/launcher-downloads/generate.mjs [--verify] --source-root <git-root> --output-directory <new-directory>');
    options[key] = args[++i];
  }
  const manifest = await (verify ? verifyLauncherDownloads : generateLauncherDownloads)(options);
  console.log(json({ commit: manifest.commit, version: manifest.version, outputDirectory: path.resolve(options.outputDirectory),
    platforms: manifest.platforms.map(({ filename, sha256, bytes }) => ({ filename, sha256, bytes })), qualification: manifest.qualification }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error('FORGE launcher publication: ' + error.message); process.exitCode = 1; });
}
