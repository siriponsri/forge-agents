import { createHash } from 'node:crypto';

export const MEMORY_TYPES = Object.freeze(['working','episodic','semantic','procedural','collective','owner']);
export const SCOPE_TYPES = Object.freeze(['project','owner','team','agent','session','task']);
export const TRUST = 'untrusted-data';
export function fail(code, message, status=400) { throw Object.assign(new Error(message), {code,status}); }
export function text(value, name, max=16000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('MEMORY_VALIDATION', `Invalid ${name}`);
  return value;
}
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) fail('MEMORY_VALIDATION','Unsupported memory fields');
  return value;
}
export function scope(value, projectId=value?.projectId) {
  object(value,['projectId','kind','id']);
  text(projectId,'projectId',200); text(value.id,'scope id',200);
  if (value.projectId !== projectId || !SCOPE_TYPES.includes(value.kind) || (value.kind === 'project' && value.id !== projectId)) fail('MEMORY_SCOPE','Invalid exact memory scope',403);
  return {projectId,kind:value.kind,id:value.id};
}
export const sameScope = (a,b) => a?.projectId===b?.projectId && a?.kind===b?.kind && a?.id===b?.id;
export const scopeKey = s => JSON.stringify([s.projectId,s.kind,s.id]);
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])])) : x;
export const digest = x => createHash('sha256').update(typeof x==='string'?x:JSON.stringify(canonical(x))).digest('hex');

// The resolver belongs to the host, e.g. a WeakMap of authenticated session/run
// handles. It must never return body-supplied identities or self-issued grants.
export function makeScopeAuthorizer(resolveTrustedCaller) {
  if (typeof resolveTrustedCaller !== 'function') throw new TypeError('Trusted caller resolver required');
  return ({action,scope:target,callerContext,state}) => {
    const caller=resolveTrustedCaller(callerContext,state);
    return Boolean(caller?.subject && caller.grants?.some(g=>sameScope(g.scope,target) && g.actions?.includes(action)));
  };
}
export function authorizeExact(authorize, action, target, callerContext, state) {
  if (!callerContext || typeof callerContext!=='object' || typeof authorize !== 'function' || authorize({action,scope:target,callerContext,state}) !== true) fail('MEMORY_FORBIDDEN','Trusted authorization for this exact memory scope is required',403);
}

export function safeContent(value) {
  const serialized=typeof value === 'string' ? value : JSON.stringify(value);
  // Defense in depth, not a credential classifier. No transcript auto-ingestion.
  if (/-----BEGIN [^-]*(?:PRIVATE KEY)|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})|\b(?:api[_ -]?key|password|access[_ -]?token|authorization)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._-]{8,}|<(?:think|analysis)>/i.test(serialized)) fail('MEMORY_SENSITIVE','Credentials and hidden reasoning cannot be stored');
  return value;
}
export function projection(state) {
  const records=new Map(), dead=new Set();
  for (const e of state.events) {
    if (e.type==='memory.tombstone') { dead.add(e.memoryId); records.delete(e.memoryId); }
    if (e.type==='memory.record' && !dead.has(e.memory.id)) records.set(e.memory.id,structuredClone(e.memory));
  }
  // Tombstones dominate even malformed/out-of-order imported event snapshots.
  for(const id of dead) records.delete(id);
  return {records,dead};
}
export function validateRefs(state, refs, projectId) {
  if (!Array.isArray(refs) || refs.length>24) fail('MEMORY_VALIDATION','Use at most 24 source references');
  return refs.map(ref=>{
    object(ref,['kind','id']);
    const collection={run:'runs',task:'tasks',artifact:'artifacts',verification:'events'}[ref.kind];
    const item=collection && state[collection]?.find(x=>x.id===ref.id && x.projectId===projectId);
    if (!item || (ref.kind==='verification' && item.type!=='verification.result')) fail('MEMORY_PROVENANCE','Source must exist in this project');
    return {kind:ref.kind,id:item.id,revision:item.revision??1,sha256:digest(item)};
  });
}
export function stampView(memory, now, all=[],state) {
  const conflicts=memory.factKey ? all.filter(x=>x.id!==memory.id && x.factKey===memory.factKey && sameScope(x.scope,memory.scope) && x.content!==memory.content).map(x=>x.id) : [];
  const provenanceStale=!!state&&[...memory.sourceRefs,...(memory.verification.ref?[memory.verification.ref]:[])].some(ref=>{const collection={run:'runs',task:'tasks',artifact:'artifacts',verification:'events'}[ref.kind],current=state[collection]?.find(r=>r.id===ref.id&&r.projectId===memory.projectId);return !current||(current.revision??1)!==ref.revision||digest(current)!==ref.sha256;});
  return {...structuredClone(memory),trust:TRUST,executable:false,stale:provenanceStale||!!memory.staleAt && Date.parse(memory.staleAt)<=Date.parse(now),provenanceStale,conflicts};
}
