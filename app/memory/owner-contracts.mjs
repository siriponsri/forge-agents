import { digest, fail, object, text } from './contracts.mjs';

// Installation-local Owner authority, deliberately NOT a project or fake project.
export const OWNER_MEMORY_SCOPE=Object.freeze({kind:'owner',id:'local-owner'});
export const OWNER_GRANT_PREFIX='owner-grant:';
export const grantKey=(id,projectId)=>JSON.stringify([id,projectId]);
export function ownerProjection(state) {
  const records=new Map(),dead=new Set(),grants=new Map();
  for(const e of state.events) {
    if(e.type==='owner-memory.tombstone')dead.add(e.memoryId);
    if(e.type==='owner-memory.record'){
      const prior=records.get(e.memory.id);
      if(!prior||e.memory.revision>=prior.revision)records.set(e.memory.id,structuredClone(e.memory));
    }
    if(e.type==='owner-memory.grant'){
      const key=grantKey(e.memoryId,e.targetProjectId),prior=grants.get(key);
      if(!prior||e.grantRevision>=prior.grantRevision)grants.set(key,structuredClone(e));
    }
  }
  for(const id of dead)records.delete(id);
  return {records,dead,grants};
}
export const ownerExpired=(r,now)=>!!r.expiresAt&&Date.parse(r.expiresAt)<=Date.parse(now);
export const ownerStale=(r,now)=>!!r.staleAt&&Date.parse(r.staleAt)<=Date.parse(now);
export function currentGrant(grant,memory,now) {
  return !!memory && !ownerExpired(memory,now) && grant?.status==='active' && grant.sourceRevision===memory.revision && grant.sourceSha256===digest(memory.content);
}
export function validateOwnerRefs(state,refs,authorize,caller) {
  if(!Array.isArray(refs)||refs.length>24)fail('MEMORY_VALIDATION','Use at most 24 source references');
  return refs.map(ref=>{
    object(ref,['projectId','kind','id']);text(ref.projectId,'source project',200);
    const target={projectId:ref.projectId,kind:'project',id:ref.projectId};
    if(authorize?.({action:'read',scope:target,callerContext:caller,state})!==true)fail('MEMORY_FORBIDDEN','Source project read permission required',403);
    const collection={run:'runs',task:'tasks',artifact:'artifacts',verification:'events'}[ref.kind];
    const item=state[collection]?.find(x=>x.id===ref.id&&x.projectId===ref.projectId);
    if(!item||(ref.kind==='verification'&&item.type!=='verification.result'))fail('MEMORY_PROVENANCE','Source must exist in its authorized project');
    return {projectId:ref.projectId,kind:ref.kind,id:item.id,revision:item.revision??1,sha256:digest(item)};
  });
}
export function ownerProvenanceStale(memory,state) {
  return memory.sourceRefs.some(ref=>{
    const collection={run:'runs',task:'tasks',artifact:'artifacts',verification:'events'}[ref.kind];
    const item=state[collection]?.find(x=>x.id===ref.id&&x.projectId===ref.projectId);
    return !item||(item.revision??1)!==ref.revision||digest(item)!==ref.sha256;
  });
}

// Trusted restore hook: keep installation Owner history when restoring project or
// older whole-state backups. Latest record/grant revisions and deletion dominate.
// This function does not fetch/import data or grant new permissions.
export function mergeOwnerMemorySafety(restoredState,previousState) {
  const previous=previousState.events.filter(e=>e.type.startsWith('owner-memory.'));
  const previousIds=new Set(previous.map(e=>e.id));
  restoredState.events=restoredState.events.filter(e=>!previousIds.has(e.id));
  restoredState.events.push(...structuredClone(previous));
  const {dead}=ownerProjection(restoredState);
  for(const e of restoredState.events)if(e.type==='owner-memory.record'&&dead.has(e.memory.id)){
    e.memory.content='';e.memory.title='';e.memory.sourceRefs=[];e.memory.redacted=true;
  }
  return restoredState;
}
