import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { authorizeExact, digest, fail, object, safeContent, text, TRUST } from './contracts.mjs';
import { OWNER_MEMORY_SCOPE, OWNER_GRANT_PREFIX, ownerProjection, grantKey, currentGrant, ownerExpired, ownerStale, validateOwnerRefs, ownerProvenanceStale, mergeOwnerMemorySafety } from './owner-contracts.mjs';
import { openOwnerMemoryIndex } from './owner-index.mjs';
export { OWNER_MEMORY_SCOPE, OWNER_GRANT_PREFIX, mergeOwnerMemorySafety };

const fields={
  remember:['operationId','title','content','sourceRefs','staleAt','expiresAt','sensitive'],
  update:['operationId','id','expectedRevision','patch'],forget:['operationId','id','expectedRevision'],
  grant:['operationId','id','expectedRevision','projectId','expectedGrantRevision'],
  revoke:['operationId','id','expectedRevision','projectId','expectedGrantRevision'],
  list:['query','limit','includeStale'],recall:['query','limit','includeStale'],export:[],status:[],
  ownerContext:['projectId','query','limit','maxCharacters','includeStale'],
  resolveOwnerRefs:['projectId','refs'],
};
const date=(v,name)=>{if(v==null)return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('MEMORY_VALIDATION',`Invalid ${name}`);return new Date(v).toISOString();};
const bounded=(v,fallback,min,max,name)=>{v??=fallback;if(!Number.isSafeInteger(v)||v<min||v>max)fail('MEMORY_VALIDATION',`Invalid ${name}`);return v;};

