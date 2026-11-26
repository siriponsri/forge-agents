import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { unzip, extractPackage } from '../app/reports/files.mjs';
import { generateLauncherDownloads, verifyLauncherDownloads, publicationFiles } from '../tools/launcher-downloads/generate.mjs';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../tools/launcher-downloads/generate.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = async (root, args, encoding = 'utf8') => (await run('git', args,
  { cwd: root, encoding, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout;

async function fixture(root) {
  await mkdir(root);
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.name', 'FORGE disposable packaging fixture']);
  await git(root, ['config', 'user.email', 'packaging-fixture@example.invalid']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  // Real launchers/launcher source, lockfile and notices from the project. The
  // disposable repository is an archive fixture, never a product runtime test.
  const selected = ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'assets/forge-mark.svg', 'docs/FORGE_LOCAL_QUICKSTART_TH.md', 'app/launcher.mjs', 'app/server/paths.mjs',
    'tools/guarded-runtime/acquire.mjs','tools/frontend-tools/pipeline.mjs','tools/session-tools/pipeline.mjs',
    ...['Start', 'Stop', 'Restart'].flatMap(action => [action + '-FORGE.cmd', action + '-FORGE.command'])];
  for (const name of selected) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), await readFile(path.join(repository, name)));
  }
  await git(root, ['add', '--', ...selected]);
  await git(root, ['commit', '--quiet', '-m', 'Disposable committed-source launcher fixture']);
  return (await git(root, ['rev-parse', 'HEAD'])).trim();
}
async function rewriteArchive(output, transform) {
  const filename = path.join(output, 'FORGE-Windows.zip');
  const files = unzip(await readFile(filename));
  transform(files);
  const entries = Object.fromEntries([...files].map(([name, bytes]) => [name,
    [bytes, { os: 3, attrs: (name.endsWith('.command') ? 0o100755 : 0o100644) << 16 }]]));
  const bytes = zipSync(entries, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') });
  await writeFile(filename, bytes);
  const file = path.join(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  Object.assign(manifest.platforms[0], { bytes: bytes.length, sha256: hash(bytes) });
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'SHA256SUMS'), manifest.platforms.map(p => `${p.sha256}  ${p.filename}\n`).join(''));
}

