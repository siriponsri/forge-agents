import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDriveAdapter } from '../app/storage/drive.mjs';
import { createDriveAuth, createWindowsVault } from '../app/storage/auth.mjs';
import { createStorageService } from '../app/storage/service.mjs';
import { createArtifactService } from '../app/server/artifacts.mjs';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { hash } from '../app/storage/common.mjs';

// In-process HTTP contract fixture: validates official host/path/query/headers and real binary data.
// This is not a signed-in Drive account and is never labeled live qualification.
function driveFixture() {
  const files = new Map(), sessions = new Map(), calls = [];
  let number = 0, loseAcknowledgement = false, rateLimit = 0, unavailable = 0, deny = false;
  const response = (value, status = 200, headers = {}) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    assert.equal(u.hostname, 'www.googleapis.com'); assert.equal(u.protocol, 'https:');
    assert.equal(init.headers.Authorization, 'Bearer fixture-access-token'); assert.equal(init.redirect, 'error');
    calls.push({ path: u.pathname, method, contentRange: init.headers['Content-Range'] });
    if (deny) return response({ error: { message: 'provider message fixture-access-token should never persist' } }, 403);
    if (rateLimit-- > 0) return response({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403, { 'Retry-After': '0' });
    if (unavailable-- > 0) return response({ error: { message: 'fixture-access-token' } }, 503);
    if (u.pathname === '/drive/v3/files/generateIds') return response({ ids: [`allocated-${++number}`] });
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      assert.equal(u.searchParams.get('uploadType'), 'resumable');
      const meta = JSON.parse(init.body);
      assert.equal(meta.parents[0], 'selected-folder');
      const session = `https://www.googleapis.com/upload/drive/v3/session/${meta.id}`;
      sessions.set(meta.id, { meta, bytes: Buffer.alloc(0), total: Number(init.headers['X-Upload-Content-Length']) });
      return response({}, 200, { Location: session });
    }
    if (u.pathname.startsWith('/upload/drive/v3/session/')) {
      const session = sessions.get(u.pathname.split('/').at(-1)); assert.ok(session);
      const range = init.headers['Content-Range'];
      if (/^bytes \*\//.test(range) && init.body === undefined) {
        if (files.has(session.meta.id)) return response(session.meta);
        return response(null, 308, session.bytes.length ? { Range: `bytes=0-${session.bytes.length - 1}` } : {});
      }
      if (session.total) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range); assert.ok(match);
        assert.equal(Number(match[1]), session.bytes.length); assert.equal(Number(match[3]), session.total);
        session.bytes = Buffer.concat([session.bytes, Buffer.from(init.body)]);
      }
      if (session.bytes.length === session.total) files.set(session.meta.id, { ...session.meta, bytes: session.bytes });
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new TypeError('simulated lost ACK with fixture-access-token'); }
      if (session.bytes.length === session.total) return response(session.meta);
      assert.equal(session.bytes.length % (256 * 1024), 0);
      return response(null, 308, { Range: `bytes=0-${session.bytes.length - 1}` });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q'); assert.match(q, /trashed = false/);
      const key = /key='forgeKey' and value='([^']+)'/.exec(q)?.[1];
      return response({ files: [...files.values()].filter(f => !key || f.appProperties.forgeKey === key).map(({ bytes,...f }) => f) });
    }
    if (u.pathname === '/drive/v3/files/selected-folder') return response({ id: 'selected-folder', name: 'Owner-selected fixture folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true }, trashed: false });
    const fileId = u.pathname.split('/').at(-1), file = files.get(fileId);
    if (method === 'DELETE') { files.delete(fileId); return response(null, 204); }
    if (!file) return response({ error: { message: 'not found' } }, 404);
    assert.equal(u.searchParams.get('alt'), 'media');
    return new Response(file.bytes, { status: 200 });
  };
  return { fetchImpl, calls, files, set loseAcknowledgement(v) { loseAcknowledgement = v; }, set rateLimit(v) { rateLimit = v; }, set unavailable(v) { unavailable = v; }, set deny(v) { deny = v; } };
}
const auth = () => createDriveAuth({ env: { DRIVE_FIXTURE: 'fixture-access-token' } });
const adapter = f => createDriveAdapter({ folderId: 'selected-folder', secretRef: 'env:DRIVE_FIXTURE', auth: auth(), fetchImpl: f.fetchImpl, wait: async () => {} });

test('Drive REST contract resumes lost chunk acknowledgements, verifies downloads and reuses immutable file keys', async () => {
  const f = driveFixture(), drive = adapter(f), bytes = Buffer.alloc(2 * 1024 * 1024 + 19, 0x8a), key = 'projects/example/bundles/revision/files/weights.bin';
  assert.equal((await drive.health()).status, 'ready');
  f.rateLimit = 1; f.loseAcknowledgement = true;
  await drive.put(key, bytes);
  assert.deepEqual(await drive.get(key), bytes);
  assert.ok(f.calls.some(c => c.contentRange === `bytes */${bytes.length}`));
  assert.equal(f.files.size, 1);
  await drive.put(key, bytes); assert.equal(f.files.size, 1);
  await assert.rejects(drive.put(key, Buffer.from('different data')), { code: 'INTEGRITY' });
  assert.deepEqual(await drive.list('projects/example/bundles'), [key]);
  await drive.delete(key); assert.equal(await drive.get(key), null);
});

