import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fail } from '../server/domain.mjs';
import { hash, id } from './common.mjs';

// Windows DPAPI CurrentUser: only the signed-in OS account can unprotect new OAuth credentials.
// Secrets travel on stdin, never process arguments; vault directory is outside portable application state.
export function createWindowsVault({ directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FORGE', 'secrets', 'storage') } = {}) {
  if (!path.isAbsolute(directory)) fail('SETUP_REQUIRED', 'Credential vault directory must be an absolute machine-local path');
  async function crypt(bytes, decrypt) {
    if (process.platform !== 'win32') fail('SETUP_REQUIRED', 'Configure an OS credential vault or an environment secret reference');
    const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      let output = '';
      const timer = setTimeout(() => child.kill(), 15000);
      child.stdout.on('data', b => { output += b; });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error('OS credential vault unavailable'), { code: 'AUTH_REQUIRED' })); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(Object.assign(new Error('OS credential vault unavailable'), { code: 'AUTH_REQUIRED' })); });
      child.stdin.on('error', () => {});
      child.stdin.end(bytes.toString('base64'));
    });
  }
  return {
    async get(name) {
      id(name);
      try { return (await crypt(await readFile(path.join(directory, `${name}.dpapi`)), true)).toString(); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async set(name, value) {
      id(name); await mkdir(directory, { recursive: true });
      const file = path.join(directory, `${name}.dpapi`), tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, await crypt(Buffer.from(value), false), { flag: 'wx', mode: 0o600 });
      await rename(tmp, file);
    },
  };
}

export function createDriveAuth({ vault = process.platform === 'win32' ? createWindowsVault() : null, env = process.env, fetchImpl = fetch } = {}) {
  const pending = new Map(), cache = new Map();
  async function read(ref) {
    if (typeof ref !== 'string' || !/^(env|vault):[A-Za-z0-9_-]{1,100}$/.test(ref)) fail('SETUP_REQUIRED', 'Select an environment or machine vault secret reference');
    const [kind, name] = ref.split(':');
    const value = kind === 'env' ? env[name] : await vault?.get(name);
    if (!value) fail('AUTH_REQUIRED', 'Connect Google Drive or configure the selected environment secret');
    return value;
  }
  async function tokenRequest(values) {
    let response;
    try { response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal: AbortSignal.timeout(30000), redirect: 'error' }); }
    catch { fail('AUTH_REQUIRED', 'Google sign-in could not be completed. Reconnect in Settings.'); }
    if (!response.ok) fail('AUTH_REQUIRED', 'Google sign-in expired or was rejected. Reconnect in Settings.');
    const result = await response.json();
    if (typeof result.access_token !== 'string' || !result.access_token) fail('AUTH_REQUIRED', 'Google did not return an access token');
    return result;
  }
  return {
    async token(ref) {
      let credential;
      try { const raw = await read(ref); credential = raw.trim().startsWith('{') ? JSON.parse(raw) : { access_token: raw }; }
      catch (e) { if (e.code) throw e; fail('AUTH_REQUIRED', 'The configured credential is invalid'); }
      const current = cache.get(ref);
      if (current?.expiresAt > Date.now() + 60000) return current.access_token;
      if (credential.refresh_token) {
        const result = await tokenRequest({ client_id: credential.client_id, client_secret: credential.client_secret ?? '', refresh_token: credential.refresh_token, grant_type: 'refresh_token' });
        cache.set(ref, { access_token: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000 });
        return result.access_token;
      }
      if (!credential.access_token) fail('AUTH_REQUIRED', 'Connect Google Drive in Settings');
      return credential.access_token;
    },
    async begin({ clientId, clientSecretRef, redirectUri }) {
      if (!vault?.set) fail('SETUP_REQUIRED', 'An OS credential vault is required for browser sign-in');
      if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) fail('VALIDATION', 'Supply the owner Google Desktop OAuth client ID');
      const uri = new URL(redirectUri);
      if (uri.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(uri.hostname) || uri.username || uri.password || uri.search || uri.hash) fail('VALIDATION', 'Use a loopback OAuth callback URL');
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
      // Keep only short-lived auth state in memory; never include it in portable snapshots.
      for (const [key, value] of pending) if (value.expiresAt < Date.now()) pending.delete(key);
      pending.set(state, { clientId, clientSecretRef, redirectUri, verifier, expiresAt: Date.now() + 600000 });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', state, code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' });
      return { authorizationUrl: url.href, state, expiresInSeconds: 600 };
    },
    async finish({ state, code }) {
      const session = pending.get(state);
      if (!session || session.expiresAt < Date.now() || typeof code !== 'string' || !code) fail('AUTH_REQUIRED', 'Sign-in expired. Start Connect Google Drive again.');
      pending.delete(state);
      const result = await tokenRequest({ client_id: session.clientId, client_secret: session.clientSecretRef ? await read(session.clientSecretRef) : '', code, code_verifier: session.verifier, redirect_uri: session.redirectUri, grant_type: 'authorization_code' });
      if (!result.refresh_token) fail('AUTH_REQUIRED', 'Offline access was not granted. Reconnect and consent to offline access.');
      const name = `drive-${randomUUID()}`;
      await vault.set(name, JSON.stringify({ client_id: session.clientId, client_secret: session.clientSecretRef ? await read(session.clientSecretRef) : undefined, refresh_token: result.refresh_token }));
      return { connected: true, secretRef: `vault:${name}`, scope: result.scope ?? 'https://www.googleapis.com/auth/drive.file' };
    },
  };
}
