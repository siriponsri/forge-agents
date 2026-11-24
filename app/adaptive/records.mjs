import { createHash } from 'node:crypto';
import { entity, find, fail, changed, required, revision } from '../server/domain.mjs';
export { entity, find, fail, changed, required, revision };

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
export const snapshotSkill = s => ({id:s.id, revision:s.revision, name:s.name, version:s.version, instructions:s.instructions, requires:s.requires ?? [], sha256:digest({instructions:s.instructions, requires:s.requires ?? []}), provenance:s.provenance ?? null});
export const records = (s, kind, projectId) => s.events.filter(e => e.type === `adaptive.${kind}` && e.projectId === projectId);
export function record(s, kind, id, projectId) {
  const r = find(s, 'events', id, projectId);
  if (r.type !== `adaptive.${kind}`) fail('NOT_FOUND', `Adaptive ${kind} not found`, 404);
  return r;
}
export function append(s, kind, data, projectId) {
  const r = entity({type:`adaptive.${kind}`, ...data}, projectId); s.events.push(r); return r;
}
export function boundedText(value, label, limit=32000) {
  const text = required(value, label); if (text.length > limit) fail('LIMIT', `${label} exceeds ${limit} characters`); return text;
}
export function strings(value=[], label='values', max=32) {
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || !v || v.length > 200)) fail('VALIDATION', `Invalid ${label}`);
  return [...new Set(value)];
}
export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('LIMIT', `${label} must be ${min}..${max}`); return value;
}
export function replay(s, input, method) {
  boundedText(input.operationId, 'operationId', 200);
  const fingerprint = digest({method, input});
  const prior = s.receipts.find(r => r.operationId === input.operationId);
  if (prior && prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Operation ID belongs to different adaptive input', 409);
  return {fingerprint, prior};
}
export function mutate(store, method, input, fn) {
  // Inputs are JSON commands, never executable callbacks supplied by an HTTP client.
  input = structuredClone(input);
  return store.transaction(async s => {
    find(s, 'projects', input.projectId);
    const {fingerprint, prior} = replay(s, input, method);
    if (prior) return prior.result;
    const result = await fn(s, input);
    s.receipts.push({operationId:input.operationId, fingerprint, result:structuredClone(result)});
    return result;
  });
}
