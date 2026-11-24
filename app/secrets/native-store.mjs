import { spawn } from 'node:child_process';
import { mkdir, open, lstat, realpath, readFile, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export function secretError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
const storageError = () => secretError('SECRET_STORAGE', 'The private credential store is unavailable. Keep its encrypted files and check Windows account access.');
const MAX_FILE = 4 * 1024 * 1024;
const queues = new Map();
export const defaultMachineDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FORGE', 'secrets', 'connections');

// Adapted from storage/auth.mjs (DPAPI CurrentUser, stdin) and
// office/agent-mcp.mjs (access-only .NET ACL updates). Neither legacy vault is read.
// All scripts and executable arguments are fixed; secret bytes only use stdin.
const cryptScript = decrypt => `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
const aclScript = `$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18'); if([System.IO.Directory]::Exists($p)){$a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); foreach($s in @($sid,$system)){$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}; [System.IO.Directory]::SetAccessControl($p,$a)}else{$a=New-Object System.Security.AccessControl.FileSecurity; $a.SetAccessRuleProtection($true,$false); foreach($s in @($sid,$system)){$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($s,'FullControl','Allow')))}; [System.IO.File]::SetAccessControl($p,$a)}`;

async function noLinks(target) {
  // Reject reparse points in every existing ancestor, not only the leaf.
  for (let p = target; ; p = path.dirname(p)) {
    try { if ((await lstat(p)).isSymbolicLink()) throw storageError(); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(p) === p) break;
  }
}

export function createNativeSecretStore({ directory = defaultMachineDir(), platform = process.platform, spawnImpl = spawn } = {}) {
  if (!path.isAbsolute(directory)) throw secretError('SECRET_LOCATION', 'Choose an absolute machine-private credential directory.');
  directory = path.resolve(directory);
  const file = path.join(directory, 'connections.dpapi'), lockFile = path.join(directory, 'write.lock');
  const supported = platform === 'win32' && process.platform === 'win32';
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const unavailable = () => secretError('SECRET_UNSUPPORTED', platform === 'darwin'
    ? 'Secure key entry is unavailable on this macOS build. Use a supported Windows installation; Keychain stdin integration still needs qualification.'
    : 'Secure key entry requires Windows DPAPI on this build. Use a supported Windows installation.');
  function run(script, input) {
    return new Promise((resolve, reject) => {
      let output = '', settled = false;
      const child = spawnImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.SystemRoot || 'C:\\Windows' },
      });
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(storageError()) : resolve(value); };
      const timer = setTimeout(() => { child.kill(); finish(true); }, 20000);
      child.stdout.on('data', bytes => { output += bytes.toString(); if (output.length > MAX_FILE * 2) { child.kill(); finish(true); } });
      child.stderr.resume(); // Native diagnostics can contain credentials: never surface or log them.
      child.once('error', () => finish(true));
      child.once('close', code => finish(code !== 0, output));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }
  async function secure(target) {
    await noLinks(target);
    if (supported) await run(aclScript, target);
    else await chmod(target, (await lstat(target)).isDirectory() ? 0o700 : 0o600);
  }
  async function inspect() {
    await noLinks(directory);
    try {
      const s = await lstat(directory);
      if (!s.isDirectory() || path.resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw storageError();
      const f = await lstat(file);
      if (!f.isFile() || f.isSymbolicLink() || f.nlink !== 1 || f.size > MAX_FILE) throw storageError();
      return true;
    } catch (e) { if (e.code === 'ENOENT') return false; throw storageError(); }
  }
  async function load() {
    if (!supported) throw unavailable();
    if (!await inspect()) return null;
    await secure(directory); await secure(file);
    const raw = await run(cryptScript(true), (await readFile(file)).toString('base64'));
    try { return JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8')); }
    catch { throw storageError(); }
  }
  async function save(value) {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > MAX_FILE / 2) throw secretError('SECRET_CAPACITY', 'The private credential store is full. Contact local support before creating more entries.');
    const raw = await run(cryptScript(false), bytes.toString('base64'));
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.trim())) throw storageError();
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    let h;
    try {
      h = await open(temp, 'wx', 0o600); await h.writeFile(Buffer.from(raw.trim(), 'base64')); await h.sync(); await h.close(); h = null;
      await secure(temp); await inspect(); await rename(temp, file);
    } finally { await h?.close(); await unlink(temp).catch(() => {}); }
  }
  return {
    supported, backend: supported ? 'windows-dpapi-current-user' : 'unsupported',
    async status() {
      if (!supported) return { supported: false, backend: 'unsupported', status: 'unsupported', message: unavailable().message };
      try { return { supported: true, backend: 'windows-dpapi-current-user', status: await inspect() ? 'ready' : 'empty' }; }
      catch { return { supported: true, backend: 'windows-dpapi-current-user', status: 'unavailable', message: storageError().message }; }
    },
    async read() { try { return await load(); } catch (e) { if (['SECRET_STORAGE', 'SECRET_UNSUPPORTED'].includes(e.code)) throw e; throw storageError(); } },
    async transaction(fn) {
      if (!supported) throw unavailable();
      const task = (queues.get(directory) ?? Promise.resolve()).catch(() => {}).then(async () => {
        let lock;
        try {
          await noLinks(directory); await mkdir(directory, { recursive: true, mode: 0o700 }); await secure(directory);
          // OS-exclusive file prevents lost updates between processes. A crash lock
          // is deliberately fail-closed: never guess whether another writer owns it.
          try { lock = await open(lockFile, 'wx', 0o600); }
          catch (e) { if (e.code === 'EEXIST') throw secretError('SECRET_BUSY', 'Credential save is locked. Close other FORGE instances; after an abrupt stop, recover the machine-only write.lock before retrying the same operation.'); throw e; }
          const state = await load();
          const { next, result } = await fn(state);
          if (next) await save(next);
          return result;
        } catch (e) { if (typeof e.code === 'string' && e.code.startsWith('SECRET_')) throw e; throw storageError(); }
        finally { if (lock) { await lock.close(); await unlink(lockFile).catch(() => {}); } }
      });
      queues.set(directory, task);
      try { return await task; } finally { if (queues.get(directory) === task) queues.delete(directory); }
    },
  };
}
