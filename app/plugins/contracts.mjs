import { createHash } from 'node:crypto';

/** Native contract version, independent of provider/model and DSH versions. */
export const HOST_VERSION = '1.0.0';
export function fail(code, message, statusCode = 400) { throw Object.assign(new Error(message), {code, statusCode}); }
export function object(value, label = 'request') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('VALIDATION', `${label} must be an object`);
  return value;
}
export function text(value, label = 'id') {
  if (typeof value !== 'string' || !/^[\w.:-]{1,200}$/.test(value)) fail('VALIDATION', `Invalid ${label}`);
  return value;
}
export function keys(value, allowed) {
  object(value);
  if (Object.keys(value).some(k => !allowed.includes(k))) fail('VALIDATION', 'Unknown request field');
}
export function json(value, depth = 0) {
  if (depth > 16) fail('LIMIT', 'JSON nesting exceeds 16');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= 64000) return;
  if (Array.isArray(value) && value.length <= 256) { value.forEach(v => json(v, depth + 1)); return; }
  object(value, 'JSON');
  if (Object.keys(value).length > 128) fail('LIMIT', 'Too many JSON fields');
  for (const [k,v] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('VALIDATION', 'Unsafe JSON key');
    json(v, depth + 1);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function version(value) { if (typeof value !== 'string' || !semver.test(value) || value.split('.').some(n => !Number.isSafeInteger(Number(n)))) fail('VERSION', 'Use a stable major.minor.patch version'); return value; }
export function range(value = '*') { if (typeof value !== 'string') fail('VERSION','Use a version string'); if (value !== '*') version(value.startsWith('^') ? value.slice(1) : value); return value; }
export function compatible(actual, wanted = '*') {
  version(actual); range(wanted);
  if (wanted === '*') return true;
  if (!wanted.startsWith('^')) return actual === wanted;
  const a = actual.split('.').map(Number), b = wanted.slice(1).split('.').map(Number);
  if (a[0] !== b[0] || (!b[0] && a[1] !== b[1]) || (!b[0] && !b[1] && a[2] !== b[2])) return false;
  return a[1] > b[1] || a[1] === b[1] && a[2] >= b[2];
}

/** Deliberately bounded JSON-schema subset. Unknown schema keywords fail closed. */
export function schemaDefinition(schema) {
  keys(schema, ['type','properties','required','additionalProperties','items','enum','maxLength','maxItems','minimum','maximum','description']);
  if (!['object','array','string','boolean','integer','number','json'].includes(schema.type)) fail('CONTRACT', 'Unsupported contract type');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) fail('CONTRACT', 'Object contracts must reject unknown fields');
    object(schema.properties);
    for (const s of Object.values(schema.properties)) schemaDefinition(s);
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some(k => !Object.hasOwn(schema.properties,k)))) fail('CONTRACT', 'Invalid required fields');
  }
  if (schema.type === 'array') schemaDefinition(schema.items);
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length)) fail('CONTRACT', 'Invalid enum');
  return schema;
}
export function validate(schema, value, label = 'arguments') {
  json(value);
  if (schema.type === 'json') return structuredClone(value);
  const type = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'integer' ? !Number.isSafeInteger(value) : type !== schema.type || value === null) fail('CONTRACT', `Invalid ${label} type`);
  if (schema.enum && !schema.enum.some(v => digest(v) === digest(value))) fail('CONTRACT', `Invalid ${label} choice`);
  if (schema.type === 'object') {
    keys(value, Object.keys(schema.properties));
    for (const k of schema.required ?? []) if (!Object.hasOwn(value,k)) fail('CONTRACT', `Missing ${label}.${k}`);
    for (const [k,v] of Object.entries(value)) validate(schema.properties[k], v, `${label}.${k}`);
  }
  if (schema.type === 'array') { if (value.length > (schema.maxItems ?? 64)) fail('LIMIT', `${label} is too long`); value.forEach(v => validate(schema.items, v, label)); }
  if (schema.type === 'string' && value.length > (schema.maxLength ?? 200)) fail('LIMIT', `${label} is too long`);
  if (['integer','number'].includes(schema.type) && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail('LIMIT', `${label} is out of range`);
  return structuredClone(value);
}

/** @typedef {{kind:'project'|'session'|'agent'|'task',id:string}} Scope */
/** @typedef {{projectId:string,sessionId?:string,agentId?:string,taskId?:string}} Context */
export function find(state, collection, id, projectId) {
  const item = state[collection].find(x => x.id === id && (!projectId || x.projectId === projectId));
  if (!item) fail('SCOPE', `${collection} identity is outside this project`, 403);
  return item;
}
export function context(state, input) {
  const projectId = text(input.projectId, 'projectId'); find(state,'projects',projectId);
  const result = {projectId};
  for (const [k,c] of [['sessionId','conversations'],['agentId','bots'],['taskId','tasks']]) if (input[k] !== undefined) { text(input[k],k); find(state,c,input[k],projectId); result[k] = input[k]; }
  const task = result.taskId && find(state,'tasks',result.taskId,projectId), session = result.sessionId && find(state,'conversations',result.sessionId,projectId);
  result.agentId ??= task?.botId ?? session?.botId;
  if (!result.agentId) delete result.agentId;
  const bot = result.agentId && find(state,'bots',result.agentId,projectId);
  if (task && bot && task.botId && task.botId !== bot.id || bot?.taskId && task && bot.taskId !== task.id || session?.botId && bot && session.botId !== bot.id || session?.botId && task?.botId && session.botId !== task.botId) fail('SCOPE', 'Task, agent and session identities do not match', 403);
  return result;
}
export function scope(state, input) {
  const ctx = context(state, {projectId:input.projectId});
  const s = input.scope ?? {kind:'project',id:ctx.projectId}; keys(s,['kind','id']);
  if (!['project','session','agent','task'].includes(s.kind)) fail('VALIDATION', 'Unsupported capability scope');
  const id = text(s.id ?? (s.kind === 'project' ? ctx.projectId : undefined), 'scope id');
  if (s.kind === 'project' && id !== ctx.projectId) fail('SCOPE', 'Wrong project scope', 403);
  if (s.kind !== 'project') context(state,{projectId:ctx.projectId,[{session:'sessionId',agent:'agentId',task:'taskId'}[s.kind]]:id});
  return {kind:s.kind,id};
}
export const scopeContext = (projectId,s) => ({projectId,...(s.kind === 'project' ? {} : {[{session:'sessionId',agent:'agentId',task:'taskId'}[s.kind]]:s.id})});
export const scopes = ctx => [{kind:'project',id:ctx.projectId},...['session','agent','task'].flatMap(kind => ctx[`${kind}Id`] ? [{kind,id:ctx[`${kind}Id`]}] : [])];
