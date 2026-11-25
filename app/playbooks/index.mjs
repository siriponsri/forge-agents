import {append,record,records,find,fail,changed,revision,digest,exact,text,brief,decisions,findings} from './contracts.mjs';
import {presets,getPreset} from './presets.mjs';
import {resolveEvidence,recheckReview} from './evidence.mjs';
import {definition as missionDefinition} from '../missions/contracts.mjs';
import {projection,safeContent} from '../memory/contracts.mjs';

const base=['projectId','operationId'],bound=[...base,'workflowId','expectedRevision'];
const fields={presets:['projectId'],state:['projectId'],create:[...base,'presetId','title','brief','decisions'],revise:[...bound,'title','brief','decisions'],materialize:[...bound,'definition'],review:[...bound,'evidence','findings'],proposeLesson:[...bound,'reviewId','title','procedure']};
export const PLAYBOOK_HTTP_METHODS=Object.freeze(Object.keys(fields));
export async function dispatchPlaybookRequest(service,method,input,caller){
  if(!PLAYBOOK_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Workflow Presets method',404);
  exact(input,fields[method]);return service[method](input,caller);
}

// All intent/review metadata uses canonical events and receipts. Mission, Goals,
// Parallel, Assistance and Adaptive retain their existing execution authority.
export function createPlaybookService({store,missions,memory,adaptive,authorize}={}){
  if(!store?.read||!store?.transaction)throw new TypeError('A durable FORGE store is required');
  let suspended=false,closed=false;const work=new Set(),effects=new Map();
  function active(){if(closed||suspended)fail('RESTORING','Workflow Presets is suspended or closed',409);}
  function tracked(fn){const p=Promise.resolve().then(fn);work.add(p);p.then(()=>work.delete(p),()=>work.delete(p));return p;}
  function once(id,fn){if(!effects.has(id)){const p=Promise.resolve().then(fn);effects.set(id,p);p.then(()=>effects.delete(id),()=>effects.delete(id));}return effects.get(id);}
  async function owner(method,i,caller){
    active();exact(i,fields[method]);text(i.projectId,'Project id',200);find(store.read(),'projects',i.projectId);
    const actor=await authorize?.({action:'playbook',projectId:i.projectId,workflowId:i.workflowId,expectedRevision:i.expectedRevision},caller);
    if(actor?.kind!=='human'||actor.role!=='owner'||typeof actor.subject!=='string'||!actor.subject)fail('HUMAN_REVIEW_REQUIRED','Use the authenticated private Owner session',403);
    return {kind:'human',role:'owner',subject:actor.subject};
  }
  const workflow=(s,i)=>record(s,'workflow',i.workflowId,i.projectId);
  function writable(w){if(w.pending)fail('RECONCILE_REQUIRED','Reconcile the reserved command with its original operation id',409);}
  async function mutate(method,input,caller,fn){
    const i=structuredClone(input),actor=await owner(method,i,caller);text(i.operationId,'Operation id',180);
    const fingerprint=digest({service:'playbooks',method,input:i});
    return store.transaction(async s=>{
      active();find(s,'projects',i.projectId);
      const old=s.receipts.find(r=>r.operationId===i.operationId);
      if(old){if(old.fingerprint!==fingerprint||old.type!=='playbook.command')fail('OPERATION_REUSE','Operation ID belongs to different input',409);return old.result;}
      if(s.events.some(e=>e.type==='memory.operation'&&e.operationId===i.operationId))fail('OPERATION_REUSE','Operation ID belongs to Memory',409);
      const w=method==='create'?null:workflow(s,i);if(w){revision(w,i.expectedRevision);writable(w);if(w.restoreReviewRequired&&method!=='revise')fail('OWNER_REVIEW_REQUIRED','Save a reviewed brief revision after restore',409);}
      const result=await fn(s,w,i,actor);s.receipts.push({type:'playbook.command',operationId:i.operationId,method,projectId:i.projectId,fingerprint,result:structuredClone(result)});return result;
    });
  }
  function saveBrief(s,w,i,actor){
    const b=append(s,'brief',{workflowId:w.id,briefRevision:(w.briefRevision??0)+1,title:text(i.title,'Workflow title',180),brief:brief(i.brief),decisions:decisions(i.decisions),preset:structuredClone(w.preset),actor},i.projectId);
    Object.assign(w,{title:b.title,briefId:b.id,briefRevision:b.briefRevision,status:'draft',missionId:null,missionDefinitionRevision:null,restoreReviewRequired:false});return b;
  }
  function ensureResolved(s,w){const b=record(s,'brief',w.briefId,w.projectId);if(b.decisions.some(d=>!d.answer))fail('DECISION_REQUIRED','Resolve the explicit decisions before creating a Mission draft',409);return b;}
  function ticket(s,w,kind,i,payload,actor){
    const x=append(s,kind,{workflowId:w.id,briefId:w.briefId,briefRevision:w.briefRevision,operationId:i.operationId,status:'reserved',request:structuredClone(i),payload,actor},w.projectId);
    w.pending={id:x.id,kind,operationId:i.operationId};changed(w);return {reservationId:x.id,status:'reserved'};
  }
  async function finish(i,reserved,kind,fn){
    return store.transaction(async s=>{
      active();const x=record(s,kind,reserved.reservationId,i.projectId),w=workflow(s,i);
      if(x.status==='unknown')fail('OUTCOME_UNKNOWN','Restore invalidated the reservation; inspect existing Mission/Memory records',409);
      if(x.status==='completed')return s.receipts.find(r=>r.operationId===i.operationId).result;
      if(w.pending?.id!==x.id||w.briefId!==x.briefId)fail('REVISION_CONFLICT','Reserved workflow changed',409);
      const data=await fn(s,w,x);Object.assign(x,{status:'completed',...data});
      if(kind==='lesson'){x.payload.procedureSha256=digest(x.payload.procedure);delete x.payload.procedure;delete x.request;}
      changed(x);w.pending=null;changed(w);
      const result={workflow:structuredClone(w),...data};s.receipts.find(r=>r.operationId===i.operationId).result=structuredClone(result);return result;
    });
  }
  async function staleLesson(i,x,cause){
    await store.transaction(s=>{
      active();const current=record(s,'lesson',x.id,i.projectId),w=workflow(s,i);
      if(current.status!=='reserved'||s.events.some(e=>e.type==='memory.operation'&&e.operationId===`playbook-memory:${x.id}`))return;
      current.status='stale';current.reason=cause.code??'EVIDENCE_UNAVAILABLE';changed(current);
      if(w.pending?.id===x.id){w.pending=null;changed(w);}
      s.receipts.find(r=>r.operationId===i.operationId).result={status:'stale',lessonId:x.id,reason:current.reason,action:'Review current evidence and submit a new lesson operation'};
    });
  }
  const api={
    async presets(i,c){await owner('presets',i,c);return {presets:presets()};},
    async state(i,c){
      await owner('state',i,c);const s=store.read(),workflows=records(s,'workflow',i.projectId),reviews=[];
      for(const r of records(s,'review',i.projectId)){
        let evidenceStatus='current',reason=null;try{await recheckReview(s,record(s,'workflow',r.workflowId,i.projectId),r);}catch(e){evidenceStatus='stale';reason=e.code??'EVIDENCE_UNAVAILABLE';}
        reviews.push({...r,evidenceStatus,reason});
      }
      const memories=projection(s).records;
      return {presets:presets(),workflows,briefs:records(s,'brief',i.projectId),reviews,lessons:records(s,'lesson',i.projectId).map(l=>({...l,evidenceStatus:reviews.find(r=>r.id===(l.reviewId??l.payload.reviewId))?.evidenceStatus??'stale',memory:memories.has(l.memoryId)?{id:l.memoryId,revision:memories.get(l.memoryId).revision,lessonStatus:memories.get(l.memoryId).lessonStatus}:null})),materializations:records(s,'materialization',i.projectId),
        capabilities:{executionOwner:'existing Mission / Goals / T3',patterns:'reviewable metadata; no scheduler',review:'Owner observations only; existing QA and Owner acceptance remain separate',lesson:'draft procedural Memory → existing Memory.proposeLesson → Adaptive candidate/evaluate/promote',adaptiveAvailable:!!adaptive?.candidate,memoryAvailable:!!memory?.remember,ownerStyle:'private Owner Memory with explicit project revision grants',routing:'existing connected provider catalog and explicit Assistance choices',homeUat:'NOT_RUN'}};
    },
    create:(i,c)=>tracked(()=>mutate('create',i,c,(s,_w,i,actor)=>{
      const preset=getPreset(i.presetId);if(!preset)fail('VALIDATION','Choose a compiled FORGE preset');
      const w=append(s,'workflow',{preset,actor},i.projectId);saveBrief(s,w,i,actor);return w;
    })),
    revise:(i,c)=>tracked(()=>mutate('revise',i,c,(s,w,i,actor)=>{saveBrief(s,w,i,actor);changed(w);return w;})),
    materialize:(i,c)=>tracked(async()=>{
      i=structuredClone(i);
      const reserved=await mutate('materialize',i,c,(s,w,i,actor)=>{
        if(!missions?.create)fail('MISSION_UNAVAILABLE','The existing Mission service is required',503);
        if(w.missionId)fail('ALREADY_MATERIALIZED','This brief already links a Mission; revise the brief for a new draft',409);
        const b=ensureResolved(s,w),definition=missionDefinition(i.definition);
        for(const o of definition.outputs)if(o.botId)find(s,'bots',o.botId,w.projectId);
        if(definition.decisions.some(d=>!d.answer.trim()))fail('DECISION_REQUIRED','Resolve Mission decisions before materializing',409);
        if(definition.objective!==b.brief.objective||b.decisions.some(d=>!definition.decisions.some(v=>v.id===d.id&&v.question===d.question&&v.answer===d.answer)))fail('BRIEF_MISMATCH','Mission objective and explicit brief decisions must match the reviewed brief',409);
        return ticket(s,w,'materialization',i,{definition,definitionSha256:digest(definition)},actor);
      });
      if(!reserved.reservationId)return reserved;
      return once(reserved.reservationId,async()=>{
      const x=record(store.read(),'materialization',reserved.reservationId,i.projectId);active();
      if(x.status==='unknown')fail('OUTCOME_UNKNOWN','Inspect restored Mission records; this reservation cannot create a new effect',409);
      const m=await missions.create({projectId:i.projectId,operationId:`playbook-mission:${x.id}`,definition:x.payload.definition},c);
      return finish(i,reserved,'materialization',(s,w,x)=>{
        const current=find(s,'events',m.id,i.projectId);find(s,'plans',m.planId,i.projectId);
        // Validate the durable Mission-create result. An Owner may have already
        // acted in Missions after a lost response; linking the original draft
        // must not reset or duplicate that independently authorized work.
        if(current.type!=='mission.definition'||m.type!=='mission.definition'||m.status!=='draft'||m.goalId||digest(m.definition)!==x.payload.definitionSha256)fail('MISSION_SCOPE','Existing Mission create did not return the exact unapproved draft',409);
        Object.assign(w,{missionId:m.id,missionDefinitionRevision:m.definitionRevision,status:'materialized'});
        return {missionId:m.id,missionDefinitionRevision:m.definitionRevision,planId:m.planId,taskIds:structuredClone(m.taskIds)};
      });
      });
    }),
    review:(i,c)=>tracked(()=>mutate('review',i,c,async(s,w,i,actor)=>{
      if(!w.missionId)fail('MISSION_REQUIRED','Create and verify the linked Mission through the existing Mission workspace first',409);
      const evidence=await resolveEvidence(s,w,i.evidence),r=append(s,'review',{workflowId:w.id,briefId:w.briefId,briefRevision:w.briefRevision,missionId:w.missionId,missionDefinitionRevision:w.missionDefinitionRevision,reviewVersion:records(s,'review',w.projectId).filter(r=>r.workflowId===w.id).length+1,evidence,findings:findings(i.findings,evidence.length),actor,interpretation:'Owner-recorded findings; no QA verdict, acceptance or model-quality claim'},w.projectId);
      changed(w);return r;
    })),
    proposeLesson:(i,c)=>tracked(async()=>{
      i=structuredClone(i);
      const reserved=await mutate('proposeLesson',i,c,async(s,w,i,actor)=>{
        if(!memory?.remember)fail('MEMORY_UNAVAILABLE','The existing scoped Memory service is required',503);
        const r=record(s,'review',i.reviewId,i.projectId);await recheckReview(s,w,r);
        const title=safeContent(text(i.title,'Lesson title',240)),procedure=safeContent(text(i.procedure,'Procedure',12000));
        const sourceRefs=[...new Map(r.evidence.flatMap(e=>[{kind:'run',id:e.ref.runId},{kind:'artifact',id:e.ref.artifactId},{kind:'verification',id:e.ref.verificationId}]).map(ref=>[`${ref.kind}:${ref.id}`,ref])).values()];
        if(sourceRefs.length>24)fail('EVIDENCE_SIZE','A draft lesson may reference at most 24 distinct evidence records');
        const sourceSnapshots=sourceRefs.map(ref=>{const item=find(s,{run:'runs',artifact:'artifacts',verification:'events'}[ref.kind],ref.id,w.projectId);return {...ref,revision:item.revision,sha256:digest(item)};});
        return ticket(s,w,'lesson',i,{reviewId:r.id,title,procedure,sourceRefs,sourceSnapshots},actor);
      });
      if(!reserved.reservationId)return reserved;
      return once(reserved.reservationId,async()=>{
      const x=record(store.read(),'lesson',reserved.reservationId,i.projectId);active();
      if(x.status==='unknown')fail('OUTCOME_UNKNOWN','Inspect restored Memory records; this reservation cannot create a new effect',409);
      const state=store.read(),old=state.events.find(e=>e.type==='memory.operation'&&e.projectId===i.projectId&&e.operationId===`playbook-memory:${x.id}`);
      // A lost response may already have committed the exact draft. Reconcile
      // its immutable original refs even if later recovery changed Goal state;
      // never create a new Memory from a stale reserved review.
      if(!old)try{await recheckReview(state,workflow(state,i),record(state,'review',x.payload.reviewId,i.projectId));}catch(e){await staleLesson(i,x,e);throw e;}
      const result=old?{id:old.memoryId}:await memory.remember({projectId:i.projectId,operationId:`playbook-memory:${x.id}`,scope:{projectId:i.projectId,kind:'project',id:i.projectId},memoryType:'procedural',title:x.payload.title,content:x.payload.procedure,sourceRefs:x.payload.sourceRefs},c);
      return finish(i,reserved,'lesson',async(s,w,x)=>{
        const m=projection(s).records.get(result.id);let evidenceStatus='current';try{await recheckReview(s,w,record(s,'review',x.payload.reviewId,i.projectId));}catch{evidenceStatus='stale';}
        // Forgetting or editing an already committed draft cannot resurrect its
        // original text on replay. Retain the unavailable relation and release
        // the reservation so a new reviewed operation can proceed.
        if(!m||m.projectId!==w.projectId||m.memoryType!=='procedural'||m.lessonStatus!=='draft'||m.content!==x.payload.procedure||m.title!==x.payload.title||m.executable!==false||digest(m.sourceRefs)!==digest(x.payload.sourceSnapshots))return {reviewId:x.payload.reviewId,memoryId:result.id,memoryRevision:null,lessonStatus:'unavailable',evidenceStatus:'stale',reason:'MEMORY_REMOVED_OR_CHANGED'};
        return {reviewId:x.payload.reviewId,memoryId:m.id,memoryRevision:m.revision,lessonStatus:'draft',evidenceStatus,adaptiveRoute:{service:'memory',method:'proposeLesson',next:'Choose a current active skill and review a new candidate; evaluate before any explicit promotion'}};
      });
      });
    }),
    async suspendForRestore(){suspended=true;await Promise.allSettled([...work]);},
    async afterRestore(){await store.transaction(s=>{for(const w of s.events.filter(e=>e.type==='playbook.workflow')){w.restoreReviewRequired=true;if(w.pending){const x=record(s,w.pending.kind,w.pending.id,w.projectId);x.status='unknown';changed(x);w.pending=null;}changed(w);}});},
    cancelRestore(){suspended=false;},
    async close(){closed=true;await Promise.allSettled([...work]);},
  };
  return api;
}
