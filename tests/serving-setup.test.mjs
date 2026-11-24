import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureEnvironment, environmentPath } from '../app/serving/runtime.mjs';

test('guided setup installs pinned packages only into a fresh machine cache', { timeout: 360000 }, async t => {
  if (process.env.FORGE_SERVING_TEST_SETUP !== '1') { t.skip('Opt in with FORGE_SERVING_TEST_SETUP=1; downloads public pinned Python dependencies into a disposable isolated cache'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-serving-setup-'));
  const variable = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_CACHE_HOME', previous = process.env[variable];
  process.env[variable] = root;
  t.after(async () => { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  assert.ok(environmentPath().startsWith(root + path.sep));
  await assert.rejects(ensureEnvironment(), { code: 'SERVING_DEPENDENCIES' });
  const ready = await ensureEnvironment({ installDependencies: true });
  assert.equal(ready.ready, true); assert.equal(ready.packages.litserve, '0.2.19');
  assert.equal(ready.packages.fastmcp, '2.14.7'); assert.equal(ready.packages.mcp, '1.30.0');
  assert.deepEqual(await ensureEnvironment(), ready);
});
