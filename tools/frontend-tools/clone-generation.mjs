// Clone source files and workspace links into a NEW generation. External package
// directories are read-only links to the pinned cache; no install is performed.
import { readdir, lstat, realpath, mkdir, copyFile, symlink, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const cache = path.resolve(process.argv[2]), root = await mkdtemp(path.join(os.tmpdir(), 'forge-frontend-generation-'));
const sha = b => createHash('sha256').update(b).digest('hex');
for (const [name, expected] of [['opencode', '2e6432bb7c27b03b5bffa170360f6b95210213520ba43c1c7f82fd1d9e2f6f28'], ['t3', '6828739be5126583b945e7173e7caef5acaa7ae57ffe566d9db9f65b5ab94ca2']]) {
  if (sha(await readFile(path.join(cache, name + '.tgz'))) !== expected) throw Error('PINNED_ARCHIVE_CHANGED');
  const source = path.join(cache, name), target = path.join(root, name);
  async function clone(from, to, inModules = false) {
    const stat = await lstat(from), rel = path.relative(source, from);
    if (stat.isSymbolicLink()) {
      const actual = await realpath(from), inside = path.relative(source, actual);
      // Workspace source links follow the new generation. External dependencies
      // retain the pinned cache's physical package store; never patch those files.
      const workspace = inside.startsWith('packages' + path.sep) || inside.startsWith('apps' + path.sep);
      await symlink(workspace ? path.join(target, inside) : actual, to, 'junction'); return;
    }
    if (stat.isDirectory()) {
      const base = path.basename(from);
      if (['.git', '.cache', 'forge-guarded-cli-build', 'dist', 'dist-exe', '.ts-dist'].includes(base)) return;
      if (inModules && ['.bun', '.pnpm'].includes(base)) { await symlink(await realpath(from), to, 'junction'); return; }
      await mkdir(to, { recursive: true });
      for (const entry of await readdir(from)) await clone(path.join(from, entry), path.join(to, entry), inModules || base === 'node_modules');
    } else if (stat.isFile()) await copyFile(from, to);
  }
  await clone(source, target);
}
await writeFile(path.join(root, 'generation.json'), JSON.stringify({ version: 1, scope: 'NEW isolated supervised frontend derivative, cache read-only', cache, root, proof: null }, null, 2));
if (process.argv[3]) {
  if (!path.isAbsolute(process.argv[3])) throw Error('ABSOLUTE_HOST_REPORT_PATH_REQUIRED');
  await writeFile(process.argv[3], JSON.stringify({ generation: root }), { flag: 'wx' });
}
console.log(root);
