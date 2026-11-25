// Actual Windows DPAPI/ACL qualification using invented disposable values only.
// No Owner vault, environment key or account is inspected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createSecretService } from '../app/secrets/index.mjs';
import { createNativeSecretStore } from '../app/secrets/native-store.mjs';

function childRun(executable, args, input) {
  return new Promise((resolve, reject) => {
    const c = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '';
    c.stdout.on('data', b => out += b); c.stderr.resume(); c.once('error', reject);
    c.once('close', code => code === 0 ? resolve(out) : reject(new Error('Disposable child verification failed')));
    c.stdin.on('error', () => {}); c.stdin.end(input);
  });
}

test('actual DPAPI CurrentUser encrypts on disk, restarts in a new process, uses private ACL and deletes safely', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-secrets-dpapi-fixture-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'forge-secrets-dpapi-fixture-'))); await rm(root, { recursive: true, force: true }); });
  const directory = path.join(root, 'private'), calls = [], projectId = randomUUID();
  const nativeStore = createNativeSecretStore({ directory, spawnImpl(exe, args, options) { calls.push({ exe, args, env: options.env, shell: options.shell }); return spawn(exe, args, options); } });
  const service = await createSecretService({ machineDir: directory, nativeStore });
  assert.deepEqual(await readdir(root), []); // Factory/status do not create vault.
  assert.equal((await service.status({ projectId })).status, 'empty'); assert.equal(calls.length, 0);
  assert.equal(service.bindingStamp(),'empty');assert.equal(calls.length,0);
  const value = `disposable-dpapi-${randomUUID()}`, operationId = randomUUID();
  const input = { projectId, purpose: 'provider', name: 'FORGE_FIXTURE_DPAPI', value, expectedRevision: 0, operationId };
  const saved = await service.set(input);
  const disk = await readFile(path.join(directory, 'connections.dpapi'));
  const stamp=service.bindingStamp(),beforeStampCalls=calls.length;assert.match(stamp,/^[a-f0-9]{64}$/);assert.equal(service.bindingStamp(),stamp);assert.equal(calls.length,beforeStampCalls,'the phase fence reads only encrypted bytes, never decrypts or spawns');
  await writeFile(path.join(directory,'write.lock'),'fixture-writer');assert.throws(()=>service.bindingStamp(),{code:'SECRET_BUSY'});await rm(path.join(directory,'write.lock'));
  assert.ok(!disk.includes(Buffer.from(value))); assert.ok(!disk.includes(Buffer.from(projectId))); assert.ok(!disk.includes(Buffer.from('FORGE_FIXTURE_DPAPI')));
  assert.equal(await service.resolveEnv({ projectId, purpose: 'provider', name: saved.secret.envName }), value);
  assert.ok(calls.every(c => path.isAbsolute(c.exe) && c.shell === false));
  assert.ok(!JSON.stringify(calls).includes(value)); assert.ok(!JSON.stringify(calls).includes(Buffer.from(value).toString('base64')));
  const moduleUrl = new URL('../app/secrets/index.mjs', import.meta.url).href;
  const restartCode = `import {createSecretService} from ${JSON.stringify(moduleUrl)};let raw='';for await(const c of process.stdin)raw+=c;const f=JSON.parse(raw);const s=await createSecretService({machineDir:f.directory});const r=await s.set(f.input);const v=await s.resolveRef({projectId:f.input.projectId,reference:r.secret.reference,purpose:'provider'});process.stdout.write(JSON.stringify({replayed:r.replayed,matches:v===f.input.value,reference:r.secret.reference}));`;
  const child = JSON.parse(await childRun(process.execPath, ['--input-type=module', '-e', restartCode], JSON.stringify({ directory, input })));
  assert.deepEqual(child, { replayed: true, matches: true, reference: saved.secret.reference });
  const aclScript = `$ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd();$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$r=@();foreach($f in @($p,(Join-Path $p 'connections.dpapi'))){$a=Get-Acl -LiteralPath $f;$r+=@{protected=$a.AreAccessRulesProtected;rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object{@{sid=$_.IdentityReference.Value;inherited=$_.IsInherited;type=$_.AccessControlType.ToString()}})}};@{sid=$sid;entries=$r}|ConvertTo-Json -Depth 5 -Compress`;
  const acl = JSON.parse(await childRun(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', aclScript], directory));
  for (const entry of acl.entries) { assert.equal(entry.protected, true); assert.ok(entry.rules.length >= 1); for (const r of entry.rules) { assert.ok([acl.sid, 'S-1-5-18'].includes(r.sid)); assert.equal(r.inherited, false); assert.equal(r.type, 'Allow'); } }
  const removed = await service.remove({ projectId, purpose: 'provider', reference: saved.secret.reference, expectedRevision: 1, operationId: randomUUID() });
  assert.equal(removed.removed, true); assert.ok(!JSON.stringify(removed).includes(value));
  assert.notEqual(service.bindingStamp(),stamp,'rotation/deletion changes the encrypted-state fence');
  const restarted = await createSecretService({ machineDir: directory });
  await assert.rejects(restarted.resolveRef({ projectId, reference: saved.secret.reference }), { code: 'SECRET_SETUP_REQUIRED' });
  assert.deepEqual(await readdir(directory), ['connections.dpapi']);
  // Corruption must not silently fall back to a selected environment variable.
  await writeFile(path.join(directory, 'connections.dpapi'), Buffer.from('corrupt-disposable-fixture'));
  const corrupt = await createSecretService({ machineDir: directory, env: { FORGE_FIXTURE_DPAPI: 'must-not-fallback' } });
  await assert.rejects(corrupt.resolveEnv({ projectId, purpose: 'provider', name: saved.secret.envName }), { code: 'SECRET_STORAGE' });
});

test('machine-store reparse points are rejected without reading target credentials', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-secrets-links-fixture-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'forge-secrets-links-fixture-'))); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, 'target'));
  await symlink(path.join(root, 'target'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const native = createNativeSecretStore({ directory: path.join(root, 'link', 'private') });
  const status = await native.status();
  if (process.platform === 'win32') { assert.equal(status.status, 'unavailable'); await assert.rejects(native.read(), { code: 'SECRET_STORAGE' }); }
  assert.deepEqual(await readdir(path.join(root, 'target')), []);
});
