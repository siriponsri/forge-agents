import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function fail(code, message = code, statusCode = 409) { throw Object.assign(new Error(message), { code, statusCode }); }
export function text(v, name, max = 256) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v)) fail('RELAY_VALIDATION', `Invalid ${name}`, 400);
  return v;
}
export function exact(o, keys) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !keys.includes(k))) fail('RELAY_SCHEMA', 'Unknown or invalid fields', 400);
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const digest = v => createHash('sha256').update(JSON.stringify(canonical(v ?? null))).digest('hex');
export function prose(v, name, max = 12000) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail('RELAY_VALIDATION', `Invalid ${name}`, 400);
  return v;
}
export function signBridgeBody(body, secret) {
  if (!(typeof secret === 'string' || Buffer.isBuffer(secret)) || Buffer.byteLength(secret) < 32) fail('RELAY_SECRET_UNAVAILABLE', 'A machine vault secret of at least 32 bytes is required', 503);
  return createHmac('sha256', secret).update('forge-mobile-relay-v1\n').update(body).digest('hex');
}
export function verifySignature(body, signature, secret) {
  const expected = signBridgeBody(body, secret);
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) fail('RELAY_AUTH', 'Bridge authentication failed', 401);
}
export function relayState(s) {
  if (!s.relay) s.relay = { version: 1, bindings: [], inbox: [], events: [], nonces: [], outbox: [] };
  if (s.relay.version !== 1) fail('RELAY_SCHEMA_VERSION', 'Relay migration required', 503);
  return s.relay;
}
export function find(s, collection, id, projectId) {
  const x = s[collection]?.find(v => v.id === id && (!projectId || v.projectId === projectId));
  if (!x) fail('RELAY_SCOPE', 'Record is absent from the selected project', 403);
  return x;
}
export const routeKeys = ['gatewayId', 'accountId', 'platform', 'chatId', 'threadId', 'ownerId'];
export function sameRoute(binding, input) { return routeKeys.every(k => binding[k] === input[k]); }
export function taskDigest(s, projectId, taskId) {
  const p = find(s, 'projects', projectId), task = find(s, 'tasks', taskId, projectId);
  const plan = find(s, 'plans', task.planId, projectId);
  if (plan.approved !== true) fail('RELAY_PLAN_REQUIRED', 'Review and approve the existing plan first');
  if (['running', 'done'].includes(task.status)) fail('RELAY_TASK_BUSY', 'Choose an unstarted task');
  const bot = task.botId ? find(s, 'bots', task.botId, projectId) : null;
  // Bind the actual instructions, bot, profile, plan and dependencies, including revisions.
  return digest({ project: { id: p.id, revision: p.revision, workspace: p.workspace, profile: p.profile }, task, plan, bot,
    dependencies: (task.dependsOn ?? []).map(id => find(s, 'tasks', id, projectId)) });
}
