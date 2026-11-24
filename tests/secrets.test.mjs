import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { createSecretService, dispatchSecretRequest, SECRET_HTTP_METHODS } from '../app/secrets/index.mjs';
import { secretFixture } from './secrets-fixture.test.mjs';

test('scoped GUI save yields safe reference/name, no canonical writes or public key fingerprint', async () => {
  const f = await secretFixture(), input = f.input();
  const before = JSON.stringify(f.canonical);
  const saved = await dispatchSecretRequest(f.service, 'set', input);
  assert.equal(saved.secret.envName, 'FORGE_KOB_KEY');
  assert.match(saved.secret.reference, /^vault:[a-f0-9-]{36}$/);
  assert.equal(saved.secret.projectId, f.projectId); assert.equal(saved.secret.revision, 1);
  assert.equal(await f.service.resolveEnv({ projectId: f.projectId, name: saved.secret.envName, purpose: 'provider' }), input.value);
  assert.equal(await f.service.resolveRef({ projectId: f.projectId, reference: saved.secret.reference, purpose: 'provider' }), input.value);
  const list = await f.service.list({ projectId: f.projectId });
  assert.deepEqual(list.secrets, [saved.secret]);
  const output = JSON.stringify([saved, list, await f.service.status({ projectId: f.projectId })]);
  assert.ok(!output.includes(input.value)); assert.doesNotMatch(output, /fingerprint|replayKey|"value"/);
  assert.equal(JSON.stringify(f.canonical), before);
  assert.ok(!JSON.stringify(f.privateState().operations).includes(input.value));
  assert.ok(!JSON.stringify(f.privateState().operations).includes(createHash('sha256').update(input.value).digest('hex')));
  const generated = await f.service.set(f.input({ name: undefined, purpose: 'relay' }));
  assert.match(generated.secret.envName, /^FORGE_RELAY_[A-F0-9]{12}$/);
});

test('exact project/purpose grants and fail-closed lookup never infer env defaults', async () => {
  const f = await secretFixture(), input = f.input(), { secret } = await f.service.set(input);
  for (const args of [{ projectId: f.foreignId, purpose: 'provider' }, { projectId: f.projectId, purpose: 'mcp' }]) {
    await assert.rejects(f.service.resolveRef({ ...args, reference: secret.reference }), { code: 'SECRET_SETUP_REQUIRED' });
  }
  assert.deepEqual((await f.service.list({ projectId: f.foreignId })).secrets, []);
  f.env.FORGE_KOB_KEY = 'old-machine-value';
  await assert.rejects(f.service.resolveEnv({ projectId: f.projectId, name: secret.name, purpose: 'mcp' }), { code: 'SECRET_SETUP_REQUIRED' });
  for (const name of [undefined, '', 'KEY=bad', 'KOB KEY']) await assert.rejects(f.service.resolveEnv({ projectId: f.projectId, name }), { code: 'SECRET_SETUP_REQUIRED' });
  await assert.rejects(f.service.resolveEnv({ projectId: f.projectId, name: 'MISSING_EXPLICIT_KEY' }), { code: 'SECRET_SETUP_REQUIRED' });
  assert.equal(await f.service.resolveRef({ projectId: f.projectId, reference: 'env:FIXTURE_EXPLICIT_KEY' }), f.env.FIXTURE_EXPLICIT_KEY);
  assert.equal(await f.service.resolveEnv({ projectId: f.projectId, name: 'FIXTURE_EXPLICIT_KEY' }), f.env.FIXTURE_EXPLICIT_KEY);
  for (const reference of [undefined, '', 'FORGE_KOB_KEY', 'vault:mcp-owner-credential', 'vault:../../owner', 'env:']) await assert.rejects(f.service.resolveRef({ projectId: f.projectId, reference }), { code: 'SECRET_SETUP_REQUIRED' });
  await assert.rejects(f.service.set(f.input({ projectId: randomUUID() })), { code: 'SECRET_SCOPE' });
  await f.service.set(f.input({ purpose: 'mcp' }));
  await assert.rejects(f.service.resolveEnv({ projectId: f.projectId, name: secret.name }), { code: 'SECRET_SCOPE' });
  assert.equal(await f.service.resolveEnv({ projectId: f.projectId, name: secret.name, purpose: 'mcp' }), input.value);
});

