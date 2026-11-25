// The retained timeout generation keeps the shared pnpm store but may omit
// apps/server's importer links after packaging. Recreate ONLY links in NEW tree.
import { readdir, lstat, realpath, mkdir, symlink, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]), meta = JSON.parse(await readFile(path.join(root, 'generation.json'), 'utf8'));
if (root !== meta.root || !path.basename(root).startsWith('forge-frontend-generation-')) throw Error('NEW_GENERATION_REQUIRED');
const oldRoot = path.dirname(path.dirname(await realpath(path.join(meta.cache, 't3/node_modules/.pnpm'))));
if ((await readFile(path.join(oldRoot, 'apps/server/package.json'), 'utf8')) !== (await readFile(path.join(root, 't3/apps/server/package.json'), 'utf8'))) throw Error('IMPORTER_MANIFEST_CHANGED');
async function link(from, to) {
  const stat = await lstat(from);
  if (stat.isSymbolicLink()) {
    const target = await realpath(from), rel = path.relative(oldRoot, target);
    const next = rel.startsWith('packages' + path.sep) || rel.startsWith('apps' + path.sep) ? path.join(root, 't3', rel) : target;
    try {
      const existing = await lstat(to);
      if (!existing.isSymbolicLink()) return;
      if (await realpath(to) === await realpath(next)) return;
      const owned = path.relative(root, to);
      if (owned.startsWith('..') || path.isAbsolute(owned)) throw Error('LINK_OUTSIDE_GENERATION');
      await unlink(to); // unlink the NEW junction only; never traverse/delete target
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await symlink(next, to, 'junction');
  } else if (stat.isDirectory()) { await mkdir(to, { recursive: true }); for (const file of await readdir(from)) if (file !== '.bin') await link(path.join(from, file), path.join(to, file)); }
}
for (const group of ['packages', 'apps']) for (const item of await readdir(path.join(oldRoot, group))) {
  const source = path.join(oldRoot, group, item, 'node_modules');
  try { await lstat(source); } catch { continue; }
  await link(source, path.join(root, 't3', group, item, 'node_modules'));
}
console.log('NEW_T3_IMPORTER_LINKS_READY');
