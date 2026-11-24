import { spawn } from 'node:child_process';
import { mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fail } from '../server/domain.mjs';

export const versions = Object.freeze({ litserve: '0.2.19', fastmcp: '2.14.7', mcp: '1.30.0' });
const here = path.dirname(fileURLToPath(import.meta.url));
export function environmentPath() {
  return path.join(process.platform === 'win32' ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local') : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'FORGE', 'cache', 'serving', 'litserve-0.2.19');
}
export const pythonPath = () => path.join(environmentPath(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export function safeEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile', 'localappdata', 'appdata', 'home', 'lang'].includes(k.toLowerCase()))),
    PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', DO_NOT_TRACK: '1', LITAI_DISABLE_TELEMETRY: '1' };
}
// Keep the live ChildProcess handle: a persisted PID never grants authority to kill.
export function spawnOwned(command, args, { cwd, onLog = () => {}, keepAliveInput = false } = {}) {
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', env: safeEnvironment(), stdio: [keepAliveInput ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  // POSIX uses an owner-lifetime pipe; Windows uses an opened process wait handle
  // because Python's multiprocessing manager cannot share Node's stdin pipe.
  child.stdin?.on('error', () => {});
  let alive = true, stopping;
  const finished = new Promise(resolve => {
    child.once('error', e => { alive = false; resolve({ code: null, error: e.message }); });
    child.once('close', (code, signal) => { alive = false; resolve({ code, signal }); });
  });
  child.stdout.on('data', b => onLog(b.toString('utf8'))); child.stderr.on('data', b => onLog(b.toString('utf8')));
  return { child, finished, get alive() { return alive; }, terminate() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (!alive || !child.pid) return finished;
      if (process.platform === 'win32') {
        // LitServe owns inference children. taskkill only targets this still-owned process tree.
        await new Promise(resolve => {
          const killer = spawn(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
          killer.once('error', resolve); killer.once('close', resolve);
        });
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
      const result = await Promise.race([finished, new Promise(r => { const t = setTimeout(() => r(null), 5000); t.unref(); })]);
      if (!result && alive) {
        if (process.platform !== 'win32') try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        else child.kill();
      }
      return finished;
    })(); return stopping;
  } };
}
async function commandOutput(command, args, { signal, onLog = () => {}, timeoutMs = 30000 } = {}) {
  signal?.throwIfAborted(); let output = '';
  const handle = spawnOwned(command, args, { onLog: text => { output = (output + text).slice(-160000); onLog(text); } });
  const abort = () => { void handle.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { const result = await handle.finished; signal?.throwIfAborted(); if (result.code !== 0) fail('PYTHON_SETUP', `Python serving environment command failed: ${result.error ?? output.slice(-3000)}`, 409); return output; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function probeEnvironment() {
  try {
    await access(pythonPath());
    const output = await commandOutput(pythonPath(), ['-I', '-c', "import json,sys,importlib.metadata as m; from litserve.mcp import MCP; import litserve; print(json.dumps({'python':sys.version.split()[0], 'packages':{k:m.version(k) for k in ['litserve','fastmcp','mcp','fastapi','uvicorn','pydantic']}}))"]);
    const evidence = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    if (Object.entries(versions).some(([k, v]) => evidence.packages[k] !== v)) throw new Error('Managed environment does not match qualified package pins');
    return { ready: true, executable: pythonPath(), ...evidence };
  } catch (e) { return { ready: false, code: 'SERVING_DEPENDENCIES', message: 'Set installDependencies:true on local Start to prepare the isolated LitServe environment; Python 3.10–3.12 and package-index access are required.', detail: e.message, packages: versions }; }
}
export async function ensureEnvironment({ installDependencies = false, pythonExecutable, signal, onLog } = {}) {
  const current = await probeEnvironment(); if (current.ready) return current;
  if (!installDependencies) fail('SERVING_DEPENDENCIES', current.message, 409, current);
  const env = environmentPath(), lock = `${env}.setup-lock`;
  await mkdir(path.dirname(env), { recursive: true });
  try { await mkdir(lock); } catch { fail('SERVING_SETUP_BUSY', 'Another serving setup owns this environment. Wait for setup, or inspect a stale setup lock before retrying.', 409); }
  try {
    const candidates = pythonExecutable ? [[pythonExecutable, []]] : process.platform === 'win32' ? [['python', []], ['py', ['-3.12']]] : [['python3', []], ['python', []]];
    let selected;
    for (const [command, prefix] of candidates) {
      try { const version = JSON.parse((await commandOutput(command, [...prefix, '-I', '-c', 'import sys,json;print(json.dumps(list(sys.version_info[:2])))'], { signal })).trim());
        if (version[0] === 3 && version[1] >= 10 && version[1] <= 12) { selected = [command, prefix]; break; }
      } catch { signal?.throwIfAborted(); }
    }
    if (!selected) fail('PYTHON_REQUIRED', 'Install CPython 3.10–3.12 or select its executable in serving setup. Global Python packages are never changed.', 409);
    await commandOutput(selected[0], [...selected[1], '-I', '-m', 'venv', env], { signal, onLog, timeoutMs: 120000 });
    await commandOutput(pythonPath(), ['-I', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple', '--disable-pip-version-check', '-r', path.join(here, 'requirements.txt')], { signal, onLog, timeoutMs: 300000 });
    const result = await probeEnvironment(); if (!result.ready) fail('SERVING_DEPENDENCIES', result.detail, 409, result); return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export function launchLitServe(manifest, cwd, onLog) { return spawnOwned(pythonPath(), ['-I', '-u', path.join(here, 'runner.py'), manifest], { cwd, onLog, keepAliveInput: process.platform !== 'win32' }); }
