// Disposable in-memory engineering fixture ONLY. Production has no plaintext
// fallback; this injected backend exercises scope/replay without an OS keyring.
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createSecretService } from '../app/secrets/index.mjs';

export async function secretFixture() {
  const projectId = randomUUID(), foreignId = randomUUID();
  const canonical = { projects: [{ id: projectId }, { id: foreignId }], events: [], receipts: [] };
  const store = { read: () => structuredClone(canonical), transaction() { throw new Error('Secrets must never write canonical state'); } };
  let privateState = null, queue = Promise.resolve();
  const nativeStore = {
    supported: true,
    async status() { return { supported: true, backend: 'fixture-only', status: privateState ? 'ready' : 'empty' }; },
    async read() { await queue; return structuredClone(privateState); },
    transaction(fn) {
      const task = queue.catch(() => {}).then(async () => { const { next, result } = await fn(structuredClone(privateState)); if (next) privateState = structuredClone(next); return result; });
      queue = task.catch(() => {}); return task;
    },
  };
  const env = { FIXTURE_EXPLICIT_KEY: 'disposable-explicit-env-value', OPENAI_API_KEY: 'never-infer-this-default' };
  const options = { store, nativeStore, env, machineDir: path.join(os.tmpdir(), `forge-vault-fixture-${randomUUID()}`) };
  return { projectId, foreignId, canonical, nativeStore, env, options, service: await createSecretService(options), privateState: () => structuredClone(privateState),
    input: (extra = {}) => ({ projectId, purpose: 'provider', name: 'FORGE_KOB_KEY', value: 'disposable-fixture-key-ONLY', expectedRevision: 0, operationId: randomUUID(), ...extra }) };
}
