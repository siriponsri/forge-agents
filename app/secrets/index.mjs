import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeSecretStore, defaultMachineDir, secretError } from './native-store.mjs';

export const SECRET_HTTP_METHODS = Object.freeze(['status', 'list', 'set', 'remove']);
export const SECRET_PURPOSES = Object.freeze(['provider', 'mcp', 'compute', 'relay', 'storage']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const fail = (code, message, status = 409) => { throw secretError(code, message, status); };
function exact(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) fail('SECRET_INPUT', 'Use only the documented secret setup fields.', 400);
}
function purpose(value, optional = false) {
  if (optional && value === undefined) return;
  if (!SECRET_PURPOSES.includes(value)) fail('SECRET_INPUT', 'Choose provider, MCP, compute, relay or storage purpose.', 400);
  return value;
}
function envName(value) { if (typeof value !== 'string' || !NAME.test(value)) fail('SECRET_SETUP_REQUIRED', 'Select an exact saved key name in Settings.', 409); return value; }
function refId(value) { if (typeof value !== 'string' || !value.startsWith('vault:') || !UUID.test(value.slice(6))) fail('SECRET_SETUP_REQUIRED', 'Select a saved machine credential reference in Settings.'); return value.slice(6); }
const metadata = r => Object.fromEntries(['id', 'reference', 'projectId', 'purpose', 'name', 'envName', 'revision', 'generation', 'updatedAt'].map(k => [k, r[k]]));
function validateState(s) {
  const invalid = () => fail('SECRET_STORAGE', 'The private credential store is invalid. Preserve encrypted files for recovery.');
  if (!s || s.version !== 1 || typeof s.replayKey !== 'string' || !/^[a-f0-9]{64}$/.test(s.replayKey) || !Number.isSafeInteger(s.generation) || s.generation < 0 || !Array.isArray(s.records) || !Array.isArray(s.operations)) invalid();
  const validMeta = r => r && UUID.test(r.id) && r.reference === `vault:${r.id}` && UUID.test(r.projectId) && SECRET_PURPOSES.includes(r.purpose) && typeof r.name === 'string' && NAME.test(r.name) && r.envName === r.name && Number.isSafeInteger(r.revision) && r.revision >= 1 && Number.isSafeInteger(r.generation) && r.generation >= 1 && r.generation <= s.generation && typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt));
  if (new Set(s.records.map(r => r?.id)).size !== s.records.length || new Set(s.operations.map(r => r?.operationId)).size !== s.operations.length) invalid();
  for (const r of s.records) {
    if (!validMeta(r) || r.deleted !== undefined && r.deleted !== true || (r.deleted ? Object.hasOwn(r, 'value') : typeof r.value !== 'string' || !r.value.length || Buffer.byteLength(r.value) > 16384 || /[\0\r\n]/.test(r.value))) invalid();
  }
  for (const op of s.operations) {
    if (!op || !UUID.test(op.operationId) || typeof op.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(op.fingerprint) || !validMeta(op.result?.secret) || Object.keys(op.result.secret).some(k => !['id', 'reference', 'projectId', 'purpose', 'name', 'envName', 'revision', 'generation', 'updatedAt'].includes(k)) || Object.keys(op.result).some(k => !['removed', 'secret'].includes(k))) invalid();
  }
  return s;
}
function fresh() { return { version: 1, replayKey: randomBytes(32).toString('hex'), generation: 0, records: [], operations: [] }; }
const contains = (root, value) => { const rel = path.relative(path.resolve(root), path.resolve(value)); return rel === '' || rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

/** No keyring read/write, native process or network activity at construction.
 * store is the optional canonical domain store, used READ ONLY for project IDs.
 * nativeStore/env/clock are trusted host fixtures, never accepted from HTTP.
 */
export async function createSecretService({ store, machineDir = defaultMachineDir(), dataDir, platform = process.platform, nativeStore, env = process.env, clock = () => new Date().toISOString() } = {}) {
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
  if (!path.isAbsolute(machineDir) || [sourceRoot, dataDir].filter(Boolean).some(root => contains(root, machineDir))) fail('SECRET_LOCATION', 'Machine credentials must be outside source and portable application data.');
  const vault = nativeStore ?? createNativeSecretStore({ directory: machineDir, platform });
  function project(projectId) {
    if (typeof projectId !== 'string' || !UUID.test(projectId)) fail('SECRET_SCOPE', 'Select an exact project before using credentials.', 403);
    const state = store?.read();
    if (state && !state.projects?.some(p => p.id === projectId)) fail('SECRET_SCOPE', 'The project is unavailable.', 403);
    if (state?.projects?.some(p => p.workspace && contains(p.workspace, machineDir))) fail('SECRET_LOCATION', 'Machine credentials must be outside project workspaces.');
    return projectId;
  }
  function current(r, input) {
    if (!r || r.deleted || r.projectId !== input.projectId || input.purpose !== undefined && r.purpose !== input.purpose) fail('SECRET_SETUP_REQUIRED', 'This credential is unavailable for the selected project and purpose.');
    if (input.expectedRevision !== undefined && input.expectedRevision !== r.revision || input.generation !== undefined && input.generation !== r.generation) fail('SECRET_REVISION_CONFLICT', 'This credential changed. Reload Settings before using or saving it.');
    return r;
  }
  async function read() { const s = await vault.read(); return s ? validateState(s) : null; }
  async function operation(kind, input, mutate) {
    project(input.projectId); purpose(input.purpose);
    if (typeof input.operationId !== 'string' || !UUID.test(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('SECRET_INPUT', 'Use a fresh operation ID and the revision displayed in Settings.', 400);
    return vault.transaction(async raw => {
      project(input.projectId);
      const s = raw ? validateState(raw) : fresh();
      // HMAC uses a private random key held INSIDE the encrypted store. Neither
      // domain receipts nor public results contain a secret-body digest.
      const body = kind === 'set' ? [kind, input.projectId, input.purpose, input.name ?? null, input.reference ?? null, input.expectedRevision, input.value]
        : [kind, input.projectId, input.purpose, input.reference, input.expectedRevision];
      const fingerprint = createHmac('sha256', Buffer.from(s.replayKey, 'hex')).update(JSON.stringify(body)).digest('hex');
      const prior = s.operations.find(x => x.operationId === input.operationId);
      if (prior) {
        if (prior.fingerprint.length !== fingerprint.length || !timingSafeEqual(Buffer.from(prior.fingerprint), Buffer.from(fingerprint))) fail('SECRET_OPERATION_REUSE', 'This operation ID belongs to different credential setup. Use a fresh operation after reviewing Settings.');
        return { result: { ...structuredClone(prior.result), replayed: true } };
      }
      if (s.operations.length >= 10000) fail('SECRET_CAPACITY', 'Credential operation history is full. Preserve the encrypted store and contact local support.');
      const result = await mutate(s);
      s.operations.push({ operationId: input.operationId, fingerprint, result });
      return { next: s, result: { ...structuredClone(result), replayed: false } };
    });
  }
  const service = {
    // Internal only; intentionally absent from SECRET_HTTP_METHODS.
    bindingStamp(){if(typeof vault.bindingStamp!=='function')fail('SECRET_FENCE_UNAVAILABLE','Credential state cannot be fenced synchronously.');return vault.bindingStamp();},
    async status(input) {
      exact(input, ['projectId']); project(input.projectId);
      return { ...await vault.status(), purposes: [...SECRET_PURPOSES], machineOnly: true, portable: false };
    },
    async list(input) {
      exact(input, ['projectId', 'purpose']); project(input.projectId); purpose(input.purpose, true);
      const s = await read();
      return { secrets: (s?.records ?? []).filter(r => !r.deleted && r.projectId === input.projectId && (input.purpose === undefined || input.purpose === r.purpose)).map(metadata) };
    },
    async set(input) {
      exact(input, ['projectId', 'purpose', 'name', 'value', 'reference', 'operationId', 'expectedRevision']);
      // Snapshot caller values before any await; never mutate caller-owned state.
      input = { ...input };
      if (typeof input.value !== 'string' || !input.value.length || Buffer.byteLength(input.value) > 16384 || /[\0\r\n]/.test(input.value)) fail('SECRET_INPUT', 'Enter a nonempty single-line credential of at most 16 KB.', 400);
      if (input.name !== undefined) envName(input.name);
      if (input.reference !== undefined) refId(input.reference);
      return operation('set', input, s => {
        let r;
        if (input.reference !== undefined) {
          r = current(s.records.find(x => x.id === refId(input.reference)), input);
          if (input.name !== undefined && r.name !== input.name) fail('SECRET_INPUT', 'A saved key name cannot be renamed. Create a new scoped key instead.', 400);
        } else {
          if (input.expectedRevision !== 0) fail('SECRET_REVISION_CONFLICT', 'New keys require revision zero. Reload Settings.');
          const name = input.name ?? `FORGE_${input.purpose.toUpperCase()}_${randomBytes(6).toString('hex').toUpperCase()}`;
          if (s.records.some(x => !x.deleted && x.projectId === input.projectId && x.purpose === input.purpose && x.name === name)) fail('SECRET_REVISION_CONFLICT', 'This key already exists. Select Rotate and review its revision.');
          const id = randomUUID(); r = { id, reference: `vault:${id}`, projectId: input.projectId, purpose: input.purpose, name, envName: name, revision: 0 };
          s.records.push(r);
        }
        r.value = input.value; r.revision++; r.generation = ++s.generation; r.updatedAt = clock();
        return { secret: metadata(r) };
      });
    },
    async remove(input) {
      exact(input, ['projectId', 'purpose', 'reference', 'operationId', 'expectedRevision']); input = { ...input }; refId(input.reference);
      return operation('remove', input, s => {
        const r = current(s.records.find(x => x.id === refId(input.reference)), input);
        r.revision++; r.generation = ++s.generation; r.updatedAt = clock(); r.deleted = true; delete r.value;
        return { removed: true, secret: metadata(r) };
      });
    },
    // HOST INTERNAL ONLY. Never mount on HTTP/MCP or pass output to domain logs.
    async resolveEnv(input) {
      exact(input, ['projectId', 'name', 'purpose', 'expectedRevision', 'generation']); input = { ...input };
      project(input.projectId); envName(input.name); purpose(input.purpose, true);
      const s = vault.supported === false ? null : await read();
      if (input.purpose !== undefined && s?.records.some(r => r.projectId === input.projectId && r.name === input.name && r.purpose !== input.purpose) && !s.records.some(r => !r.deleted && r.projectId === input.projectId && r.name === input.name && r.purpose === input.purpose)) fail('SECRET_SETUP_REQUIRED', 'This key is not saved for the selected purpose.');
      const candidates = (s?.records ?? []).filter(r => r.projectId === input.projectId && r.name === input.name && (input.purpose === undefined || input.purpose === r.purpose));
      // Tombstones block fallback to an old machine environment value after removal.
      const active = candidates.filter(r => !r.deleted);
      if (active.length > 1) fail('SECRET_SCOPE', 'Choose an exact credential purpose in Settings.', 403);
      if (active.length) return current(active[0], input).value;
      if (candidates.length || input.expectedRevision !== undefined || input.generation !== undefined) fail('SECRET_SETUP_REQUIRED', 'Save this key in Settings before using the selected reference.');
      const value = Object.hasOwn(env, input.name) ? env[input.name] : undefined;
      if (typeof value !== 'string' || !value.length) fail('SECRET_SETUP_REQUIRED', 'The selected key is missing. Enter its value in Settings.');
      return value;
    },
    async resolveRef(input) {
      exact(input, ['projectId', 'reference', 'purpose', 'expectedRevision', 'generation']); input = { ...input };
      project(input.projectId); purpose(input.purpose, true);
      if (typeof input.reference === 'string' && input.reference.startsWith('env:')) {
        const { reference, ...rest } = input; return service.resolveEnv({ ...rest, name: envName(reference.slice(4)) });
      }
      const id = refId(input.reference), s = await read();
      return current(s?.records.find(r => r.id === id), input).value;
    },
  };
  return service;
}

// Host must authenticate Owner + session + CSRF BEFORE dispatching. Mutation
// bodies must bypass generic command receipts, request logging and audit hashing.
export async function dispatchSecretRequest(service, method, input) {
  if (!SECRET_HTTP_METHODS.includes(method)) fail('SECRET_NOT_FOUND', 'Unsupported credential setup action.', 404);
  return service[method](input);
}
