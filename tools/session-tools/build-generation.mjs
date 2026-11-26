import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]), meta = JSON.parse(await readFile(path.join(root, 'generation.json'), 'utf8'));
if (root !== meta.root || !path.basename(root).startsWith('forge-frontend-generation-')) throw Error('NEW_GENERATION_REQUIRED');
const home = path.join(root, 'build-home'); await mkdir(home, { recursive: true });
const bun = path.join(meta.cache, 'bun/bin/bun.exe'), node = path.join(meta.cache, 'node/node.exe');
const env = { SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, PATH: [path.dirname(bun), path.dirname(node), path.join(process.env.SystemRoot, 'System32')].join(path.delimiter), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_VERSION: '2.4.1-forge-sessions.0', OPENCODE_CHANNEL: 'forge-sessions', CI: '1' };
const jobs = [
  ['opencode', bun, ['run', 'script/build.ts', '--single', '--skip-install', '--skip-web-ui', '--outdir=' + path.join(root, 'opencode/forge-sessions-cli-build')], path.join(root, 'opencode/packages/cli')],
  ['t3', node, [path.join(root, 't3/node_modules/vite-plus/bin/vp'), 'pack'], path.join(root, 't3/apps/server')],
];
await Promise.all(jobs.filter(x => !process.argv.includes('--t3-only') || x[0] === 't3').map(async ([name, binary, args, cwd]) => {
  const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exitCode = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  const report = { name, exitCode, stdout, stderr, proof: null };
  await writeFile(path.join(root, name + '-session-build.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, exitCode, report: path.join(root, name + '-session-build.json'), stderrTail: stderr.slice(-1500) })); if (exitCode !== 0) process.exitCode = 1;
}));