test('static launcher publication from disposable committed Git source', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-launcher-publication-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const sourceRoot = path.join(temporary, 'source with spaces');
  const commit = await fixture(sourceRoot);
  const outputDirectory = path.join(temporary, 'published');
  let manifest;

  await t.test('requires explicit paths and an actual Git repository root', async () => {
    await assert.rejects(generateLauncherDownloads(), /outputDirectory is required/);
    await assert.rejects(generateLauncherDownloads({ outputDirectory }), /sourceRoot is required/);
    await assert.rejects(generateLauncherDownloads({ sourceRoot: path.join(sourceRoot, 'app'), outputDirectory }), /repository root/);
    await assert.rejects(generateLauncherDownloads({ sourceRoot, outputDirectory: path.parse(sourceRoot).root }), /filesystem root/);
  });

  await t.test('publishes real launchers, exact source blobs, checksums and honest qualification', async () => {
    // Neither worktree edits nor untracked machine data may enter either ZIP.
    await writeFile(path.join(sourceRoot, 'app/launcher.mjs'), 'LOCAL UNCOMMITTED SOURCE MUST NOT SHIP');
    await writeFile(path.join(sourceRoot, 'app/.env'), 'PACKAGING_SENTINEL_NOT_A_REAL_CREDENTIAL');
    await writeFile(path.join(sourceRoot, 'app/node.exe'), 'PACKAGING_SENTINEL_NOT_A_REAL_RUNTIME');
    manifest = await generateLauncherDownloads({ sourceRoot, outputDirectory });
    assert.equal(manifest.commit, commit);
    assert.equal(manifest.packageKind, 'unsigned-development-source-launchers');
    assert.equal(manifest.signed, false);
    assert.equal(manifest.qualification.productReleaseComplete, false);
    assert.equal(manifest.qualification.homeUat, 'NOT_RUN');
    assert.match(manifest.requirements.join('\n'), /Node.js 24.13\+/);
    assert.deepEqual((await readdir(outputDirectory)).sort(), [...publicationFiles].sort());
    for (const p of manifest.platforms) {
      const bytes = await readFile(path.join(outputDirectory, p.filename));
      assert.equal(p.sha256, hash(bytes));
      assert.equal(p.bytes, bytes.length);
      assert.equal(p.url, '/downloads/' + p.filename);
      assert.equal(p.qualification.platformRuntime, 'NOT_RUN');
      assert.equal(p.qualification.nativeMacos, 'NOT_RUN');
      const files = unzip(bytes);
      const info = JSON.parse(files.get('FORGE/release-info.json'));
      assert.equal(info.commit, commit);
      assert.equal(info.platform, p.id);
      assert.equal(info.sourceFiles.length, p.sourceFiles);
      for (const source of info.sourceFiles) {
        const data = files.get('FORGE/' + source.path);
        assert.equal(hash(data), source.sha256);
        assert.deepEqual(data, await git(sourceRoot, ['show', `${commit}:${source.path}`], 'buffer'));
      }
      for (const action of ['Start', 'Stop', 'Restart']) {
        const name = `${action}-FORGE.${p.id === 'windows' ? 'cmd' : 'command'}`;
        assert.deepEqual(files.get('FORGE/' + name), await git(sourceRoot, ['show', `${commit}:${name}`], 'buffer'));
      }
      assert.ok(![...files.keys()].some(name => /(^|\/)(\.git|node_modules|dist|\.env|node\.exe)(\/|$)/.test(name)));
      const extracted = path.join(temporary, 'extracted-' + p.id);
      await extractPackage(bytes, extracted);
      assert.deepEqual(await readFile(path.join(extracted, 'FORGE/app/launcher.mjs')),
        await git(sourceRoot, ['show', `${commit}:app/launcher.mjs`], 'buffer'));
    }
    assert.deepEqual(await verifyLauncherDownloads({ sourceRoot, outputDirectory }), manifest);
  });

  await t.test('same source produces identical ZIPs and manifests across directories and time zones', async () => {
    const second = path.join(temporary, 'second output');
    await utimes(path.join(sourceRoot, 'Start-FORGE.cmd'), new Date('2001-01-01'), new Date('2030-01-01'));
    await run(process.execPath, [cli, '--source-root', sourceRoot, '--output-directory', second],
      { env: { ...process.env, TZ: 'America/Los_Angeles' }, windowsHide: true });
    for (const filename of publicationFiles) assert.deepEqual(await readFile(path.join(second, filename)), await readFile(path.join(outputDirectory, filename)));
    const result = await run(process.execPath, [cli, '--verify', '--source-root', sourceRoot, '--output-directory', second], { windowsHide: true });
    assert.equal(JSON.parse(result.stdout).commit, commit);
  });

  await t.test('refuses existing output without touching it and leaves no staging directories', async () => {
    await assert.rejects(generateLauncherDownloads({ sourceRoot, outputDirectory }), /already exists/);
    assert.deepEqual(await verifyLauncherDownloads({ sourceRoot, outputDirectory }), manifest);
    assert.ok(!(await readdir(temporary)).some(name => name.startsWith('.forge-launcher-stage-')));
  });

  await t.test('verification rejects corrupted bytes, checksum lists, unsafe paths and false qualification', async () => {
    for (const [name, mutate, expected] of [
      ['bytes', async out => writeFile(path.join(out, 'FORGE-Windows.zip'), 'not a ZIP'), /checksum mismatch/],
      ['sums', async out => writeFile(path.join(out, 'SHA256SUMS'), ''), /SHA256SUMS mismatch/],
      ['path', async out => {
        const m = structuredClone(manifest); m.platforms[0].filename = '../outside.zip';
        await writeFile(path.join(out, 'manifest.json'), JSON.stringify(m));
      }, /platform manifest/],
      ['qualification', async out => {
        const m = structuredClone(manifest); m.qualification.productReleaseComplete = true;
        await writeFile(path.join(out, 'manifest.json'), JSON.stringify(m));
      }, /qualification/],
    ]) {
      const out = path.join(temporary, 'tampered-' + name);
      await cp(outputDirectory, out, { recursive: true });
      await mutate(out);
      await assert.rejects(verifyLauncherDownloads({ sourceRoot, outputDirectory: out }), expected);
    }
  });

  await t.test('verification checks source manifests, Git blobs, archive paths and executable macOS modes', async () => {
    for (const [name, transform, expected] of [
      ['blob', files => files.set('FORGE/app/launcher.mjs', Buffer.from('source changed')), /differ from the source commit/],
      ['embedded', files => {
        const info = JSON.parse(files.get('FORGE/release-info.json'));
        info.sourceFiles[0].sha256 = '0'.repeat(64);
        files.set('FORGE/release-info.json', Buffer.from(JSON.stringify(info)));
      }, /source checksum mismatch/],
      ['traversal', files => {
        files.delete('FORGE/app/launcher.mjs'); files.set('FORGE/../escaped.mjs', Buffer.from('unsafe'));
      }, /unsafe ZIP entry/],
    ]) {
      const out = path.join(temporary, 'archive-' + name);
      await cp(outputDirectory, out, { recursive: true });
      await rewriteArchive(out, transform);
      await assert.rejects(verifyLauncherDownloads({ sourceRoot, outputDirectory: out }), expected);
    }
    // Both archives include .command files. Set a mode in the central directory
    // while retaining valid content/CRCs, then update the public ZIP checksums.
    const out = path.join(temporary, 'bad-macos-mode');
    await cp(outputDirectory, out, { recursive: true });
    const filename = path.join(out, 'FORGE-macOS.zip'), bytes = await readFile(filename);
    const end = bytes.lastIndexOf(Buffer.from('504b0506', 'hex'));
    let at = bytes.readUInt32LE(end + 16);
    for (let n = 0; n < bytes.readUInt16LE(end + 10); n++) {
      const len = bytes.readUInt16LE(at + 28);
      if (bytes.subarray(at + 46, at + 46 + len).toString() === 'FORGE/Start-FORGE.command') bytes.writeUInt32LE((0o100644 << 16) >>> 0, at + 38);
      at += 46 + len + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
    await writeFile(filename, bytes);
    const m = structuredClone(manifest);
    Object.assign(m.platforms[1], { sha256: hash(bytes), bytes: bytes.length });
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify(m));
    await writeFile(path.join(out, 'SHA256SUMS'), m.platforms.map(p => `${p.sha256}  ${p.filename}\n`).join(''));
    await assert.rejects(verifyLauncherDownloads({ sourceRoot, outputDirectory: out }), /not executable/);
  });

  await t.test('an incomplete canonical archive leaves no public output or staging directory', async () => {
    // Git's export-ignore can omit a tracked file even though it exists in the
    // commit. Fail after canonical generation, before the directory is exposed.
    await writeFile(path.join(sourceRoot, '.gitattributes'), 'app/server/paths.mjs export-ignore\n');
    await git(sourceRoot, ['add', '--', '.gitattributes']);
    await git(sourceRoot, ['commit', '--quiet', '-m', 'Incomplete canonical archive disposable fixture']);
    const out = path.join(temporary, 'incomplete-archive');
    await assert.rejects(generateLauncherDownloads({ sourceRoot, outputDirectory: out }), /inventory differs/);
    await assert.rejects(readFile(path.join(out, 'manifest.json')), { code: 'ENOENT' });
    assert.ok(!(await readdir(temporary)).some(name => name.startsWith('.forge-launcher-stage-')));
    await git(sourceRoot, ['rm', '--quiet', '--', '.gitattributes']);
    await git(sourceRoot, ['commit', '--quiet', '-m', 'Restore full disposable archive boundary']);
  });

  await t.test('committed credentials, machine runtimes and missing launchers prevent publication atomically', async () => {
    for (const name of ['app/.env', 'app/node.exe']) {
      await git(sourceRoot, ['add', '--force', '--', name]);
      await git(sourceRoot, ['commit', '--quiet', '-m', 'Unsafe disposable source fixture']);
      const out = path.join(temporary, 'reject-' + path.basename(name));
      await assert.rejects(generateLauncherDownloads({ sourceRoot, outputDirectory: out }), /Unsafe or non-source/);
      await assert.rejects(readFile(path.join(out, 'manifest.json')), { code: 'ENOENT' });
      await git(sourceRoot, ['rm', '--quiet', '--', name]);
      await git(sourceRoot, ['commit', '--quiet', '-m', 'Remove unsafe disposable fixture']);
    }
    await git(sourceRoot, ['rm', '--quiet', '--', 'Start-FORGE.command']);
    await git(sourceRoot, ['commit', '--quiet', '-m', 'Missing launcher disposable fixture']);
    await assert.rejects(generateLauncherDownloads({ sourceRoot, outputDirectory: path.join(temporary, 'missing') }), /missing Start-FORGE.command/);
    assert.ok(!(await readdir(temporary)).some(name => name.startsWith('.forge-launcher-stage-')));
  });
});
