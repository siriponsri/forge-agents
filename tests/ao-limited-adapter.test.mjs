import assert from 'node:assert/strict';
import {
  AoLimitedAdapter, AoLimitedError, aoLimitedPolicySurface, assertAllowedAoSurface,
  mapAoExecutionReceipt, normalizeAoError, resolveProviderDaemon, selectExecutionBackend
} from '../adapters/ao/limited-adapter.mjs';

const tests = [];
const now = '2026-09-17T00:00:00.000Z';

function test(name, fn) {
  try {
    const detail = fn();
    tests.push({ name, pass: true, detail: detail ?? 'PASS' });
  } catch (error) {
    tests.push({ name, pass: false, detail: { message: error.message, code: error.code ?? null } });
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    const detail = await fn();
    tests.push({ name, pass: true, detail: detail ?? 'PASS' });
  } catch (error) {
    tests.push({ name, pass: false, detail: { message: error.message, code: error.code ?? null } });
    throw error;
  }
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof AoLimitedError && error.code === code);
}

const policy = {
  ao_limited_enabled: true,
  spawn_timeout_ms: 5000,
  cleanup_timeout_ms: 3000,
  provider_daemons: {
    official: { boundary_id: 'ao-official', base_url: 'http://127.0.0.1:43121', data_root_id: 'data-official', run_file_id: 'run-official' },
    maxplus: { boundary_id: 'ao-maxplus', base_url: 'http://127.0.0.1:43122', data_root_id: 'data-maxplus', run_file_id: 'run-maxplus' }
  }
};

test('native is default', () => {
  assert.equal(selectExecutionBackend({}, policy), 'native');
});

test('AO requires explicit feature gate', () => {
  expectCode(() => selectExecutionBackend({ execution_backend: 'ao' }, { ...policy, ao_limited_enabled: false }), 'AO_FEATURE_DISABLED');
});

test('AO is worker-only', () => {
  expectCode(() => selectExecutionBackend({ execution_backend: 'ao', kind: 'orchestrator' }, policy), 'AO_WORKER_ONLY');
});

test('provider boundaries are deterministic and distinct', () => {
  const a = resolveProviderDaemon('official', policy);
  const b = resolveProviderDaemon('maxplus', policy);
  assert.notEqual(a.boundary_id, b.boundary_id);
  assert.notEqual(a.base_url, b.base_url);
  return { official: a, maxplus: b };
});

test('unknown provider fails closed', () => {
  expectCode(() => resolveProviderDaemon('unknown', policy), 'PROVIDER_BOUNDARY_UNKNOWN');
});

test('non-loopback AO daemon fails closed', () => {
  const unsafe = structuredClone(policy);
  unsafe.provider_daemons.official.base_url = 'http://192.168.1.10:43121';
  expectCode(() => resolveProviderDaemon('official', unsafe), 'AO_LOOPBACK_REQUIRED');
});

test('account-management API surfaces are denied', () => {
  for (const endpoint of ['/api/v1/agents/codex/accounts', '/api/v1/codex/accounts/a/switch', '/account/add', '/auth']) {
    expectCode(() => assertAllowedAoSurface(endpoint), 'AO_SURFACE_DENIED');
  }
});

test('account-management CLI surfaces are denied', () => {
  for (const command of ['ao codex-login', 'ao accounts switch fixture', 'account import x']) {
    expectCode(() => assertAllowedAoSurface(command, 'command'), 'AO_SURFACE_DENIED');
  }
});

test('UNKNOWN semantics are preserved', () => {
  const receipt = mapAoExecutionReceipt({ provider_id: 'official', boundary_id: 'ao-official', project_id: 'p', state: 'NEW_UPSTREAM_STATE' });
  assert.equal(receipt.state, 'UNKNOWN');
  assert.equal(receipt.source_state, 'NEW_UPSTREAM_STATE');
  return receipt.receipt_id;
});