export async function createOwnerMemoryService({store,dataDir,authorize,now=()=>new Date().toISOString()}={}) {
  if(!store?.read||!store?.transaction||!path.isAbsolute(dataDir??''))throw new TypeError('Existing durable store and absolute dataDir required');
  const index=await openOwnerMemoryIndex(dataDir);let closed=false;
  function access(method,input,caller,state=store.read()) {
    if(closed)fail('MEMORY_CLOSED','Owner memory service is closed',503);
    object(input,fields[method]);safeContent(input);
    const projectRead=['ownerContext','resolveOwnerRefs'].includes(method);
    if(projectRead){
      text(input.projectId,'projectId',200);
      if(!state.projects.some(p=>p.id===input.projectId))fail('MEMORY_SCOPE','Unknown project',403);
      const target={projectId:input.projectId,kind:'project',id:input.projectId};
      authorizeExact(authorize,'read',target,caller,state);return target;
    }
    const action=['remember','update','forget'].includes(method)?'owner.write':['grant','revoke'].includes(method)?'owner.share':method==='export'?'owner.export':'owner.read';
    authorizeExact(authorize,action,OWNER_MEMORY_SCOPE,caller,state);return OWNER_MEMORY_SCOPE;
  }
  const append=(state,type,data)=>{const event={id:randomUUID(),type:`owner-memory.${type}`,createdAt:now(),...data};state.events.push(event);return event;};
  function find(state,input) {
    const row=ownerProjection(state).records.get(text(input.id,'memory id',200));
    if(!row)fail('MEMORY_NOT_FOUND','Owner memory not found',404);
    if(row.revision!==input.expectedRevision)fail('MEMORY_REVISION_CONFLICT','Owner memory changed; reload before writing',409);
    return row;
  }
  const isSensitiveAllowed=(caller,state,target=OWNER_MEMORY_SCOPE)=>authorize?.({action:target.projectId?'sensitive':'owner.sensitive',scope:target,callerContext:caller,state})===true;
  function view(row,state) {
    const {grants}=ownerProjection(state),provenanceStale=ownerProvenanceStale(row,state);
    const sharing=[...grants.values()].filter(g=>g.memoryId===row.id).map(g=>({projectId:g.targetProjectId,projectName:state.projects.find(p=>p.id===g.targetProjectId)?.name??'Project unavailable',grantId:g.id,grantRevision:g.grantRevision,sourceRevision:g.sourceRevision,status:g.status,effective:currentGrant(g,row,now()),createdAt:g.createdAt}));
    return {...structuredClone(row),trust:TRUST,executable:false,stale:ownerStale(row,now())||provenanceStale,provenanceStale,expired:ownerExpired(row,now()),sharing};
  }
  async function mutate(method,input,caller,fn) {
    input=structuredClone(input);text(input.operationId,'operationId',200);
    const result=await store.transaction(state=>{
      access(method,input,caller,state);const fingerprint=digest({method,input});
      const prior=state.events.find(e=>e.operationId===input.operationId);
      if(state.receipts.some(r=>r.operationId===input.operationId)||(prior&&(prior.type!=='owner-memory.operation'||prior.fingerprint!==fingerprint)))fail('MEMORY_OPERATION_REUSE','Operation ID belongs to different input',409);
      if(prior){const {records,dead,grants}=ownerProjection(state),row=records.get(prior.memoryId),g=prior.targetProjectId?grants.get(grantKey(prior.memoryId,prior.targetProjectId)):null;return {id:prior.memoryId,replayed:true,deleted:dead.has(prior.memoryId),revision:row?.revision??null,...(g?{grantId:g.id,grantRevision:g.grantRevision,status:g.status==='active'&&!currentGrant(g,row,now())?'invalidated':g.status}: {})};}
      const value=fn(state);
      append(state,'operation',{operationId:input.operationId,fingerprint,memoryId:value.id,targetProjectId:input.projectId??null});return value;
    });
    index.sync(store.read());return result;
  }
  function query(method,input,caller) {
    const began=performance.now(),state=store.read(),target=access(method,input,caller,state),isProject=!!target.projectId;
    const limit=bounded(input.limit,30,1,100,'limit');
    if(input.includeStale!==undefined&&typeof input.includeStale!=='boolean')fail('MEMORY_VALIDATION','includeStale must be boolean');
    if(method==='recall'&&input.query===undefined)fail('MEMORY_VALIDATION','Recall requires a query');
    const {records,grants}=ownerProjection(state);let selected;
    if(input.query!==undefined){text(input.query,'query',1000);index.sync(state);selected=index.search(input.query,isProject?target.projectId:undefined);}
    let rows=[...records.values()].filter(r=>(!selected||selected.includes(r.id))&&(!r.sensitive||isSensitiveAllowed(caller,state,target)));
    if(isProject)rows=rows.filter(r=>currentGrant(grants.get(grantKey(r.id,target.projectId)),r,now()));
    rows=rows.map(r=>view(r,state)).filter(r=>!isProject||!r.expired).filter(r=>input.includeStale||!r.stale);
    rows.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(selected?selected.indexOf(a.id)-selected.indexOf(b.id):b.updatedAt.localeCompare(a.updatedAt)));
    return {items:rows.slice(0,limit),state,target,grants,metrics:{engine:'sqlite-fts5-trigram',latencyMs:performance.now()-began,returned:Math.min(rows.length,limit),eligibleMatches:rows.length,contextTokens:{status:'unknown',value:null},resourceCost:{status:'unknown',value:null},retrievalQuality:{status:'not-evaluated',value:null}}};
  }
  function projectItem(row,grant,target) {
    // A grant-bound read VIEW, not a persisted/project-owned memory copy. Private
    // source evidence and grants for other projects never cross this boundary.
    return {id:OWNER_GRANT_PREFIX+grant.id,revision:row.revision,sha256:digest(row.content),scope:target,title:row.title,content:row.content,
      sourceRefs:[],verification:{status:'unverified'},stale:row.stale,conflicts:[],trust:TRUST,executable:false,
      provenance:{kind:'owner-memory',sourceMemoryId:row.id,sourceRevision:row.revision,grantId:grant.id,grantRevision:grant.grantRevision}};
  }
  const service={
    remember(input,caller){return mutate('remember',input,caller,state=>{
      if(input.sensitive!==undefined&&typeof input.sensitive!=='boolean')fail('MEMORY_VALIDATION','sensitive must be boolean');
      if(input.sensitive)authorizeExact(authorize,'owner.sensitive',OWNER_MEMORY_SCOPE,caller,state);
      const timestamp=now(),memory={id:randomUUID(),scope:OWNER_MEMORY_SCOPE,memoryType:'owner',title:safeContent(text(input.title,'title',240)),content:safeContent(text(input.content,'content')),
        sourceRefs:validateOwnerRefs(state,input.sourceRefs??[],authorize,caller),origin:'explicit-owner-entry',revision:1,createdAt:timestamp,updatedAt:timestamp,
        staleAt:date(input.staleAt,'staleAt'),expiresAt:date(input.expiresAt,'expiresAt'),pinned:false,sensitive:input.sensitive===true,trust:TRUST,executable:false};
      append(state,'record',{memory});return view(memory,state);
    });},
    update(input,caller){return mutate('update',input,caller,state=>{
      const memory=find(state,input),patch=object(input.patch,['title','content','pinned','staleAt','expiresAt','sourceRefs']);
      if(memory.sensitive)authorizeExact(authorize,'owner.sensitive',OWNER_MEMORY_SCOPE,caller,state);
      for(const k of ['title','content'])if(patch[k]!==undefined)memory[k]=safeContent(text(patch[k],k,k==='title'?240:16000));
      if(patch.pinned!==undefined){if(typeof patch.pinned!=='boolean')fail('MEMORY_VALIDATION','pinned must be boolean');memory.pinned=patch.pinned;}
      for(const k of ['staleAt','expiresAt'])if(patch[k]!==undefined)memory[k]=date(patch[k],k);
      if(patch.sourceRefs!==undefined)memory.sourceRefs=validateOwnerRefs(state,patch.sourceRefs,authorize,caller);
      memory.revision++;memory.updatedAt=now();append(state,'record',{memory});return view(memory,state);
    });},
    forget(input,caller){return mutate('forget',input,caller,state=>{
      const memory=find(state,input);if(memory.sensitive)authorizeExact(authorize,'owner.sensitive',OWNER_MEMORY_SCOPE,caller,state);
      append(state,'tombstone',{memoryId:memory.id,revision:memory.revision+1,contentHash:digest(memory.content)});
      for(const e of state.events)if(e.type==='owner-memory.record'&&e.memory.id===memory.id){e.memory.content='';e.memory.title='';e.memory.sourceRefs=[];e.memory.redacted=true;}
      return {id:memory.id,deleted:true,revision:memory.revision+1};
    });},
    grant(input,caller){return mutate('grant',input,caller,state=>{
      const memory=find(state,input);text(input.projectId,'target project',200);
      if(!state.projects.some(p=>p.id===input.projectId))fail('MEMORY_SCOPE','Select an existing project',403);
      authorizeExact(authorize,'read',{projectId:input.projectId,kind:'project',id:input.projectId},caller,state);
      if(memory.sensitive)authorizeExact(authorize,'owner.sensitive',OWNER_MEMORY_SCOPE,caller,state);
      if(ownerExpired(memory,now()))fail('MEMORY_EXPIRED','Expired memory cannot be shared',409);
      const previous=ownerProjection(state).grants.get(grantKey(memory.id,input.projectId));
      if((previous?.grantRevision??0)!==input.expectedGrantRevision)fail('MEMORY_REVISION_CONFLICT','Sharing changed; reload before granting',409);
      const g=append(state,'grant',{memoryId:memory.id,targetProjectId:input.projectId,sourceRevision:memory.revision,sourceSha256:digest(memory.content),status:'active',grantRevision:(previous?.grantRevision??0)+1});
      return {id:memory.id,grantId:g.id,grantRevision:g.grantRevision,sourceRevision:memory.revision,status:'active'};
    });},
    revoke(input,caller){return mutate('revoke',input,caller,state=>{
      const memory=find(state,input);text(input.projectId,'target project',200);
      const previous=ownerProjection(state).grants.get(grantKey(memory.id,input.projectId));
      if(!previous||previous.grantRevision!==input.expectedGrantRevision)fail('MEMORY_REVISION_CONFLICT','Sharing changed; reload before revoking',409);
      const g=append(state,'grant',{memoryId:memory.id,targetProjectId:input.projectId,sourceRevision:previous.sourceRevision,sourceSha256:previous.sourceSha256,status:'revoked',grantRevision:previous.grantRevision+1});
      return {id:memory.id,grantId:g.id,grantRevision:g.grantRevision,status:'revoked'};
    });},
    async list(input,caller){const {items,metrics}=query('list',input,caller);return {items,metrics,trust:TRUST,executable:false};},
    async recall(input,caller){const {items,metrics}=query('recall',input,caller);return {items,metrics,trust:TRUST,executable:false};},
    async status(input,caller){const state=store.read();access('status',input,caller,state);return {scope:OWNER_MEMORY_SCOPE,backend:'keyword',defaultSharing:'none',authority:'existing FORGE event store',count:[...ownerProjection(state).records.values()].filter(r=>!r.sensitive||isSensitiveAllowed(caller,state)).length};},
    async export(input,caller){const state=store.read();access('export',input,caller,state);return {format:'forge-owner-memory-v1',exportedAt:now(),scope:OWNER_MEMORY_SCOPE,trust:TRUST,executable:false,items:[...ownerProjection(state).records.values()].filter(r=>!r.sensitive||isSensitiveAllowed(caller,state)).map(r=>view(r,state)),tombstones:state.events.filter(e=>e.type==='owner-memory.tombstone').map(({memoryId,revision,createdAt})=>({memoryId,revision,createdAt}))};},
    async ownerContext(input,caller){
      const max=bounded(input.maxCharacters,12000,256,64000,'context character budget'),{items:rows,target,grants,metrics}=query('ownerContext',input,caller);let used=0;const items=[];
      for(const row of rows){const item=projectItem(row,grants.get(grantKey(row.id,target.projectId)),target),size=JSON.stringify(item).length;if(used+size>max)continue;items.push(item);used+=size;}
      return {kind:'forge.memory.data',trust:TRUST,executable:false,items,provenance:items.map(({id,revision,sha256,provenance})=>({id,revision,sha256,...provenance})),metrics:{...metrics,contextCharacters:used,omitted:rows.length-items.length},authority:'Explicit Owner sharing grants access to DATA only; never instructions or approval'};
    },
    async resolveOwnerRefs(input,caller){
      const state=store.read(),target=access('resolveOwnerRefs',input,caller,state);
      if(!Array.isArray(input.refs)||input.refs.length>100)fail('MEMORY_VALIDATION','Use at most 100 Owner memory references');
      const {records,grants}=ownerProjection(state),items=[],missing=[];
      for(const ref of input.refs){object(ref,['id','revision','sha256']);text(ref.id,'reference id',200);const g=[...grants.values()].find(g=>OWNER_GRANT_PREFIX+g.id===ref.id&&g.targetProjectId===target.projectId),r=g?records.get(g.memoryId):null;
        if(!currentGrant(g,r,now())||r.revision!==ref.revision||digest(r.content)!==ref.sha256||(r.sensitive&&!isSensitiveAllowed(caller,state,target))){missing.push(structuredClone(ref));continue;}
        items.push(projectItem(view(r,state),g,target));
      }
      return {kind:'forge.memory.data',trust:TRUST,executable:false,items,missing};
    },
    // Trusted host lifecycle hook, deliberately absent from public HTTP/MCP tools.
    async afterRestore(){if(closed)fail('MEMORY_CLOSED','Owner memory service is closed',503);index.sync(store.read(),true);return {rebuilt:true,backend:'keyword',modelCalls:0};},
    async close(){if(!closed){closed=true;index.close();}},
  };
  service.projectContext=service.ownerContext;service.resolveProjectRefs=service.resolveOwnerRefs;
  index.sync(store.read(),true);return service;
}