test('Drive transient and permission errors are bounded, actionable and never include credential/provider text', async () => {
  const f = driveFixture(), drive = adapter(f);
  f.unavailable = 3;
  await assert.rejects(drive.health(), e => e.code === 'DRIVE_UNAVAILABLE' && !/fixture-access-token/.test(e.message));
  assert.equal(f.calls.length, 3);
  f.deny = true;
  await assert.rejects(drive.health(), e => e.code === 'DRIVE_PERMISSION' && !/fixture-access-token/.test(e.message));
  assert.equal(f.calls.length, 4);
  const missing = createDriveAdapter({ folderId: 'selected-folder', secretRef: 'env:MISSING', auth: createDriveAuth({ env: {} }), fetchImpl: f.fetchImpl });
  await assert.rejects(missing.health(), { code: 'AUTH_REQUIRED' });
});

test('Drive detects duplicate keys and refuses silent overwrite', async () => {
  const f = driveFixture(), drive = adapter(f), key = 'projects/example/bundles/rev/manifest.json';
  await drive.put(key, Buffer.from('original'));
  const first = [...f.files.values()][0]; f.files.set('duplicate', { ...first, id: 'duplicate' });
  await assert.rejects(drive.get(key), { code: 'DRIVE_AMBIGUOUS' });
  await assert.rejects(drive.put(key, Buffer.from('replacement')), { code: 'DRIVE_AMBIGUOUS' });
  assert.equal(f.files.size, 2);
});

test('complete project bytes transfer through Drive REST adapter and restore with no secret in snapshots or manifest', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-drive-fixture-')), dataDir = path.join(root, 'state'), workspace = path.join(root, 'workspace'), f = driveFixture();
  const store = await openStore(dataDir); t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = (await command(store, { operationId: crypto.randomUUID(), type: 'project.create', data: { name: 'Drive contract fixture', workspace } })).entity;
  await writeFile(path.join(workspace, 'weights.bin'), Buffer.from([7,8,9]));
  const artifacts = createArtifactService({ store, dataDir }); await artifacts.register({ projectId: project.id, path: 'weights.bin', kind: 'model' });
  const service = await createStorageService({ dataDir, store, artifacts, env: { DRIVE_FIXTURE: 'fixture-access-token' }, fetchImpl: f.fetchImpl, wait: async () => {} });
  await service.configure({ operationId: crypto.randomUUID(), projectId: project.id, expectedRevision: 1, destinations: [{ id: 'drive', name: 'Drive fixture', kind: 'drive', folderId: 'selected-folder', secretRef: 'env:DRIVE_FIXTURE' }], routes: [{ kinds: ['*'], destinationIds: ['drive'] }] });
  const input = () => ({ operationId: crypto.randomUUID(), projectId: project.id, destinationId: 'drive' });
  const backup = await service.backup(input()); assert.equal(backup.status, 'completed', JSON.stringify(backup.error));
  const target = path.join(root, 'restored');
  const restored = await service.restore({ ...input(), bundleId: backup.bundleId, manifestSha256: backup.manifestSha256, targetDirectory: target, expectedRevision: 2 });
  assert.equal(restored.status, 'completed', JSON.stringify(restored.error)); assert.deepEqual(await readFile(path.join(target, 'weights.bin')), Buffer.from([7,8,9]));
  assert.doesNotMatch(JSON.stringify(store.read()), /fixture-access-token/);
  for (const file of f.files.values()) if (file.name.endsWith('/manifest.json')) assert.doesNotMatch(file.bytes.toString(), /fixture-access-token|DRIVE_FIXTURE|secretRef/);
});

test('OAuth PKCE state, offline token refresh and machine-only vault keep credentials out of public results', async () => {
  const secrets = new Map(), requests = [];
  const vault = { get: async name => secrets.get(name), set: async (name, value) => secrets.set(name, value) };
  const oauth = createDriveAuth({ vault, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); requests.push(init.body);
    return new Response(JSON.stringify({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }), { status: 200 });
  } });
  const begun = await oauth.begin({ clientId: 'fixture.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:4400/api/storage/oauth/callback' });
  const url = new URL(begun.authorizationUrl); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('access_type'), 'offline');
  await assert.rejects(oauth.finish({ state: 'wrong', code: 'code' }), { code: 'AUTH_REQUIRED' });
  const done = await oauth.finish({ state: begun.state, code: 'owner-provided-auth-code' });
  assert.match(done.secretRef, /^vault:drive-/); assert.doesNotMatch(JSON.stringify(done), /private-(access|refresh)-token/);
  assert.equal(Buffer.from(hash(requests[0].get('code_verifier')), 'hex').toString('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(await oauth.token(done.secretRef), 'private-access-token'); assert.equal(requests[1].get('grant_type'), 'refresh_token');
  assert.equal(await oauth.token(done.secretRef), 'private-access-token'); assert.equal(requests.length, 2);
  await assert.rejects(oauth.finish({ state: begun.state, code: 'replay' }), { code: 'AUTH_REQUIRED' });
  await assert.rejects(oauth.begin({ clientId: 'fixture.apps.googleusercontent.com', redirectUri: 'https://public.invalid/callback' }), { code: 'VALIDATION' });
});

test('Windows machine vault encrypts a disposable credential with DPAPI and reads across instances', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forge-dpapi-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = createWindowsVault({ directory }), secret = 'disposable-DPAPI-fixture-value';
  await vault.set('engineering-fixture', secret);
  assert.doesNotMatch((await readFile(path.join(directory, 'engineering-fixture.dpapi'))).toString(), new RegExp(secret));
  assert.equal(await createWindowsVault({ directory }).get('engineering-fixture'), secret);
});