test('durable replay, rotation fencing, concurrent revision gate and credential-free deletion', async () => {
  const f = await secretFixture(), input = f.input(), saved = await f.service.set(input);
  const restarted = await createSecretService(f.options);
  assert.deepEqual(await restarted.set(input), { ...saved, replayed: true });
  await assert.rejects(restarted.set({ ...input, value: 'other-disposable-value' }), { code: 'SECRET_OPERATION_REUSE' });
  await assert.rejects(restarted.set(f.input()), { code: 'SECRET_REVISION_CONFLICT' });
  const rotate = f.input({ reference: saved.secret.reference, expectedRevision: 1, value: 'rotated-disposable-value' });
  const results = await Promise.allSettled([restarted.set(rotate), restarted.set({ ...rotate, operationId: randomUUID() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SECRET_REVISION_CONFLICT');
  const rotated = results.find(r => r.status === 'fulfilled').value.secret;
  assert.equal(rotated.revision, 2); assert.ok(rotated.generation > saved.secret.generation);
  await assert.rejects(restarted.resolveRef({ projectId: f.projectId, reference: rotated.reference, purpose: 'provider', generation: saved.secret.generation }), { code: 'SECRET_REVISION_CONFLICT' });
  await assert.rejects(restarted.resolveEnv({ projectId: f.projectId, name: rotated.envName, purpose: 'provider', expectedRevision: 1 }), { code: 'SECRET_REVISION_CONFLICT' });
  assert.equal(await restarted.resolveRef({ projectId: f.projectId, reference: rotated.reference, purpose: 'provider', expectedRevision: 2, generation: rotated.generation }), rotate.value);
  // Replaying a much earlier save does not rotate the current value back.
  await restarted.set(input);
  assert.equal(await restarted.resolveRef({ projectId: f.projectId, reference: rotated.reference }), rotate.value);
  const remove = { projectId: f.projectId, purpose: 'provider', reference: rotated.reference, expectedRevision: 2, operationId: randomUUID() };
  const removed = await restarted.remove(remove);
  assert.equal(removed.removed, true); assert.equal(removed.secret.revision, 3);
  assert.ok(!JSON.stringify(removed).includes(rotate.value)); assert.ok(!JSON.stringify(f.privateState()).includes(rotate.value));
  assert.equal((await restarted.remove(remove)).replayed, true);
  assert.deepEqual((await restarted.list({ projectId: f.projectId })).secrets, []);
  f.env.FORGE_KOB_KEY = 'old-env-value';
  await assert.rejects(restarted.resolveEnv({ projectId: f.projectId, name: rotated.envName, purpose: 'provider' }), { code: 'SECRET_SETUP_REQUIRED' });
  await assert.rejects(restarted.resolveRef({ projectId: f.projectId, reference: rotated.reference }), { code: 'SECRET_SETUP_REQUIRED' });
  await assert.rejects(restarted.set(rotate).then(() => restarted.resolveRef({ projectId: f.projectId, reference: rotated.reference })), { code: 'SECRET_SETUP_REQUIRED' });
});

test('HTTP dispatch excludes runtime plaintext resolvers; rejects extras without echoing input', async () => {
  const f = await secretFixture(); assert.deepEqual(SECRET_HTTP_METHODS, ['status', 'list', 'set', 'remove']);
  for (const action of ['resolveRef', 'resolveEnv', 'constructor', '__proto__', 'close']) await assert.rejects(dispatchSecretRequest(f.service, action, { projectId: f.projectId }), { code: 'SECRET_NOT_FOUND' });
  for (const extra of [{ apiKey: 'DO_NOT_ECHO' }, { caller: 'DO_NOT_ECHO' }, { env: 'DO_NOT_ECHO' }]) await assert.rejects(f.service.set(f.input(extra)), e => e.code === 'SECRET_INPUT' && !e.message.includes('DO_NOT_ECHO'));
  for (const value of ['', 'DO_NOT_ECHO\nsecond', 'DO_NOT_ECHO\0', 'x'.repeat(16385), 42]) await assert.rejects(f.service.set(f.input({ value })), e => e.code === 'SECRET_INPUT' && !e.message.includes('DO_NOT_ECHO'));
  for (const expectedRevision of [undefined, -1, '0', NaN]) await assert.rejects(f.service.set(f.input({ expectedRevision })), { code: 'SECRET_INPUT' });
  await assert.rejects(f.service.remove({ projectId: f.projectId, purpose: 'provider', reference: 'DO_NOT_ECHO' }), e => !e.message.includes('DO_NOT_ECHO'));
});

test('corrupt or empty stored values fail closed before runtime injection', async () => {
  const f = await secretFixture(); await f.service.set(f.input());
  const corrupt = f.privateState(); corrupt.records[0].value = '';
  const broken = await createSecretService({ ...f.options, nativeStore: { ...f.nativeStore, async read() { return corrupt; } } });
  await assert.rejects(broken.list({ projectId: f.projectId }), { code: 'SECRET_STORAGE' });
  await assert.rejects(broken.resolveEnv({ projectId: f.projectId, name: 'FORGE_KOB_KEY' }), { code: 'SECRET_STORAGE' });
});

test('credentials cannot live in source/canonical/portable state; unsupported hosts never launch keyring commands', async () => {
  const f = await secretFixture();
  await assert.rejects(createSecretService({ ...f.options, machineDir: path.resolve('app/secrets/private') }), { code: 'SECRET_LOCATION' });
  await assert.rejects(createSecretService({ ...f.options, dataDir: f.options.machineDir }), { code: 'SECRET_LOCATION' });
  const unsupported = await createSecretService({ machineDir: f.options.machineDir, platform: 'darwin', env: f.env });
  const status = await unsupported.status({ projectId: f.projectId });
  assert.equal(status.supported, false); assert.match(status.message, /macOS|Keychain/);
  await assert.rejects(unsupported.set(f.input()), { code: 'SECRET_UNSUPPORTED' });
  assert.equal(await unsupported.resolveEnv({ projectId: f.projectId, name: 'FIXTURE_EXPLICIT_KEY' }), f.env.FIXTURE_EXPLICIT_KEY);
});
