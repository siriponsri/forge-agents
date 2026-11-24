import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openMemoryIndex } from './sqlite-index.mjs';
import { MEMORY_TYPES, TRUST, scope, sameScope, authorizeExact, makeScopeAuthorizer, text, object, safeContent, projection, validateRefs, stampView, digest, fail } from './contracts.mjs';
import { validateBackendConfig, createMem0Adapter } from './mem0-adapter.mjs';
import { purgeAllMemoryVectorCaches } from './cache.mjs';
export { MEMORY_TYPES, makeScopeAuthorizer };

const commands={
  remember:['operationId','projectId','scope','memoryType','title','content','factKey','sourceRefs','staleAt','expiresAt','sensitive'],
  update:['operationId','projectId','scope','id','expectedRevision','patch'],
  forget:['operationId','projectId','scope','id','expectedRevision'],
  list:['projectId','scope','limit','includeStale','memoryType'],
  recall:['projectId','scope','query','limit','includeStale','memoryType','backend'],
  export:['projectId','scope'], status:['projectId','scope'], backend:['projectId','scope'],
  configure:['operationId','projectId','scope','config','expectedRevision'],
  rebuild:['projectId','scope'], retention:['operationId','projectId','scope'],
  context:['projectId','scope','query','limit','maxCharacters','includeStale','memoryType','backend'],
  resolveRefs:['projectId','scope','refs'],
  proposeLesson:['projectId','scope','id','expectedRevision','skillId','skillRevision','version','instructions','operationId'],
  setup:['projectId','scope'],
  health:['projectId','scope'],
};
const time=(v,name)=>{if(v===null||v===undefined)return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('MEMORY_VALIDATION',`Invalid ${name}`);return new Date(v).toISOString();};
const expired=(r,now)=>!!r.expiresAt&&Date.parse(r.expiresAt)<=Date.parse(now);
const accessible=(r,s)=>sameScope(r.scope,s)||r.shares.some(x=>sameScope(x,s));

