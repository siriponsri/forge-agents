import { createHash } from 'node:crypto';
import { changed, entity, fail, find, required, revision } from '../server/domain.mjs';
export { changed, entity, fail, find, required, revision };

export function text(value, label, max = 200) {
  const result = required(value, label);
  if (result.length > max) fail('VALIDATION', `${label} exceeds ${max} characters`);
  return result;
}
// Only JSON data is accepted. Key order is immaterial, argument values are not.
export function json(value, depth = 0) {
  if (depth > 32) fail('VALIDATION', 'Governance JSON nesting exceeds 32');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(v => json(v, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map(k => [k, json(value[k], depth + 1)]));
  fail('VALIDATION', 'Governance accepts finite JSON data only');
}
export const digest = value => createHash('sha256').update(JSON.stringify(json(value))).digest('hex');
export const records = (s, type, projectId) => s.events.filter(e => e.type === `governance.${type}` && e.projectId === projectId);
export function append(s, type, projectId, data) {
  const record = entity({ type: `governance.${type}`, ...data }, projectId);
  s.events.push(record); return record;
}
export function audit(s, projectId, action, data) { return append(s, 'audit', projectId, { action, ...data }); }
export function mutate(store, method, input, fn) {
  input = json(input);
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('VALIDATION', 'A governance command object is required');
  text(input.operationId, 'operationId'); text(input.projectId, 'projectId');
  const operationId = `governance:command:${digest(input.operationId)}`;
  const fingerprint = digest({ method, input });
  return store.transaction(s => {
    find(s, 'projects', input.projectId);
    const prior = s.receipts.find(r => r.operationId === operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Governance command ID belongs to different input', 409);
      return prior.result;
    }
    const result = fn(s, input);
    s.receipts.push({ operationId, type: `governance.${method}`, projectId: input.projectId, fingerprint, result: structuredClone(result) });
    return result;
  });
}
export function human(actor) {
  if (actor?.kind !== 'human') fail('HUMAN_REQUIRED', 'An explicit human decision is required', 403);
  return { kind: 'human', id: text(actor.id, 'human actor ID') };
}
