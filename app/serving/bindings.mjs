import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { confined, fail, find } from '../server/domain.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export function assertBinding(state, projectId, binding) {
  for (const key of ['model', 'preprocessor']) {
    const ref = binding?.[key];
    if (!ref?.artifactId || !Number.isSafeInteger(ref.revision)) fail('ARTIFACT_REQUIRED', `Select an explicit verified ${key} artifact revision`);
    const a = find(state, 'artifacts', ref.artifactId, projectId);
    if (a.revision !== ref.revision || (ref.sha256 && a.sha256 !== ref.sha256)) fail('REVISION_CONFLICT', `${key} artifact revision changed`, 409);
    if (a.status !== 'verified' || !/^[a-f0-9]{64}$/.test(a.sha256)) fail('ARTIFACT_UNVERIFIED', `${key} must be verified`, 409);
  }
}
export async function verifyBinding(store, projectId, binding) {
  const state = store.read(), project = find(state, 'projects', projectId);
  assertBinding(state, projectId, binding);
  const result = {};
  for (const key of ['model', 'preprocessor']) {
    const a = find(state, 'artifacts', binding[key].artifactId, projectId);
    const file = await confined(project.workspace, a.path), info = await stat(file);
    if (!info.isFile() || info.size !== a.bytes || await fileHash(file) !== a.sha256) fail('INTEGRITY', `${key} bytes changed; register and select a new artifact revision`, 409);
    result[key] = { artifactId: a.id, revision: a.revision, sha256: a.sha256, bytes: a.bytes, path: file, source: a.source ?? null };
  }
  assertBinding(store.read(), projectId, result);
  return result;
}
function vector(v, n) { return Array.isArray(v) && v.length === n && v.every(Number.isFinite); }
export async function readLinearBundle(binding) {
  if (Object.values(binding).some(a => a.bytes > 4 * 1024 * 1024)) fail('MODEL_FORMAT_UNSUPPORTED', 'Local JSON linear loader accepts files up to 4 MiB; connect an existing LitServe endpoint for other models', 422);
  let model, preprocessor;
  try {
    const modelBytes = await readFile(binding.model.path), preprocessorBytes = await readFile(binding.preprocessor.path);
    if (digest(modelBytes) !== binding.model.sha256 || digest(preprocessorBytes) !== binding.preprocessor.sha256) fail('INTEGRITY', 'Artifacts changed while reading local model format', 409);
    model = JSON.parse(modelBytes); preprocessor = JSON.parse(preprocessorBytes);
  }
  catch (e) { if (e.code === 'INTEGRITY') throw e; fail('MODEL_FORMAT_UNSUPPORTED', 'Local loader requires forge.linear.v1 JSON weights and forge.standardize.v1 JSON preprocessing', 422); }
  const n = model.weights?.length;
  if (model.format !== 'forge.linear.v1' || !n || n > 10000 || !vector(model.weights, n) || !Number.isFinite(model.bias) ||
      preprocessor.format !== 'forge.standardize.v1' || !vector(preprocessor.mean, n) || !vector(preprocessor.scale, n) || preprocessor.scale.some(x => x === 0)) {
    fail('MODEL_FORMAT_UNSUPPORTED', 'Select matching forge.linear.v1 weights and forge.standardize.v1 mean/scale vectors; other formats require an existing inference implementation', 422);
  }
  return { model, preprocessor, features: n, engineeringFixture: model.engineeringFixture === true };
}
export function endpointURL(raw) {
  let url; try { url = new URL(raw); } catch { fail('SERVING_URL', 'Choose an absolute HTTP(S) LitServe base URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('SERVING_URL', 'Use an HTTP(S) base URL without credentials, query or fragment');
  // Existing private endpoints can be selected explicitly; this service never provisions or publishes one.
  return url.href.replace(/\/$/, '');
}
