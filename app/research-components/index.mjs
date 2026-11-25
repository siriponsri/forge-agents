import {performance} from 'node:perf_hooks';
import {buildResearchContext} from '../research/context.mjs';
import {approvedTask,taskSignature,planSignature,assertNoMixedControllers} from '../workspaces/contracts.mjs';
import {routePin,validateRoutePin} from './routes.mjs';
import {componentUsage,assertContinuation} from './accounting.mjs';
import {createComponentArtifacts} from './artifacts.mjs';
import {seal,intact,trialFor,compositionFor,allocationsFor,stopped,workspaceFor,workspacePin,runFor,contextForAllocation,evidenceFor,validateSkills,records,digest,fail,exact,terminal} from './contracts.mjs';
export {resolveResearchAllocation,validateResearchComponentContext,contextForAllocation} from './contracts.mjs';
export {componentUsage} from './accounting.mjs';
export {runResearchComposition} from './runner.mjs';

// Policy composition only. Workspace/T3 remain the sole execution and Stop owners.
export function createResearchComponentService({store,workspaces,adaptive,providers,authorizeOwner,dataDir,clock=Date.now,registry,stopExistingWorkspace}={}){
  if(!store?.read||!store?.transaction||!dataDir)throw new TypeError('Existing durable store and private dataDir required');
  const pending=new Set(),locks=new Set(),timers=new Map();let closed=false;
  const artifacts=createComponentArtifacts({store,dataDir,clock,registry});
  const current=(s,i)=>{const c=compositionFor(s,i.projectId,i.trialId);if(!c)fail('RESEARCH_COMPONENT_SETUP','Prepare the immutable cohort first',409);return c;};
  async function identity(i,caller){if(closed)fail('RESEARCH_COMPONENT_CLOSED','Service closed',409);const actor=await authorizeOwner?.({action:'research-components',projectId:i.projectId},caller);if(actor?.kind!=='human'||actor.role!=='owner')fail('OWNER_REQUIRED','Authenticated opaque local Owner authority required',403);}
  function supported(){return workspaces?.researchComponentContextVersion===1&&['start','stop','reconcile'].every(k=>typeof workspaces[k]==='function')&&typeof adaptive?.select==='function'&&typeof providers?.validateSelection==='function'&&typeof providers?.catalog==='function';}
  function track(p){pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
  async function command(method,input,caller,fn){
    input=structuredClone(input);await identity(input,caller);if(typeof input.operationId!=='string'||!input.operationId||input.operationId.length>200)fail('RESEARCH_COMPONENT_COMMAND','Bounded operation identity required',409);
    const fingerprint=digest({method,input}),key=`${input.projectId}:${input.trialId}:${method==='stop'?'stop':'work'}`;
    const claim=await store.transaction(s=>{
      const existing=records(s,'component-operation').find(e=>e.operationId===input.operationId);
      if(existing){intact(existing);if(existing.fingerprint!==fingerprint)fail('OPERATION_REUSE','Component operation reused with different input',409);const result=records(s,'component-result').find(e=>e.commandId===existing.id);return {replay:true,result:result?intact(result).result:{status:'reconcile-required',commandId:existing.id}};}
      if(s.receipts.some(r=>r.operationId===input.operationId)||s.runs.some(r=>r.operationId===input.operationId)||s.events.some(e=>e.operationId===input.operationId))fail('OPERATION_REUSE','Operation belongs to another owner',409);
      if(locks.has(key))fail('RESEARCH_COMPONENT_BUSY','Another cohort command is pending; reconcile',409);
      const c=compositionFor(s,input.projectId,input.trialId);
      return {event:seal(s,'component-operation',{operationId:input.operationId,fingerprint,method,trialId:input.trialId,compositionId:c?.id??null},input.projectId,clock)};
    });
    if(claim.replay)return claim.result;
    locks.add(key);const start=performance.now();
    try{const result=await fn(input);await store.transaction(s=>seal(s,'component-result',{commandId:claim.event.id,result},input.projectId,clock));return result;}
    catch(error){await store.transaction(s=>seal(s,'component-result',{commandId:claim.event.id,result:{status:'reconcile-required',error:{code:error.code??'OUTCOME_UNKNOWN',message:'Canonical owner outcome requires reconciliation'}}},input.projectId,clock));throw error;}
    finally{locks.delete(key);await store.transaction(s=>{const c=compositionFor(s,input.projectId,input.trialId);if(c)seal(s,'controller-overhead',{compositionId:c.id,trialId:c.trialId,method,commandId:claim.event.id,elapsedMs:Math.max(0,performance.now()-start),tokens:null,cost:null,currency:null},input.projectId,clock);});}
  }
  function fence(s,c){
    const t=trialFor(s,c.projectId,c.trialId);
    if(t.manifestDigest!==c.manifestDigest||stopped(s,c)||t.stopRequested||t.restoreReviewRequired||!['reserved','dispatching','running'].includes(t.status)||t.deadlineAt!==null&&clock()>=t.deadlineAt)fail('RESEARCH_COMPONENT_STOP','Trial is stopped, expired or awaiting recovery',409);
    validateRoutePin(s,c.projectId,c.routePin,clock);assertNoMixedControllers(s,c.projectId,{taskId:t.manifest.taskId});return t;
  }
  function checkProvider(s,c){
    const pin=validateRoutePin(s,c.projectId,c.routePin,clock),observed=providers.catalog({projectId:c.projectId,connectionId:pin.connectionId});
    if(observed.stale||observed.error)fail('RESEARCH_COMPONENT_ROUTE','Exact provider catalog expired',409);
    const actual=providers.validateSelection({projectId:c.projectId,connectionId:pin.connectionId,selection:pin.selection});
    if(digest(actual)!==digest(c.slots[0].selection))fail('RESEARCH_COMPONENT_ROUTE','Actual owner selection no longer matches the pinned route',409);
  }
  function completion(s,c){
    const results=records(s,'component-result',c.projectId).map(intact).filter(e=>e.result?.composition?.id===c.id&&['PASSED','FAILED'].includes(e.result.status));
    if(!results.length||allocationsFor(s,c).some(a=>{const r=runFor(s,a);return !r||!terminal.has(r.status);}))return null;
    const final=results.at(-1).result,all=allocationsFor(s,c);
    if(final.attempts.length!==all.length||all.some(a=>{const old=final.attempts.find(x=>x.allocation.id===a.id),r=runFor(s,a),e=evidenceFor(s,c,a);return !old||old.run?.id!==r?.id||old.run?.status!==r?.status||(old.evidence?.id??null)!==(e?.id??null);}))return null;
    return final.status;
  }
  function summary(s,c){
    const t=trialFor(s,c.projectId,c.trialId),all=allocationsFor(s,c),attempts=all.map(a=>({allocation:a,run:runFor(s,a),evidence:evidenceFor(s,c,a)}));
    const active=attempts.find(x=>!x.run||!terminal.has(x.run.status)),unvalidated=attempts.find(x=>x.run?.status==='completed'&&!x.evidence),effective=attempts.filter(x=>x.allocation.role!=='helper').at(-1);
    let status=stopped(s,c)||t.stopRequested?(active?'stopping':'stopped'):active?(active.run&&active.run.status!=='unknown'?'running':'reconcile-required'):unvalidated?'awaiting-validation':completion(s,c)??(all.length?'ready':'prepared');
    return {composition:c,trialId:t.id,status,attempts,usage:componentUsage(s,c),effectiveEvidence:effective?.evidence??null,qualification:'CANONICAL_OWNER_COMPOSITION; native execution qualification belongs to host'};
  }
  function choose(s,c){
    const all=allocationsFor(s,c),used=new Set(all.map(a=>a.workspaceId));
    if(!all.length)return {slot:c.slots[0],reason:c.policy==='static'?'fixed-reviewed-route':'initial-capability-qualified-route',evidence:null};
    for(const a of all){const r=runFor(s,a);if(!r||!terminal.has(r.status))return {status:'reconcile-required'};if(r.status!=='completed')return {status:'FAILED',reason:'noncompleted-owner-run'};if(!evidenceFor(s,c,a))return {status:'awaiting-validation'};}
    const helper=c.slots.find(x=>x.role==='helper'&&x.enabled&&!used.has(x.workspaceId));
    if(helper)return {slot:helper,reason:'bounded-staffing-allocation',evidence:null};
    const last=all.filter(a=>a.role!=='helper').at(-1),e=evidenceFor(s,c,last);
    if(e.status==='PASSED')return {status:c.components.verification&&all.some(a=>a.role==='helper'&&evidenceFor(s,c,a)?.status!=='PASSED')?'FAILED':'PASSED'};
    const revision=c.slots.find(x=>x.role==='revision'&&x.enabled&&!used.has(x.workspaceId));
    if(!revision)return {status:'FAILED',reason:'no-authorized-revision'};
    const deterministicFailure=e.checks.some(k=>['deterministic','held-out'].includes(k.kind)&&k.passed===false),intactInput=e.checks.some(k=>k.kind==='external-state'&&k.passed===true),artifact=e.checks.some(k=>k.kind==='artifact'&&k.passed===true&&k.sha256===e.artifact?.sha256);
    if(!deterministicFailure||c.policy==='evidence-guided'&&(!intactInput||!artifact))return {status:'FAILED',reason:'insufficient-independent-adaptation-evidence'};
    return {slot:revision,reason:c.policy==='rule-adapt'?'rule:independent-answer-check-failed':'evidence:input-intact-artifact-observed-answer-check-failed',evidence:e};
  }
  async function stopCohort(i,caller,{recovery=false}={}){
    const c=current(store.read(),i),t=trialFor(store.read(),i.projectId,i.trialId);
    if(recovery&&(!Number.isSafeInteger(t.deadlineAt)||clock()<t.deadlineAt&&!t.stopRequested))fail('RESEARCH_COMPONENT_STOP','Recovery may only stop expired or already stopped work',409);
    clearTimeout(timers.get(c.id));timers.delete(c.id);
    await store.transaction(s=>{const t=trialFor(s,i.projectId,i.trialId);t.stopRequested=true;t.status='stopping';t.revision++;if(!stopped(s,c))seal(s,'component-stop',{compositionId:c.id,trialId:c.trialId,reason:recovery?'absolute-deadline-recovery':'owner-or-absolute-deadline'},i.projectId,clock);});
    for(const a of allocationsFor(store.read(),c)){
      const claim=await store.transaction(s=>{if(records(s,'component-stop-claim',i.projectId).some(e=>e.allocationId===a.id))return false;seal(s,'component-stop-claim',{compositionId:c.id,allocationId:a.id,workspaceId:a.workspaceId,workspaceStopOperationId:`research-component-stop:${a.id}`},i.projectId,clock);return true;});
      if(claim){const s=store.read(),w=workspaceFor(s,a.workspaceId,i.projectId),r=runFor(s,a),input={projectId:i.projectId,workspaceId:w.id,operationId:`research-component-stop:${a.id}`,expectedRevision:w.revision};try{if(recovery){if(typeof stopExistingWorkspace!=='function')fail('RESEARCH_COMPONENT_RECOVERY','Private existing-attempt Stop is unavailable',409);if(r&&!terminal.has(r.status))await stopExistingWorkspace(input,{runId:r.id,reason:'absolute-deadline'});}else await workspaces.stop(input,caller);}catch{/* Unknown Stop stays retained; never submit it twice. */}}
    }
    return summary(store.read(),c);
  }
  function arm(c,caller){if(timers.has(c.id)||stopped(store.read(),c)||completion(store.read(),c))return;const t=trialFor(store.read(),c.projectId,c.trialId);if(!t.deadlineAt||['PASSED','FAILED','stopped','LIMIT_REACHED'].includes(t.status))return;const timer=setTimeout(()=>{timers.delete(c.id);const input={projectId:c.projectId,trialId:c.trialId,operationId:`research-components-deadline:${c.id}`};track(caller==null?stopCohort(input,null,{recovery:true}):api.stop(input,caller)).catch(()=>{});},Math.max(0,t.deadlineAt-clock()));timer.unref?.();timers.set(c.id,timer);}
  const api={
    contextVersion:1,
    prepare(input,caller){return track(command('prepare',input,caller,async i=>{
      exact(i,['projectId','trialId','operationId','slots']);if(!supported())fail('RESEARCH_COMPONENT_INTEGRATION','Host-only Workspace composition forwarding and existing owner APIs required',409);
      let s=store.read(),t=trialFor(s,i.projectId,i.trialId);if(t.status!=='reserved'||t.stopRequested||t.restoreReviewRequired)fail('RESEARCH_COMPONENT_SETUP','Prepare only an unused reserved trial',409);
      if(compositionFor(s,i.projectId,i.trialId))fail('RESEARCH_COMPONENT_SETUP','Composition already pinned; replay or use its existing identity',409);
      if(t.manifest.adapter.id!=='forge-table'||t.manifest.adapter.version!=='1')fail('RESEARCH_COMPONENT_ADAPTER','Only the pinned table agent protocol currently composes',409);
      if(!Array.isArray(i.slots)||i.slots.length<1||i.slots.length>4||i.slots.some(slot=>!slot||typeof slot!=='object'||Array.isArray(slot))||i.slots[0].role!=='primary'||i.slots.filter(x=>x.role==='primary').length!==1||new Set(i.slots.map(x=>x.workspaceId)).size!==i.slots.length)fail('RESEARCH_COMPONENT_SETUP','One primary and distinct bounded helper/revision slots required',409);
      const pin=routePin(s,i.projectId,clock),observed=providers.catalog({projectId:i.projectId,connectionId:pin.connectionId});if(observed.stale||observed.error)fail('RESEARCH_COMPONENT_ROUTE','Refresh the actual provider catalog',409);
      const selection=providers.validateSelection({projectId:i.projectId,connectionId:pin.connectionId,selection:pin.selection});
      const slots=[];
      for(const raw of i.slots){
        exact(raw,['workspaceId','role','skillIds']);if(!['primary','helper','revision'].includes(raw.role)||!Array.isArray(raw.skillIds)||raw.skillIds.length>8||new Set(raw.skillIds).size!==raw.skillIds.length||raw.skillIds.some(id=>typeof id!=='string'||!id))fail('RESEARCH_COMPONENT_SETUP','Explicit reviewed skill IDs and bounded roles required',409);
        s=store.read();const w=workspaceFor(s,raw.workspaceId,i.projectId),{task,plan}=approvedTask(s,i.projectId,w.taskId),primary=workspaceFor(s,t.manifest.workspaceId,i.projectId);
        if(w.status!=='ready'||w.runOperationId||w.stopRequested||w.restoreReviewRequired||w.baseSha!==t.manifest.workspaceBase||w.sourceHeadSha!==primary.sourceHeadSha||w.commonDir!==primary.commonDir||w.profileDigest!==primary.profileDigest||w.planId!==primary.planId||raw.role==='primary'&&w.id!==primary.id||records(s,'trial').some(other=>other.id!==t.id&&other.manifest.workspaceId===w.id)||records(s,'composition').some(c=>c.slots.some(slot=>slot.workspaceId===w.id)))fail('RESEARCH_COMPONENT_SETUP','Unused same-base approved cohort workspace required',409);
        const decision=await adaptive.select({projectId:i.projectId,taskId:task.id,operationId:`research-component-selection:${t.id}:${w.id}`,constraints:{requiredCapabilities:['t3.run','t3.reconcile','t3.stop'],skillIds:t.manifest.components.skills?raw.skillIds:[],maxSkills:Math.max(1,raw.skillIds.length)}});
        if(decision.status!=='selected'||digest({instanceId:decision.harness?.providerInstanceId,model:decision.harness?.model,options:decision.harness?.options})!==digest(pin.selection))fail('RESEARCH_COMPONENT_ROUTE','Adaptive owner did not select the exact catalog-qualified route',409);
        const skills=t.manifest.components.skills?decision.skills.filter(skill=>raw.skillIds.includes(skill.id)):[];
        if(t.manifest.components.skills&&(!skills.length||skills.length!==raw.skillIds.length||skills.some(skill=>store.read().skills.find(x=>x.id===skill.id)?.status!=='active')))fail('RESEARCH_COMPONENT_SKILL','Skills ON requires actual active Owner-reviewed versioned instructions',409);
        slots.push({workspaceId:w.id,taskId:task.id,botId:task.botId??null,role:raw.role,enabled:raw.role==='primary'||raw.role==='helper'&&t.manifest.components.staffing||raw.role==='revision'&&t.manifest.components.adaptation&&['rule-adapt','evidence-guided'].includes(t.manifest.policy),taskSignature:taskSignature(task),planSignature:planSignature(plan),workspaceDigest:workspacePin(w),decisionId:decision.id,decisionDigest:digest(decision),selection,skills});
      }
      if(new Set(slots.map(x=>x.taskId)).size!==slots.length)fail('RESEARCH_COMPONENT_SETUP','Every cohort workspace needs a distinct canonical task',409);
      const enabled=slots.filter(x=>x.enabled),limits=t.manifest.limits;
      if(enabled.length>limits.maxAgents||enabled.length>limits.maxSteps||enabled.filter(x=>x.role==='revision').length>limits.maxRetries||t.manifest.components.staffing&&!enabled.some(x=>x.role==='helper')||t.manifest.components.adaptation&&['rule-adapt','evidence-guided'].includes(t.manifest.policy)&&!enabled.some(x=>x.role==='revision'))fail('RESEARCH_COMPONENT_BUDGET','Pre-approved staffing/revision capacity must fit the global trial envelope',409);
      for(const slot of slots)slot.envelope=slot.enabled?{maxMs:limits.maxMs,maxSteps:Math.floor(limits.maxSteps/enabled.length),maxRetries:0,maxAgents:1,maxTokens:limits.maxTokens===null?null:Math.floor(limits.maxTokens/enabled.length),maxCost:limits.maxCost===null?null:limits.maxCost/enabled.length}:null;
      if(enabled.some(x=>x.envelope.maxTokens!==null&&x.envelope.maxTokens<1))fail('RESEARCH_COMPONENT_BUDGET','Token cap cannot cover all approved allocations',409);
      return store.transaction(s=>{t=trialFor(s,i.projectId,i.trialId);if(compositionFor(s,i.projectId,i.trialId)||t.status!=='reserved'||t.stopRequested||t.restoreReviewRequired)fail('RESEARCH_COMPONENT_SETUP','Trial changed during setup',409);validateRoutePin(s,i.projectId,pin,clock);assertNoMixedControllers(s,i.projectId,{taskId:t.manifest.taskId});for(const slot of slots){const w=workspaceFor(s,slot.workspaceId,i.projectId),{task,plan}=approvedTask(s,i.projectId,w.taskId);if(w.status!=='ready'||w.runOperationId||workspacePin(w)!==slot.workspaceDigest||taskSignature(task)!==slot.taskSignature||planSignature(plan)!==slot.planSignature)fail('RESEARCH_COMPONENT_SETUP','Approved cohort changed during setup',409);validateSkills(s,{projectId:i.projectId,components:t.manifest.components},slot);}return seal(s,'composition',{version:1,trialId:t.id,manifestDigest:t.manifestDigest,policy:t.manifest.policy,components:t.manifest.components,limits,routePin:pin,slots,approvedBy:'authenticated-local-owner',method:'configured exact route qualified by actual catalog and Adaptive owner; bounded isolated allocations'},i.projectId,clock);});
    }));},
    advance(input,caller){return track(command('advance',input,caller,async i=>{
      exact(i,['projectId','trialId','operationId']);if(!supported())fail('RESEARCH_COMPONENT_INTEGRATION','Existing Workspace host composition seam required',409);
      let s=store.read(),c=current(s,i);fence(s,c);checkProvider(s,c);
      const next=choose(s,c);if(!next.slot){if(['PASSED','FAILED'].includes(next.status)){clearTimeout(timers.get(c.id));timers.delete(c.id);}return {...summary(s,c),status:next.status,reason:next.reason??null};}
      const a=await store.transaction(s=>{
        const c=current(s,i),t=fence(s,c),choice=choose(s,c);if(choice.slot?.workspaceId!==next.slot.workspaceId)fail('RESEARCH_COMPONENT_BUSY','Cohort allocation changed',409);assertContinuation(s,c,t.manifest.limits);
        if(allocationsFor(s,c).length>=t.manifest.limits.maxAgents)fail('RESEARCH_COMPONENT_BUDGET','Global agent allocation limit reached',409);
        const slot=choice.slot,w=workspaceFor(s,slot.workspaceId,i.projectId);if(w.status!=='ready'||w.runOperationId||w.stopRequested||w.restoreReviewRequired||workspacePin(w)!==slot.workspaceDigest)fail('RESEARCH_COMPONENT_SCOPE','Allocation workspace changed before dispatch',409);validateSkills(s,c,slot);
        if(t.deadlineAt===null){t.startedAt=clock();t.deadlineAt=t.startedAt+t.manifest.limits.maxMs;}t.status='dispatching';t.revision++;
        const helpers=allocationsFor(s,c).filter(a=>a.role==='helper').map(a=>evidenceFor(s,c,a)).filter(e=>e?.status==='PASSED');
        const decision=seal(s,'component-decision',{compositionId:c.id,trialId:t.id,manifestDigest:t.manifestDigest,policy:c.policy,action:choice.reason,evidenceId:choice.evidence?.id??null,slotId:slot.workspaceId,usage:componentUsage(s,c),mandatorySecurity:true},i.projectId,clock);
        return seal(s,'allocation',{compositionId:c.id,trialId:t.id,manifestDigest:t.manifestDigest,workspaceId:w.id,taskId:w.taskId,botId:w.botId??null,operationId:`workspace-run:${w.id}`,workspaceStartOperationId:`research-component-workspace:${c.id}:${w.id}`,role:slot.role,selection:slot.selection,skills:slot.skills,decisionId:slot.decisionId,policyDecisionId:decision.id,envelope:slot.envelope,feedback:{evidenceId:choice.evidence?.id??null,reason:choice.reason,helperEvidenceIds:slot.role==='revision'?helpers.map(e=>e.id):[]}},i.projectId,clock);
      });
      arm(c,caller);
      // Claim was durable before this sole effect. No replay/recovery redispatches.
      s=store.read();c=current(s,i);fence(s,c);checkProvider(s,c);
      const w=workspaceFor(s,a.workspaceId,i.projectId);
      const result=await workspaces.start({projectId:i.projectId,workspaceId:w.id,operationId:a.workspaceStartOperationId,expectedRevision:w.revision},caller,{researchContext:buildResearchContext(s,{projectId:i.projectId,trialId:i.trialId}),researchComponentContext:contextForAllocation(a)});
      return store.transaction(s=>{const c=current(s,i),run=runFor(s,a);seal(s,'component-observation',{compositionId:c.id,allocationId:a.id,runId:run?.id??null,attemptId:run?.attemptId??null,status:run?.status??'unknown',workspaceStatus:result?.status??null},i.projectId,clock);return summary(s,c);});
    }));},
    reconcile(input,caller){return track(command('reconcile',input,caller,async i=>{
      exact(i,['projectId','trialId','operationId']);const c=current(store.read(),i),t=trialFor(store.read(),i.projectId,i.trialId);
      if(t.deadlineAt!==null&&clock()>=t.deadlineAt&&!stopped(store.read(),c)&&!completion(store.read(),c)&&!['PASSED','FAILED','stopped','LIMIT_REACHED'].includes(t.status))await api.stop({...i,operationId:`research-components-deadline:${c.id}`},caller);
      for(const a of allocationsFor(store.read(),c)){const s=store.read(),w=workspaceFor(s,a.workspaceId,i.projectId);if(w.runOperationId)await workspaces.reconcile({projectId:i.projectId,workspaceId:w.id,operationId:`research-component-reconcile:${i.operationId}:${a.id}`,expectedRevision:w.revision},caller);}
      const result=summary(store.read(),c);if(!['stopped','stopping'].includes(result.status)&&result.attempts.some(x=>!x.run||!terminal.has(x.run.status)))arm(c,caller);return result;
    }));},
    validate(input,caller){return track(command('validate',input,caller,async i=>{
      exact(i,['projectId','trialId','operationId','allocationId']);const s=store.read(),c=current(s,i),a=allocationsFor(s,c).find(a=>a.id===i.allocationId);if(!a)fail('RESEARCH_COMPONENT_SCOPE','Allocation not in this cohort',409);const r=runFor(s,a);if(!r)fail('RESEARCH_COMPONENT_SCOPE','Canonical run not observed',409);return artifacts.validate(r);
    }));},
    stop(input,caller){return track(command('stop',input,caller,async i=>{
      exact(i,['projectId','trialId','operationId']);return stopCohort(i,caller);
    }));},
    async state(input,caller){await identity(input,caller);return summary(store.read(),current(store.read(),input));},
    preparePrompt(args){if(closed)fail('RESEARCH_COMPONENT_CLOSED','Service closed',409);return track(artifacts.preparePrompt(args));},
    validatePrompt(...args){if(closed)fail('RESEARCH_COMPONENT_CLOSED','Service closed',409);return artifacts.validatePrompt(...args);},
    // Recovery may observe/arm existing work only. Opaque authority is host-provided.
    async recover(caller){for(const c of records(store.read(),'composition').map(intact)){const t=trialFor(store.read(),c.projectId,c.trialId);if(stopped(store.read(),c)||completion(store.read(),c)||['PASSED','FAILED','stopped','LIMIT_REACHED'].includes(t.status))continue;const all=allocationsFor(store.read(),c);if(all.length){if(t.deadlineAt!==null&&clock()>=t.deadlineAt){if(caller==null)await stopCohort({projectId:c.projectId,trialId:c.trialId},null,{recovery:true});else await api.stop({projectId:c.projectId,trialId:c.trialId,operationId:`research-components-deadline:${c.id}`},caller);}else arm(c,caller);}}return {status:'reconciliation-only',redispatch:false};},
    async close(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();await Promise.allSettled([...pending]);},
  };
  return api;
}
