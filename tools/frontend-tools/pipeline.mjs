// Host-only no-code installer hook AFTER the existing pinned source/toolchain/
// base-patch/dependency stages. It creates a new generation, builds both purposes
// and returns inventory only. No fixture/model turn, activation or live proof.
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { digest } from '../../app/guarded-runtime/profile.mjs';
export async function frontendArtifactInventory(generation) {
  const root = path.resolve(generation), meta = JSON.parse(await readFile(path.join(root, 'generation.json'), 'utf8'));
  if (meta.root !== root || !path.basename(root).startsWith('forge-frontend-generation-')) throw Error('NEW_GENERATION_REQUIRED');
  const sha = file => readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'));
  const directory = path.join(root, 't3/apps/server/dist');
  const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.mjs')).sort().map(async name => ({ name, path: path.join(directory, name), sha256: await sha(path.join(directory, name)) })));
  const node = { name: 'node.exe', path: process.execPath, sha256: await sha(process.execPath) };
  const opencode = path.join(root, 'opencode/forge-frontend-cli-build/cli-windows-x64/bin/opencode.exe');
  const t3Hash = digest([...files, node].map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name)));
  return { version: 1, purpose: 'unified-default-guarded-and-explicit-supervised-frontend', t3: { entry: path.join(directory, 'forge-guarded-host.mjs'), files: [...files, node], sha256: t3Hash, equalExisting3494a3: t3Hash === '3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9' }, opencode: { path: opencode, sha256: await sha(opencode), version: '2.4.1-forge-frontend.0' }, proof: null };
}
export async function runFrontendPipeline({ preparedCache, buildDirectory, runCommand, environment, signal, onProgress = () => {} }) {
  if (!path.isAbsolute(preparedCache ?? '') || !path.isAbsolute(buildDirectory ?? '') || typeof runCommand !== 'function' || !environment) throw Error('PRIVATE_SETUP_JOB_RUNNER_REQUIRED');
  // The EXISTING installer JobObject runner owns cancellation and all descendants.
  // Its result need not capture stdout: clone records its new path durably.
  const reports = await mkdtemp(path.join(buildDirectory, 'frontend-pipeline-'));
  async function run(stage, args) {
    signal?.throwIfAborted(); onProgress(stage);
    const file = fileURLToPath(new URL(stage + '.mjs', import.meta.url));
    const result = await runCommand({ stage: 'frontend-' + stage, command: process.execPath, args: [file, ...args], cwd: buildDirectory, env: environment, timeoutMs: 600000 });
    signal?.throwIfAborted();
    if (result?.exitCode !== 0) throw Object.assign(Error('FRONTEND_BUILD_STAGE_FAILED'), { stage });
  }
  const generationFile = path.join(reports, 'generation.json');
  await run('clone-generation', [preparedCache, generationFile]);
  const { generation } = JSON.parse(await readFile(generationFile, 'utf8'));
  if (!path.isAbsolute(generation) || !path.basename(generation).startsWith('forge-frontend-generation-')) throw Error('FRONTEND_GENERATION_RESPONSE');
  for (const stage of ['patch-generation', 'link-t3-dependencies', 'build-generation']) await run(stage, [generation]);
  signal?.throwIfAborted();
  return frontendArtifactInventory(generation);
}
