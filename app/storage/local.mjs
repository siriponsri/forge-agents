import { mkdir, open, link, readdir, unlink, stat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../server/domain.mjs';
import { scoped, maybeRead, verify, hash, inside, safeRelative } from './common.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function createLocalAdapter({ directory, workspace, dataDir }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('VALIDATION', 'Select an absolute local storage directory');
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  for (const forbidden of [workspace, dataDir, sourceRoot]) {
    const selected = await realpath(forbidden);
    if (inside(selected, root) || inside(root, selected)) fail('PATH_SCOPE', 'Select a storage folder separate from workspace, FORGE source and application data', 403);
  }
  const adapter = {
    kind: 'local',
    async health() { return { status: 'ready', kind: 'local', readable: (await stat(root)).isDirectory() }; },
    async get(key) { return maybeRead(await scoped(root, key)); },
    async put(key, bytes) {
      const file = await scoped(root, key, { createParents: true });
      const prior = await maybeRead(file);
      if (prior) { verify(prior, hash(bytes), bytes.length); return; }
      const temporary = await scoped(root, `.staging/${randomUUID()}.part`, { createParents: true });
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      finally { await unlink(temporary); }
      verify(await maybeRead(file), hash(bytes), bytes.length);
    },
    async list(prefix) {
      safeRelative(prefix);
      const base = await scoped(root, prefix);
      const output = [];
      async function visit(dir, relative) {
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
        for (const e of entries) {
          const key = `${relative}/${e.name}`;
          await scoped(root, key);
          if (e.isDirectory()) await visit(path.join(dir, e.name), key);
          else if (e.isFile()) output.push(key);
        }
      }
      await visit(base, prefix);
      return output.sort();
    },
    async delete(key) { try { await unlink(await scoped(root, key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
  };
  return adapter;
}