test('timeout and unknown errors normalize distinctly', () => {
  const timeout = normalizeAoError(Object.assign(new Error('late'), { code: 'ETIMEDOUT' }), 'spawn');
  const unknown = normalizeAoError(new Error('opaque'), 'spawn');
  assert.equal(timeout.code, 'AO_TIMEOUT');
  assert.equal(unknown.code, 'AO_UNKNOWN');
});

const nativeCalls = [];
const nativeExecutor = {
  async execute(task, context) {
    nativeCalls.push({ task, context });
    return { backend: 'native', state: 'SUCCEEDED', context, model_backed_calls: 0 };
  }
};

await testAsync('native path remains functional', async () => {
  const adapter = new AoLimitedAdapter({ policy, transport: {}, nativeExecutor, clock: () => now });
  const result = await adapter.execute({}, { project_id: 'p', name: 'n', prompt: 'fixture' });
  assert.equal(result.backend, 'native');
  assert.equal(result.context.reason, 'NATIVE_DEFAULT');
});

await testAsync('explicit AO path maps structured receipt', async () => {
  const transport = {
    async spawn(boundary, request) {
      assert.equal(request.kind, 'worker');
      assert.equal(boundary.boundary_id, 'ao-official');
      return { session_id: 'ao-1', workspace_ref: 'worktree:ao-1', state: 'RUNNING', model_backed_calls: 0, evidence: { fixture: true } };
    }
  };
  const adapter = new AoLimitedAdapter({ policy, transport, nativeExecutor, clock: () => now });
  const result = await adapter.execute(
    { execution_backend: 'ao', kind: 'worker', provider_id: 'official', harness: 'fixture' },
    { project_id: 'p', name: 'n', prompt: 'fixture' }
  );
  assert.equal(result.backend, 'ao');
  assert.equal(result.authority, 'FORGE');
  assert.equal(result.qa_authority, 'FORGE_INDEPENDENT_QA');
  assert.equal(result.model_backed_calls, 0);
  return result;
});

await testAsync('pre-session AO failure may explicitly fall back to native', async () => {
  const transport = { async spawn() { throw Object.assign(new Error('late'), { code: 'ETIMEDOUT' }); } };
  const adapter = new AoLimitedAdapter({ policy, transport, nativeExecutor, clock: () => now });
  const result = await adapter.execute(
    { execution_backend: 'ao', kind: 'worker', provider_id: 'official', harness: 'fixture', fallback_to_native: true },
    { project_id: 'p', name: 'n', prompt: 'fixture' }
  );
  assert.equal(result.backend, 'native');
  assert.equal(result.context.fallback_from, 'ao');
  assert.equal(result.context.reason, 'AO_TIMEOUT');
});

await testAsync('AO failure without explicit fallback remains fail-closed', async () => {
  const transport = { async spawn() { throw new Error('opaque'); } };
  const adapter = new AoLimitedAdapter({ policy, transport, nativeExecutor, clock: () => now });
  await assert.rejects(
    adapter.execute(
      { execution_backend: 'ao', kind: 'worker', provider_id: 'official', harness: 'fixture' },
      { project_id: 'p', name: 'n', prompt: 'fixture' }
    ),
    error => error.code === 'AO_UNKNOWN'
  );
});

await testAsync('cleanup produces structured receipt', async () => {
  const transport = { async cleanup() { return { state: 'CLEANED', workspace_disposition: 'REMOVED' }; } };
  const adapter = new AoLimitedAdapter({ policy, transport, nativeExecutor, clock: () => now });
  const receipt = await adapter.cleanup(resolveProviderDaemon('official', policy), 'ao-1');
  assert.equal(receipt.state, 'CLEANED');
  assert.equal(receipt.model_backed_calls, 0);
  return receipt;
});


assert.equal(tests.length, 15);
assert.equal(tests.every(item => item.pass), true);
console.log(JSON.stringify({ verdict: 'PASS', tests: tests.length, passed: tests.length, fixture_only: true, model_backed_calls: 0 }, null, 2));