export async function createMemoryService({store,dataDir,authorize,adapter,adaptive,now=()=>new Date().toISOString(),mem0Factory=createMem0Adapter}={}) {
  if(!store?.read||!store?.transaction||!path.isAbsolute(dataDir??''))throw new TypeError('Durable FORGE store and absolute dataDir required');
  const index=await openMemoryIndex(dataDir), adapters=new Map(); let vectorPending=Promise.resolve(), closed=false,restoring=false,vectorsSuspended=false;
  let measurements=new WeakMap();
  const metricMap=caller=>{if(!measurements.has(caller))measurements.set(caller,new Map());return measurements.get(caller);};
  const requireAccess=(action,input,caller,s=store.read())=>{
    if(closed)fail('MEMORY_CLOSED','Memory service is closed',503);
    if(restoring)fail('MEMORY_RESTORING','Memory recovery is in progress',503);
    object(input,commands[action]??[]);safeContent(input);text(input.projectId,'projectId',200);const target=scope(input.scope,input.projectId);
    if(!s.projects.some(p=>p.id===target.projectId))fail('MEMORY_SCOPE','Unknown project',403);
    authorizeExact(authorize,['remember','update','forget','retention'].includes(action)?'write':['recall','list','context','resolveRefs','status','backend','health'].includes(action)?'read':action,target,caller,s);
    return target;
  };
  const append=(s,type,data)=>{const event={id:randomUUID(),type,createdAt:now(),...data};s.events.push(event);return event;};
  const configRecord=(s,p)=>s.events.filter(e=>e.type==='memory.backend'&&e.projectId===p).at(-1);
  const all=s=>[...projection(s).records.values()];
  const owned=(s,input,target)=>{
    const r=projection(s).records.get(input.id);
    if(!r||!sameScope(r.scope,target))fail('MEMORY_NOT_FOUND','Memory not found in this writable scope',404);
    if(input.expectedRevision!==r.revision)fail('MEMORY_REVISION_CONFLICT','Memory changed; reload before editing',409);
    return r;
  };
  const remove=(s,r,reason)=>{
    append(s,'memory.tombstone',{projectId:r.projectId,memoryId:r.id,scope:r.scope,revision:r.revision+1,reason,contentHash:digest(r.content)});
    // Retain revision/source audit metadata but scrub text from earlier snapshots.
    // Already-created backups require the host's tombstone reconstruction hook.
    for(const e of s.events)if(e.type==='memory.record'&&e.memory.id===r.id){e.memory.content='';e.memory.title='';e.memory.redacted=true;}
  };
  async function derived() {
    index.sync(store.read());
    if(vectorsSuspended){const state=store.read(),projects=new Set(state.events.filter(e=>e.type==='memory.backend').map(e=>e.projectId));return adapter||[...projects].some(id=>configRecord(state,id)?.config.backend==='mem0')?[{code:'MEMORY_VECTOR_REBUILD_REQUIRED',message:'Optional vector cache cleared after restore. Explicitly rebuild to enable model-backed retrieval.'}]:[];}
    const task=vectorPending.then(async()=>{
      const s=store.read(); const active=all(s).filter(r=>!expired(r,now())); const errors=[];
      const projects=new Set([...adapters.keys(),...s.events.filter(e=>e.type==='memory.backend').map(e=>e.projectId)]);
      if(adapter)projects.add('*');
      for(const p of projects) {
        const config=p==='*'?null:configRecord(s,p)?.config;
        try {
          if(p!=='*'&&config?.backend!=='mem0'){
            const previous=s.events.filter(e=>e.type==='memory.backend'&&e.projectId===p&&e.config.backend==='mem0').at(-1);
            const old=adapters.get(p)??(previous?await mem0Factory({dataDir:path.join(dataDir,'memory',digest(p)),config:previous.config}):null);
            if(old){await old.purge?.();await old.close?.();adapters.delete(p);}continue;
          }
          let a=p==='*'?adapter:adapters.get(p);
          if(!a){a=await mem0Factory({dataDir:path.join(dataDir,'memory',digest(p)),config});adapters.set(p,a);}
          await a.replace(active.filter(r=>p==='*'||r.projectId===p));
        } catch {errors.push({projectId:p,code:'MEMORY_VECTOR_UNAVAILABLE',message:'Canonical commit retained; keyword recall remains available. Rebuild optional backend after setup.'});}
      }
      return errors;
    });vectorPending=task.catch(()=>{}); return task;
  }
  async function mutate(method,input,caller,fn) {
    input=structuredClone(input); text(input.operationId,'operationId',200);
    const value=await store.transaction(async s=>{
      const target=requireAccess(method,input,caller,s), fingerprint=digest({method,input});
      const prior=s.events.find(e=>e.type==='memory.operation'&&e.operationId===input.operationId);
      if(s.receipts.some(e=>e.operationId===input.operationId))fail('MEMORY_OPERATION_REUSE','Operation ID belongs to another service',409);
      if(prior){if(prior.fingerprint!==fingerprint)fail('MEMORY_OPERATION_REUSE','Operation ID belongs to different input',409);return {replayed:true,id:prior.memoryId??null,deleted:projection(s).dead.has(prior.memoryId)};}
      const result=await fn(s,target);
      append(s,'memory.operation',{projectId:target.projectId,scope:target,operationId:input.operationId,fingerprint,memoryId:result.id??null});
      return result;
    });
    const warnings=await derived(); return {...value,...(warnings.length?{warnings}: {})};
  }
  async function query(method,input,caller) {
    const began=performance.now();let s=store.read();const target=requireAccess(method,input,caller,s);
    const limit=input.limit??30;
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('MEMORY_VALIDATION','Limit must be 1..100');
    if(input.memoryType&&!MEMORY_TYPES.includes(input.memoryType))fail('MEMORY_VALIDATION','Unknown memory type');
    if(input.includeStale!==undefined&&typeof input.includeStale!=='boolean')fail('MEMORY_VALIDATION','includeStale must be boolean');
    const visible=state=>all(state).filter(r=>accessible(r,target)&&!expired(r,now())&&(!r.sensitive||authorize?.({action:'sensitive',scope:target,callerContext:caller,state})===true));
    let rows=visible(s);
    if(method==='recall'&&input.query===undefined)fail('MEMORY_VALIDATION','Recall requires a query');
    let ids,engine='canonical list',scores=new Map();
    if(input.query!==undefined){
      text(input.query,'query',1000);safeContent(input.query);index.sync(s);
      if(input.backend && !['keyword','mem0'].includes(input.backend))fail('MEMORY_VALIDATION','Unsupported retrieval backend');
      if(input.backend==='mem0') {
        if(vectorsSuspended)fail('MEMORY_VECTOR_REBUILD_REQUIRED','Explicitly rebuild the optional backend after restore',409);
        let a=adapter??adapters.get(target.projectId);
        if(!a){const config=configRecord(s,target.projectId)?.config;if(config?.backend==='mem0'){a=await mem0Factory({dataDir:path.join(dataDir,'memory',digest(target.projectId)),config});adapters.set(target.projectId,a);}}
        if(!a)fail('MEMORY_VECTOR_UNAVAILABLE','Set up the optional backend or choose keyword search',503);
        const results=await a.search({query:input.query,scope:target,limit:100});
        s=store.read();requireAccess(method,input,caller,s);rows=visible(s);
        // Never trust vector payload content, grants, or revision. IDs are only hints.
        const valid=results.filter(hit=>rows.some(r=>r.id===hit.id&&r.revision===hit.revision));
        ids=valid.map(hit=>hit.id);scores=new Map(valid.map(h=>[h.id,h.score??null]));engine='mem0-vector';
      } else {const results=index.search(input.query,target);ids=results.map(h=>h.id);scores=new Map(results.map(h=>[h.id,h.score]));engine='sqlite-fts5-trigram';}
    }
    let matches=rows.filter(r=>(!ids||ids.includes(r.id))&&(!input.memoryType||r.memoryType===input.memoryType)).map(r=>stampView(r,now(),rows,s)).filter(r=>input.includeStale||!r.stale);
    matches.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(ids?ids.indexOf(a.id)-ids.indexOf(b.id):b.updatedAt.localeCompare(a.updatedAt)));
    const items=matches.slice(0,limit).map(r=>({...r,retrievalScore:scores.get(r.id)??null}));
    const measurement={engine,latencyMs:performance.now()-began,returned:items.length,eligibleMatches:matches.length,contentCharacters:items.reduce((n,r)=>n+r.content.length,0),contextTokens:{status:'unknown',value:null,reason:'No provider tokenizer/usage receipt supplied'},resourceCost:{status:'unknown',value:null},retrievalQuality:{status:'not-evaluated',value:null}};
    const metrics=metricMap(caller),metricKey=digest(target),previous=metrics.get(metricKey);metrics.set(metricKey,{queries:(previous?.queries??0)+1,last:measurement});return {items,metrics:measurement,trust:TRUST,executable:false};
  }
  const service={
    remember(input,caller){return mutate('remember',input,caller,(s,target)=>{
      if(!MEMORY_TYPES.includes(input.memoryType))fail('MEMORY_VALIDATION','Unknown memory type');
      const content=safeContent(text(input.content,'content')),title=safeContent(text(input.title,'title',240));
      if(input.sensitive!==undefined&&typeof input.sensitive!=='boolean')fail('MEMORY_VALIDATION','sensitive must be boolean');
      if(input.sensitive)authorizeExact(authorize,'sensitive',target,caller,s);
      const sourceRefs=validateRefs(s,input.sourceRefs??[],target.projectId),timestamp=now();
      const r={id:randomUUID(),projectId:target.projectId,scope:target,memoryType:input.memoryType,title,content,factKey:input.factKey?safeContent(text(input.factKey,'factKey',160)):null,
        sourceRefs,origin:'explicit-authorized-entry',sensitive:input.sensitive===true,shares:[],pinned:false,revision:1,createdAt:timestamp,updatedAt:timestamp,
        staleAt:time(input.staleAt,'staleAt'),expiresAt:time(input.expiresAt,'expiresAt'),verification:{status:'unverified'},lessonStatus:input.memoryType==='procedural'?'draft':null,trust:TRUST,executable:false};
      append(s,'memory.record',{projectId:target.projectId,memory:r});return stampView(r,timestamp,all(s),s);
    });},
    update(input,caller){return mutate('update',input,caller,(s,target)=>{
      const r=owned(s,input,target),patch=object(input.patch,['title','content','pinned','shares','staleAt','expiresAt','sourceRefs','verificationRef']);
      const next=structuredClone(r);
      for(const key of ['title','content'])if(patch[key]!==undefined)next[key]=safeContent(text(patch[key],key,key==='title'?240:16000));
      if(patch.pinned!==undefined){if(typeof patch.pinned!=='boolean')fail('MEMORY_VALIDATION','pinned must be boolean');next.pinned=patch.pinned;}
      if(patch.shares!==undefined){
        authorizeExact(authorize,'share',target,caller,s);
        if(!Array.isArray(patch.shares)||patch.shares.length>12)fail('MEMORY_VALIDATION','Use at most 12 explicit shares');
        next.shares=patch.shares.map(value=>{const to=scope(value,target.projectId);authorizeExact(authorize,'share',to,caller,s);return to;});
      }
      for(const key of ['staleAt','expiresAt'])if(patch[key]!==undefined)next[key]=time(patch[key],key);
      if(patch.sourceRefs!==undefined)next.sourceRefs=validateRefs(s,patch.sourceRefs,target.projectId);
      if(next.content!==r.content||patch.sourceRefs!==undefined)next.verification={status:'unverified'};
      if(patch.verificationRef!==undefined){
        authorizeExact(authorize,'verify',target,caller,s);
        const ref=validateRefs(s,[{kind:'verification',id:patch.verificationRef}],target.projectId)[0];
        const e=s.events.find(e=>e.id===ref.id);
        if(e.status!=='PASSED'||!e.verifier?.id||!e.verifier?.version||!e.checkedAt||!e.checks?.length||e.checks.some(x=>x.status!=='PASSED'))fail('MEMORY_VERIFICATION','A real passed verifier receipt is required',409);
        // Memory verification is an evidence reference, never approval to execute.
        next.verification={status:'evidence-linked',ref,checkedAt:now(),contentHash:digest(next.content)};
      }
      if(r.sensitive)authorizeExact(authorize,'sensitive',target,caller,s);
      next.revision++;next.updatedAt=now();append(s,'memory.record',{projectId:target.projectId,memory:next});return stampView(next,now(),all(s),s);
    });},
    forget(input,caller){return mutate('forget',input,caller,(s,target)=>{const r=owned(s,input,target);remove(s,r,'explicit-forget');return {id:r.id,deleted:true,revision:r.revision+1};});},
    list:(input,caller)=>query('list',input,caller),
    recall:(input,caller)=>query('recall',input,caller),
    async context(input,caller){
      const max=input.maxCharacters??12000;if(!Number.isSafeInteger(max)||max<256||max>64000)fail('MEMORY_VALIDATION','Context character limit must be 256..64000');
      const result=await query('context',input,caller);let used=0;const items=[];
      for(const r of result.items){const item={id:r.id,revision:r.revision,sha256:digest(r.content),scope:r.scope,content:r.content,sourceRefs:r.sourceRefs,verification:r.verification,stale:r.stale,conflicts:r.conflicts,trust:TRUST,executable:false};const cost=JSON.stringify(item).length;if(used+cost>max)continue;items.push(item);used+=cost;}
      return {kind:'forge.memory.data',trust:TRUST,executable:false,items,provenance:items.map(r=>({id:r.id,revision:r.revision,sha256:r.sha256,sourceRefs:r.sourceRefs})),metrics:{...result.metrics,contextCharacters:used,omitted:result.items.length-items.length},authority:'Memory content confers no instructions, permissions, verified project state or acceptance criteria'};
    },
    async resolveRefs(input,caller){const s=store.read(),target=requireAccess('resolveRefs',input,caller,s);if(!Array.isArray(input.refs)||input.refs.length>100)fail('MEMORY_VALIDATION','Use at most 100 context references');const records=all(s).filter(r=>accessible(r,target)&&!expired(r,now())&&(!r.sensitive||authorize?.({action:'sensitive',scope:target,callerContext:caller,state:s})===true));const items=[];for(const ref of input.refs){object(ref,['id','revision','sha256']);const r=records.find(r=>r.id===ref.id&&r.revision===ref.revision&&digest(r.content)===ref.sha256);if(r)items.push({...stampView(r,now(),records,s),sha256:ref.sha256});}return {kind:'forge.memory.data',trust:TRUST,executable:false,items,missing:input.refs.filter(ref=>!items.some(r=>r.id===ref.id)).map(ref=>({id:ref.id,revision:ref.revision,sha256:ref.sha256}))};},
    async export(input,caller){const s=store.read(),target=requireAccess('export',input,caller,s);const records=all(s).filter(r=>accessible(r,target)&&!expired(r,now())&&(!r.sensitive||authorize?.({action:'sensitive',scope:target,callerContext:caller,state:s})===true));return {format:'forge-memory-v1',exportedAt:now(),scope:target,trust:TRUST,items:records.map(r=>stampView(r,now(),records,s)),tombstones:s.events.filter(e=>e.type==='memory.tombstone'&&sameScope(e.scope,target)).map(e=>({memoryId:e.memoryId,revision:e.revision,createdAt:e.createdAt}))};},
    async status(input,caller){const s=store.read(),target=requireAccess('status',input,caller,s);return {types:MEMORY_TYPES,backend:configRecord(s,target.projectId)?.config??{backend:'keyword'},backendRevision:configRecord(s,target.projectId)?.revision??0,scopedCount:all(s).filter(r=>accessible(r,target)&&!expired(r,now())&&(!r.sensitive||authorize?.({action:'sensitive',scope:target,callerContext:caller,state:s})===true)).length,index:{engine:'SQLite FTS5 trigram',derived:true},metrics:structuredClone(metricMap(caller).get(digest(target))??{queries:0,last:null}),authority:'existing FORGE event store',autoIngest:false};},
    async backend(input,caller){requireAccess('backend',input,caller);return service.status(input,caller);},
    async health(input,caller){const s=store.read(),target=requireAccess('health',input,caller,s),config=configRecord(s,target.projectId)?.config;if(config?.backend!=='mem0')return {status:'ready',backend:'keyword',externalCredentialsRequired:false};const a=await mem0Factory({dataDir:path.join(dataDir,'memory',digest(target.projectId)),config});try{return await a.health();}finally{await a.close?.();}},
    configure(input,caller){return mutate('configure',input,caller,async(s,target)=>{
      if(target.kind!=='project')fail('MEMORY_SCOPE','Backend configuration needs project scope',403);
      const previous=configRecord(s,target.projectId);if((previous?.revision??0)!==input.expectedRevision)fail('MEMORY_REVISION_CONFLICT','Backend configuration changed',409);
      const config=validateBackendConfig(input.config);const e=append(s,'memory.backend',{projectId:target.projectId,revision:(previous?.revision??0)+1,config});
      const prior=adapters.get(target.projectId);if(prior){adapters.delete(target.projectId);await prior.close?.();}
      return {id:e.id,config,revision:e.revision};
    });},
    async rebuild(input,caller){requireAccess('rebuild',input,caller);vectorsSuspended=false;index.sync(store.read(),true);const warnings=await derived();return {rebuilt:true,derived:true,warnings};},
    retention(input,caller){return mutate('retention',input,caller,(s,target)=>{const victims=all(s).filter(r=>sameScope(r.scope,target)&&expired(r,now()));for(const r of victims)remove(s,r,'retention-expired');return {deleted:victims.length};});},
    async setup(input,caller){const s=store.read(),target=requireAccess('setup',input,caller,s);const config=configRecord(s,target.projectId)?.config;if(target.kind!=='project'||config?.backend!=='mem0')fail('MEMORY_VALIDATION','Choose Mem0 in project backend settings first');const a=await mem0Factory({dataDir:path.join(dataDir,'memory',digest(target.projectId)),config});await a.setup();await a.close?.();return {installed:true,qualification:'Dependency setup only. Local model health and vector roundtrip must still pass.'};},
    async proposeLesson(input,caller){
      const s=store.read(),target=requireAccess('proposeLesson',input,caller,s),r=owned(s,input,target);
      if(r.memoryType!=='procedural'||!r.sourceRefs.length)fail('MEMORY_EVIDENCE_REQUIRED','Choose a draft procedure with existing evidence references');
      if(!adaptive?.candidate)fail('MEMORY_ADAPTIVE_UNAVAILABLE','Existing adaptive review service is required',503);
      const base=s.skills.find(x=>x.id===input.skillId&&x.projectId===target.projectId);
      if(!base||base.revision!==input.skillRevision)fail('MEMORY_REVISION_CONFLICT','Select the current base skill revision',409);
      return adaptive.candidate({operationId:input.operationId,projectId:target.projectId,skillId:input.skillId,expectedRevision:input.skillRevision,version:input.version,instructions:input.instructions,lesson:r.content.slice(0,4000),evidenceRefs:r.sourceRefs.filter(x=>x.kind!=='task').map(({kind,id})=>({kind,id}))});
    },
    // Host-only lifecycle seam: pause API/run dispatch, merge restore safety in the
    // canonical transaction, then call this. Never publish as an MCP/HTTP tool.
    async afterRestore(){
      if(closed)fail('MEMORY_CLOSED','Memory service is closed',503);
      restoring=true;vectorsSuspended=true;
      try{
        await vectorPending;
        const warnings=[];
        for(const a of [...adapters.values(),...(adapter?[adapter]:[])]){if(a.purge)await a.purge();else warnings.push({code:'MEMORY_ADAPTER_PURGE_UNSUPPORTED',message:'Injected adapter disabled; host must remove its external derived cache.'});await a.close?.();}
        adapters.clear();await purgeAllMemoryVectorCaches(dataDir);measurements=new WeakMap();index.sync(store.read(),true);
        return {rebuilt:true,backend:'keyword',vectorsSuspended:true,modelCalls:0,warnings};
      }finally{restoring=false;}
    },
    async close(){if(closed)return;await vectorPending;closed=true;index.close();await Promise.allSettled([...adapters.values(),...(adapter?[adapter]:[])].map(a=>a.close?.()));},
  };
  // Startup/recovery reconstructs solely from canonical events; replay never runs a
  // model, setup command, tool, or adaptive promotion.
  index.sync(store.read(),true);
  return service;
}

// Lead calls after restore/import BEFORE exposing memory or rebuilding vectors.
// Carry the union of tombstones from the pre-restore snapshot/portable deletion
// ledger into restored canonical state. Never reconstruct from vector payloads.
export function mergeMemoryTombstones(restoredState, previousState) {
  const seen=new Set(restoredState.events.filter(e=>e.type==='memory.tombstone').map(e=>e.memoryId));
  for(const e of previousState.events.filter(e=>e.type==='memory.tombstone'))if(!seen.has(e.memoryId)){restoredState.events.push(structuredClone(e));seen.add(e.memoryId);}
  for(const e of restoredState.events)if(e.type==='memory.record'&&seen.has(e.memory.id)){e.memory.content='';e.memory.title='';e.memory.redacted=true;}
  return restoredState;
}
