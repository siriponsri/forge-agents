import {performance} from 'node:perf_hooks';
import {VERSION,POLICY_VERSION,LIMITS,COMPONENTS,POLICIES,FAULTS,canonical,digest,bytesDigest,fail,text,integer,exact,project,append,record,records,revision,normalizeConfig,verifyExperiment,verifyTrial,activeTrial} from './contracts.mjs';
import {createResearchAdapterRegistry} from './adapters.mjs';
import {trialDirectory,readFixed,writeFixed} from './files.mjs';
import {buildResearchContext,researchContextPolicy} from './context.mjs';
import {decideResearchPolicy,FUTURE_POLICY_INTERFACES,assertOwnerUsage} from './policies.mjs';
import {RESEARCH_SOURCES} from './sources.mjs';
import {redact} from '../context/contracts.mjs';
import {terminal as terminalRunStatuses} from '../workspaces/contracts.mjs';
export {buildResearchContext,researchContextPolicy,admitResearchTrial,assertResearchRestoreAvailable,mergeResearchSafety} from './context.mjs';
export {RESEARCH_HTTP_METHODS,dispatchResearchRequest} from './http.mjs';
export {createResearchAdapterRegistry} from './adapters.mjs';
export {digest} from './contracts.mjs';

export function defaultResearchConfig(){return {version:VERSION,name:'CPU engineering qualification',adapter:{id:'forge-table',version:'1'},split:'dev',repetitions:2,seed:42,policies:['static','rule-adapt'],ablations:[{name:'all',components:Object.fromEntries(COMPONENTS.map(k=>[k,true]))}],limits:{maxMs:5000,maxSteps:8,maxBytes:65536,maxRetries:1,maxAgents:1,maxTokens:null,maxCost:null,unknownAccounting:'block'},fault:'none',execution:'local'};}

// Research stores experimental records only. T3/Workspace retain task and turn
// ownership, Memory/Adaptive/Assistance/Budgets retain their respective controls.
export function createResearchService({store,dataDir,executionOwner,authorizeOwner,clock=Date.now,registry=createResearchAdapterRegistry()}={}){
  if(!store?.transaction||!store?.read||!dataDir)throw new TypeError('Canonical store and machine dataDir required');
  let suspended=false,closed=false;const pending=new Set(),locks=new Set();
  const trial=(s,i)=>record(s,'trial',i.trialId,i.projectId);
  function track(p){pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
  async function identity(method,input,caller){
    const actor=await authorizeOwner?.({action:method,projectId:input.projectId},caller);
    if(!actor||actor.kind!=='human'||actor.role!=='owner')fail('OWNER_REQUIRED','Authenticated local Owner required',403);
    project(store.read(),input.projectId);return actor;
  }
  async function mutate(method,input,caller,fn){
    input=structuredClone(input);await identity(method,input,caller);text(input.operationId,'operationId');
    if(closed||suspended)fail('RESEARCH_SUSPENDED','Research admissions are suspended',409);
    const fingerprint=digest({method,input}),resource=input.trialId??input.experimentId??input.projectId,key=method==='stop'?`${resource}:stop`:resource;
    const prior=records(store.read(),'operation').find(o=>o.operationId===input.operationId);
    if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to different research input',409);return structuredClone(prior.result??{status:prior.status,operationId:prior.operationId,trialId:input.trialId??null,error:prior.error??null});}
    if(locks.has(key))fail('RESEARCH_BUSY','Reconcile the in-flight research action',409);locks.add(key);
    let op;
    try{
      op=await store.transaction(s=>{if(s.receipts.some(o=>o.operationId===input.operationId)||s.events.some(o=>o.operationId===input.operationId)||s.runs.some(o=>o.operationId===input.operationId))fail('OPERATION_REUSE','Operation ID already reserved',409);return append(s,'operation',{operationId:input.operationId,fingerprint,method,input,status:'pending'},input.projectId,clock);});
      const result=await fn(input);
      return await store.transaction(s=>{const o=record(s,'operation',op.id,input.projectId);o.status='completed';o.result=structuredClone(result);o.revision++;s.receipts.push({operationId:input.operationId,type:`research.${method}`,fingerprint,result:structuredClone(result)});return result;});
    }catch(e){if(op)await store.transaction(s=>{const o=record(s,'operation',op.id,input.projectId);o.status='reconcile-required';o.error={code:e.code??'OUTCOME_UNKNOWN',message:redact(String(e.message)).slice(0,2000)};o.revision++;});throw e;}
    finally{locks.delete(key);}
  }
  function readTrial(i){const s=store.read(),t=trial(s,i),e=record(s,'experiment',t.manifest.experimentId,i.projectId);verifyTrial(t,e);const adapter=registry.get(e.config.adapter.id,e.config.adapter.version);if(digest(adapter.pin)!==digest(e.config.adapterPin)||adapter.dataset.digests[e.config.split]!==e.config.dataset.digest)fail('RESEARCH_ADAPTER_PIN','Adapter implementation/data changed; preserve historical result and create a new pinned experiment',409);return {s,t,e,config:e.config,adapter};}
  async function update(i,fn){return store.transaction(s=>{const t=trial(s,i);const result=fn(t,s);t.revision++;return result??t;});}
  function supported(){return executionOwner?.version===1&&['dispatch','reconcile','stop','telemetry','validate'].every(k=>typeof executionOwner[k]==='function');}
  async function checkpoint(i,dir,phase){
    const {t}=readTrial(i),data={version:1,manifestDigest:t.manifestDigest,inputDigest:t.prepared.inputDigest,step:t.steps,phase};
    const bytes=Buffer.from(canonical(data)+'\n');await writeFixed(dir,'checkpoint.json',bytes);
    return update(i,t=>{t.checkpoint={sha256:bytesDigest(bytes),phase,step:t.steps};});
  }
  async function verifyCheckpoint(t,dir){const saved=await readFixed(dir,'checkpoint.json',t.manifest.limits.maxBytes);if(!t.checkpoint||saved.sha256!==t.checkpoint.sha256)fail('RESEARCH_CHECKPOINT','Checkpoint bytes changed',409);const cp=JSON.parse(saved.bytes);if(cp.manifestDigest!==t.manifestDigest||cp.inputDigest!==t.prepared.inputDigest||cp.step!==t.checkpoint.step)fail('RESEARCH_CHECKPOINT','Checkpoint belongs to another trial',409);return cp;}
  async function localExecution(i){
    let {t,e,adapter}=readTrial(i);const start=performance.now();
    if(t.stopRequested||t.restoreReviewRequired)fail('RESEARCH_CONTEXT','Trial is stopped or requires restore review',409);
    if(!['reserved','interrupted'].includes(t.status))fail('RESEARCH_STATE','A local trial must be reserved or explicitly interrupted',409);
    if(!t.startedAt)await update(i,t=>{const startedAt=clock();t.startedAt=startedAt;t.deadlineAt=startedAt+t.manifest.limits.maxMs;});
    const dir=await trialDirectory(dataDir,t.id,{create:true});
    if(t.prepared){await verifyCheckpoint(t,dir);const input=await readFixed(dir,'input.json',t.manifest.limits.maxBytes);if(input.sha256!==t.prepared.inputDigest)fail('RESEARCH_SPLIT','Trial input bytes changed',409);}
    else{
      const prepared=await adapter.prepare({dir,split:e.config.split,seed:t.manifest.seed,limits:t.manifest.limits});
      await update(i,t=>{t.prepared=prepared;t.status='running';t.executionQualification='REAL_LOCAL_FIXED_NODE_FIXTURE';});await checkpoint(i,dir,'prepared');
    }
    t=readTrial(i).t;
    if(t.stopRequested||suspended||closed)return update(i,t=>{t.status='stopped';});
    const observation=t.faultInjected?{kind:t.manifest.fault==='stale-state'?'stale-state':t.manifest.fault==='tool-failure'?'tool-failure':'checkpoint-recovery',source:'local-fault-controller'}:null;
    let decision=decideResearchPolicy({policy:t.manifest.policy,components:t.manifest.components,limits:t.manifest.limits,observation,step:t.steps});
    if(t.status==='interrupted'&&decision.action!=='resume')return update(i,t=>{t.status='FAILED';t.failure='POLICY_DID_NOT_RESUME';});
    await update(i,t=>{t.status='running';t.trace.push({kind:'policy',decision,at:clock()});});
    if(t.manifest.fault!=='none'&&!t.faultInjected){
      await update(i,t=>{t.faultInjected=true;t.trace.push({kind:'fault',fault:t.manifest.fault,scope:'THIS_TRIAL_ONLY',seed:t.manifest.seed,at:clock()});});
      const kind=t.manifest.fault;
      if(['session-interruption','checkpoint-recovery'].includes(kind)){await checkpoint(i,dir,'interrupted');return update(i,t=>{t.status='interrupted';t.trace.push({kind:'session-interruption',at:clock()});t.telemetry.controllerMs+=performance.now()-start;});}
      // Replayable local tool absence or stale state; nothing outside this trial
      // changes, and a policy must explicitly choose recovery to continue.
      if(kind==='stale-state')await writeFixed(dir,'external-state.json',canonical({revision:0,expectedRevision:1}));
      await update(i,t=>{t.steps++;t.trace.push({kind,source:'independent-local-observer',at:clock()});});
      t=readTrial(i).t;decision=decideResearchPolicy({policy:t.manifest.policy,components:t.manifest.components,limits:t.manifest.limits,observation:{kind},step:t.steps});
      await update(i,t=>{t.trace.push({kind:'policy',decision,at:clock()});});
      if(!['retry','refresh'].includes(decision.action)||t.manifest.limits.maxRetries<1)return update(i,t=>{t.status='FAILED';t.failure='RECOVERY_NOT_ALLOWED';t.telemetry.errors++;t.telemetry.controllerMs+=performance.now()-start;});
      if(kind==='stale-state')await writeFixed(dir,'external-state.json',canonical({revision:1,expectedRevision:1}));
      await update(i,t=>{t.telemetry.retries++;t.telemetry.errors++;});
    }
    t=readTrial(i).t;
    if(t.stopRequested||suspended||closed)return update(i,t=>{t.status='stopped';});
    if(t.steps>=t.manifest.limits.maxSteps||clock()>=t.deadlineAt)return update(i,t=>{t.status='LIMIT_REACHED';t.failure='STEP_OR_TIME_LIMIT';});
    const toolStart=performance.now();
    await adapter.execute({dir,limits:t.manifest.limits,signal:AbortSignal.timeout(t.manifest.limits.maxMs)});
    const toolMs=performance.now()-toolStart;
    await update(i,t=>{t.steps++;t.telemetry.tools++;t.telemetry.toolMs+=toolMs;t.telemetry.controllerMs+=Math.max(0,performance.now()-start-toolMs);t.trace.push({kind:'tool',name:'fixed-node-file-transform',status:'completed',at:clock()});});
    await checkpoint(i,dir,'executed');
    if(clock()>=readTrial(i).t.deadlineAt)return update(i,t=>{t.status='LIMIT_REACHED';t.failure='TIME_LIMIT';});
    if(readTrial(i).t.stopRequested)return update(i,t=>{t.status='stopped';});
    return validateLocal(i,dir);
  }
  async function validateLocal(i,knownDir){
    const {t,e,adapter}=readTrial(i);if(!t.prepared||!t.checkpoint)fail('RESEARCH_EVIDENCE','No actual prepared/executed artifact',409);
    const dir=knownDir??await trialDirectory(dataDir,t.id);await verifyCheckpoint(t,dir);
    const begin=performance.now();let result;
    try{result=await adapter.validate({dir,split:e.config.split,seed:t.manifest.seed,limits:t.manifest.limits,inputDigest:t.prepared.inputDigest});}
    catch(error){result={status:'FAILED',checks:[{kind:'artifact',passed:false,validator:'bounded-file/1',code:error.code??'MISSING_OR_INVALID_FILE'}],artifact:null};}
    if(t.manifest.fault==='stale-state'){const actual=await readFixed(dir,'external-state.json',t.manifest.limits.maxBytes);const passed=canonical(JSON.parse(actual.bytes))===canonical({revision:1,expectedRevision:1});result.checks.push({kind:'external-state',validator:'trial-external-state/1',passed,sha256:actual.sha256});if(!passed)result.status='FAILED';}
    return update(i,(t,s)=>{const evidence=append(s,'evidence',{trialId:t.id,manifestDigest:t.manifestDigest,dataset:t.manifest.dataset,status:result.status,checks:result.checks,artifact:result.artifact,qualification:result.qualification??null,independent:true,validatorVersion:'forge-independent/1',at:clock()},t.projectId,clock);evidence.digest=digest({...evidence,digest:undefined});t.evidenceId=evidence.id;t.status=result.status;t.telemetry.validatorMs+=performance.now()-begin;t.completedAt=clock();t.trace.push({kind:'outcome',status:result.status,evidenceId:evidence.id,at:clock()});});
  }
  function canonicalRun(t,s){
    const r=s.runs.find(r=>r.operationId===t.runOperationId&&r.projectId===t.projectId);
    const expected=buildResearchContext(s,{projectId:t.projectId,trialId:t.id});
    const receipt=r?.researchReceipt,context=s.events.find(e=>e.id===r?.contextId&&e.projectId===t.projectId&&e.runId===r?.id&&['context.version','context.passthrough'].includes(e.type));
    if(!r||r.id!==t.runId&&t.runId||r.taskId!==t.manifest.taskId||r.workspaceContext?.workspaceId!==t.manifest.workspaceId||digest(r.researchContext??null)!==digest(expected)||receipt?.researchContextDigest!==digest(expected)||receipt?.workspaceId!==t.manifest.workspaceId||receipt?.contextPolicyDigest!==t.manifest.contextPolicyDigest||receipt?.forgeContextId!==r.contextId||!context||r.contextReceipt?.eventId!==context.id||receipt?.forgeReceiptDigest!==digest(r.contextReceipt??null))fail('RESEARCH_CONTEXT_RECEIPT','Canonical T3 run and exact context receipt required; reconcile without redispatch',409);
    if(t.manifest.contextPolicy.mode==='forge-prefix'&&context.policyId!==t.manifest.contextPolicy.policy.id||t.manifest.contextPolicy.mode==='native-managed'&&context.type!=='context.passthrough')fail('RESEARCH_CONTEXT_RECEIPT','Actual context does not match declared policy',409);
    return r;
  }
  async function reconcileAgent(i,caller){
    let {t}=readTrial(i);if(!supported())fail('RESEARCH_OWNER_INTEGRATION','Existing execution owner is not integrated',409);
    // Never re-submit on an unknown response, even when no run is visible yet.
    await executionOwner.reconcile({projectId:i.projectId,trialId:t.id,workspaceId:t.manifest.workspaceId,runOperationId:t.runOperationId,runId:t.runId??null},caller);
    if(records(store.read(),'composition',i.projectId).some(c=>c.trialId===t.id))return syncComposition(i,caller);
    const s=store.read();t=trial(s,i);const r=canonicalRun(t,s);
    const telemetry=await executionOwner.telemetry({projectId:i.projectId,runId:r.id,attemptId:r.attemptId},caller);
    const usage={tokens:telemetry?.tokens??null,cost:telemetry?.cost??null};for(const k of ['tokens','cost'])if(usage[k]!==null&&(!Number.isFinite(usage[k])||usage[k]<0))fail('RESEARCH_TELEMETRY','Invalid owner accounting',409);
    const context=s.events.find(e=>e.id===r.contextId),memoryRefs=(context.memoryGroups??[]).flatMap(g=>g.refs??[]),activeMemory=(context.active??[]).filter(x=>x.memory===true);
    if(!t.manifest.components.memory&&(memoryRefs.length||activeMemory.length))fail('RESEARCH_COMPONENT_MISMATCH','Memory-off ablation received FORGE memory',409);
    const componentReceipts={memory:{requested:t.manifest.components.memory,status:!t.manifest.components.memory?'DISABLED':memoryRefs.length&&activeMemory.length?'APPLIED':'NEEDS_SETUP',contextId:r.contextId,selectedCount:activeMemory.length},skills:{requested:t.manifest.components.skills,status:'OWNER_RECEIPTS_REQUIRED'},staffing:{requested:t.manifest.components.staffing,status:'OWNER_RECEIPTS_REQUIRED'},adaptation:{requested:t.manifest.components.adaptation,status:'POLICY_REQUEST_ONLY'},verification:{requested:t.manifest.components.verification,status:'FINAL_INDEPENDENT_CHECK_ALWAYS_REQUIRED'}};
    return update(i,t=>{t.runId=r.id;t.attemptId=r.attemptId;t.componentReceipts=componentReceipts;t.componentQualification='COMPONENT_EFFECTS_UNQUALIFIED_UNTIL_OWNER_RECEIPTS';t.telemetry={...t.telemetry,...usage,currency:typeof telemetry?.currency==='string'?telemetry.currency:null,source:'canonical-execution-owner',providerExecution:r.fixture??'CANONICAL_T3',memory:{status:componentReceipts.memory.status,selectedCount:activeMemory.length}};t.status=t.stopRequested?(terminalRunStatuses.has(r.status)?'stopped':'stopping'):r.status==='completed'?'awaiting-validation':terminalRunStatuses.has(r.status)?'FAILED':'running';});
  }
  async function syncComposition(i,caller){
    if(typeof executionOwner?.exportComposition!=='function')fail('RESEARCH_COMPONENT_UNAVAILABLE','Canonical cohort export verification required',409);
    const exported=await executionOwner.exportComposition({projectId:i.projectId,trialId:i.trialId},caller),c=exported.data;
    if(exported.format!=='forge-research-components-json/1'||exported.sha256!==digest(c)||c.composition.trialId!==i.trialId)fail('RESEARCH_COMPONENT_INTEGRITY','Exact cohort result required',409);
    return update(i,(t,s)=>{
      if(c.composition.manifestDigest!==t.manifestDigest)fail('RESEARCH_COMPONENT_INTEGRITY','Cohort manifest changed',409);
      const primary=c.attempts.find(a=>a.allocation.role==='primary')?.run,effective=c.attempts.filter(a=>a.allocation.role!=='helper').at(-1);
      const consumption=records(s,'component-consumption',i.projectId).filter(p=>p.compositionId===c.composition.id&&c.attempts.some(a=>a.run?.id===p.runId&&a.run?.attemptId===p.attemptId));
      const memories=c.attempts.map(a=>s.events.find(e=>e.id===a.run?.contextId)).filter(Boolean),memoryCount=memories.reduce((n,e)=>n+(e.active??[]).filter(x=>x.memory===true).length,0);
      const flags=t.manifest.components;
      t.runId=primary?.id??t.runId;t.attemptId=primary?.attemptId??t.attemptId;
      t.cohort={compositionId:c.composition.id,status:c.status,runIds:c.attempts.map(a=>a.run?.id).filter(Boolean),evidenceIds:c.attempts.map(a=>a.evidence?.id).filter(Boolean),exportSha256:exported.sha256,effectiveRunId:effective?.run?.id??null};
      t.evidenceId=c.effectiveEvidence?.id??null;
      t.componentReceipts={memory:{requested:flags.memory,status:!flags.memory?'DISABLED':memoryCount?'APPLIED':'NEEDS_SETUP',selectedCount:memoryCount},skills:{requested:flags.skills,status:!flags.skills?'DISABLED':consumption.length&&consumption.every(p=>p.skills.length)?'APPLIED':'OWNER_RECEIPTS_REQUIRED',receiptIds:consumption.map(p=>p.id)},staffing:{requested:flags.staffing,status:!flags.staffing?'DISABLED':c.attempts.some(a=>a.allocation.role==='helper'&&a.run)?'APPLIED':'ALLOCATION_PENDING'},adaptation:{requested:flags.adaptation,status:!flags.adaptation?'DISABLED':c.attempts.some(a=>a.run&&(a.allocation.role==='revision'||a.allocation.feedback?.reason==='initial-capability-qualified-route'))?'APPLIED':'NO_ADAPTATION_OBSERVED'},verification:{requested:flags.verification,status:c.attempts.some(a=>a.evidence)?'INDEPENDENT_EVIDENCE_RETAINED':'EVIDENCE_PENDING'}};
      t.componentQualification='CANONICAL_OWNER_RECEIPTS; native enforcement remains exact-run bound';
      t.telemetry={...t.telemetry,tokens:c.usage.tokens,cost:c.usage.cost,currency:c.usage.currency,controllerMs:c.usage.controller.elapsedMs,source:'canonical-cohort-owner-observations'};
      t.status=['PASSED','FAILED','stopped','stopping','reconcile-required','awaiting-validation'].includes(c.status)?c.status:'running';
      if(['PASSED','FAILED'].includes(t.status))t.completedAt=clock();
    });
  }
  const api={
    async state(input,caller){await identity('state',input,caller);const s=store.read();return {projectId:input.projectId,experiments:records(s,'experiment',input.projectId),trials:records(s,'trial',input.projectId),evidence:records(s,'evidence',input.projectId),operations:records(s,'operation',input.projectId).map(({input,...o})=>o),catalog:registry.list(),sources:RESEARCH_SOURCES,limits:LIMITS,policies:POLICIES,components:COMPONENTS,faults:FAULTS,defaultConfig:defaultResearchConfig(),policyInterfaces:FUTURE_POLICY_INTERFACES,capabilities:{agentExecution:supported()&&executionOwner.nativeQualificationAvailable!==false,agentBridgeIntegrated:supported(),nativeQualification:executionOwner?.nativeQualificationAvailable===false?'UNAVAILABLE':'PER_TRIAL_REQUIRED',localExecution:true,osSandbox:false,training:false},suspended};},
    create(input,caller){return track(mutate('create',input,caller,i=>store.transaction(s=>{const config=normalizeConfig(i.config,registry);return append(s,'experiment',{version:1,config,configDigest:digest(config),qualification:'CONFIGURATION_ONLY',approvedBy:'authenticated-local-owner',environment:{node:process.version,platform:process.platform,arch:process.arch,executor:'forge-fixed-node/1'},immutable:true},i.projectId,clock);})));},
    reserve(input,caller){return track(mutate('reserve',input,caller,async i=>{
      const s=store.read(),e=verifyExperiment(record(s,'experiment',i.experimentId,i.projectId)),c=e.config;
      integer(i.repetition,'repetition',0,c.repetitions-1);integer(i.policyIndex,'policyIndex',0,c.policies.length-1);integer(i.ablationIndex,'ablationIndex',0,c.ablations.length-1);
      if(c.execution==='agent'){
        if(!supported())fail('RESEARCH_OWNER_INTEGRATION','Existing Workspace/T3 owner must support research context and independent validation',409);
        text(i.workspaceId,'workspaceId');text(i.taskId,'taskId');
      }else if(i.workspaceId||i.taskId)fail('RESEARCH_SCHEMA','Local fixtures use only their managed trial directory');
      return store.transaction(s=>{
        const e=verifyExperiment(record(s,'experiment',i.experimentId,i.projectId));
        if(records(s,'trial',i.projectId).some(t=>t.manifest.experimentId===e.id&&t.manifest.repetition===i.repetition&&t.manifest.policyIndex===i.policyIndex&&t.manifest.ablationIndex===i.ablationIndex))fail('RESEARCH_DUPLICATE_TRIAL','This immutable matrix cell is already reserved; use its retained trial',409);
        let w;
        if(c.execution==='agent'){
          w=s.events.find(w=>w.type==='workspace.workspace'&&w.projectId===i.projectId&&w.id===i.workspaceId);
          if(!w||w.taskId!==i.taskId||w.status!=='ready'||w.runOperationId||w.restoreReviewRequired||w.stopRequested)fail('RESEARCH_WORKSPACE','Choose an unused ready canonical isolated workspace',409);
          if(records(s,'trial').some(t=>t.manifest.workspaceId===w.id))fail('RESEARCH_WORKSPACE','Each trial requires a distinct workspace',409);
          // Pre-dispatch caps use authorized owner observations, never model claims.
          const previous=records(s,'trial',i.projectId).filter(t=>t.manifest.experimentId===e.id&&t.manifest.execution==='agent');
          if(previous.length)assertOwnerUsage({tokens:previous.some(t=>t.telemetry.tokens===null)?null:previous.reduce((n,t)=>n+t.telemetry.tokens,0),cost:previous.some(t=>t.telemetry.cost===null)?null:previous.reduce((n,t)=>n+t.telemetry.cost,0)},c.limits);
        }
        const components=c.ablations[i.ablationIndex].components,contextPolicy=w?researchContextPolicy(s,{projectId:i.projectId,components}):null;
        if(w&&components.memory&&!contextPolicy.policy)fail('RESEARCH_COMPONENT_UNAVAILABLE','Memory retrieval needs an actual FORGE context policy; native passthrough appends no memory',409);
        const manifest={version:1,projectId:i.projectId,experimentId:e.id,configDigest:e.configDigest,execution:c.execution,adapter:c.adapter,adapterPin:c.adapterPin,dataset:c.dataset,seed:c.seed+i.repetition,repetition:i.repetition,policyIndex:i.policyIndex,ablationIndex:i.ablationIndex,policy:c.policies[i.policyIndex],policyVersion:POLICY_VERSION,ablation:c.ablations[i.ablationIndex].name,components,security:c.security,limits:c.limits,fault:c.fault,workspaceId:w?.id??null,workspaceBase:w?.baseSha??null,taskId:i.taskId??null,contextPolicy,contextPolicyDigest:contextPolicy?digest(contextPolicy):null};
        const t=append(s,'trial',{manifest,manifestDigest:digest(manifest),status:'reserved',steps:0,trace:[],stopRequested:false,restoreReviewRequired:false,deadlineAt:null,componentQualification:c.execution==='local'?'POLICY_SWITCH_FIXTURE_ONLY_NO_MEMORY_SKILL_OR_STAFFING_EFFECT':'OWNER_RECEIPTS_REQUIRED',telemetry:{tokens:null,cost:null,currency:null,controllerMs:0,toolMs:0,validatorMs:0,tools:0,errors:0,retries:0,source:'local-controller',providerExecution:'NONE',memory:null}},i.projectId,clock);
        t.runOperationId=w?`workspace-run:${w.id}`:null;return t;
      });
    }));},
    execute(input,caller){return track(mutate('execute',input,caller,async i=>{
      let {t}=readTrial(i);revision(t,i.expectedRevision);
      if(t.manifest.execution==='local')return localExecution(i);
      if(!supported())fail('RESEARCH_OWNER_INTEGRATION','Existing owner integration required',409);
      if(t.status!=='reserved'||t.stopRequested||t.restoreReviewRequired)fail('RESEARCH_STATE','Trial is no longer admissible',409);
      await update(i,t=>{t.status='dispatching';const startedAt=clock();t.startedAt=startedAt;t.deadlineAt=startedAt+t.manifest.limits.maxMs;t.dispatchAcknowledged=true;});
      try{const context=buildResearchContext(store.read(),{projectId:i.projectId,trialId:t.id});await executionOwner.dispatch({projectId:i.projectId,trialId:t.id,experimentId:t.manifest.experimentId,taskId:t.manifest.taskId,workspaceId:t.manifest.workspaceId,runOperationId:t.runOperationId,researchContext:context,policy:decideResearchPolicy({policy:t.manifest.policy,components:t.manifest.components,limits:t.manifest.limits,step:0})},caller);return await reconcileAgent(i,caller);}
      catch(error){return update(i,t=>{t.status='reconcile-required';t.error={code:error.code??'OUTCOME_UNKNOWN',message:redact(String(error.message)).slice(0,2000)};});}
    }));},
    reconcile(input,caller){return track(mutate('reconcile',input,caller,async i=>{
      const {t}=readTrial(i);revision(t,i.expectedRevision);
      if(t.manifest.execution==='agent')return reconcileAgent(i,caller);
      if(t.stopRequested)return update(i,t=>{t.status='stopped';});
      const dir=await trialDirectory(dataDir,t.id);const cp=await verifyCheckpoint(t,dir);
      if(cp.phase==='executed')return validateLocal(i,dir);
      // Explicit continuation only; replay never creates another trial/effect.
      if(!['interrupted','reconcile-required'].includes(t.status))fail('RESEARCH_STATE','No interrupted checkpoint to resume',409);
      await update(i,t=>{t.status='interrupted';});return localExecution(i);
    }));},
    validate(input,caller){return track(mutate('validate',input,caller,async i=>{
      const {t}=readTrial(i);revision(t,i.expectedRevision);
      if(t.manifest.execution==='local')return validateLocal(i);
      if(!supported()||!['awaiting-validation','PASSED','FAILED'].includes(t.status))fail('RESEARCH_EVIDENCE','Completed owned run required for independent validation',409);
      if(records(store.read(),'composition',i.projectId).some(c=>c.trialId===t.id)){
        const cohort=await executionOwner.cohortState({projectId:i.projectId,trialId:t.id},caller);
        for(const a of cohort.attempts.filter(a=>a.run?.status==='completed'))await executionOwner.validate({projectId:i.projectId,trialId:t.id,runId:a.run.id,attemptId:a.run.attemptId,manifestDigest:t.manifestDigest,dataset:t.manifest.dataset},caller);
        return syncComposition(i,caller);
      }
      const r=canonicalRun(t,store.read());
      const result=await executionOwner.validate({projectId:i.projectId,runId:r.id,attemptId:r.attemptId,trialId:t.id,manifestDigest:t.manifestDigest,dataset:t.manifest.dataset},caller);
      // The owner returns a canonical evidence ID, never a success boolean.
      return update(i,(t,s)=>{const evidence=s.events.find(e=>e.id===result?.evidenceId&&e.type==='research.evidence'&&e.projectId===i.projectId&&e.trialId===t.id&&e.manifestDigest===t.manifestDigest&&e.independent===true&&e.runId===r.id&&e.attemptId===r.attemptId);if(!evidence||!evidence.checks?.length||!evidence.checks.some(c=>['artifact','held-out','external-state','deterministic'].includes(c.kind))||digest({...evidence,digest:undefined})!==evidence.digest)fail('RESEARCH_EVIDENCE','Canonical independent evidence for exact run required',409);t.evidenceId=evidence.id;t.status=evidence.status==='PASSED'&&evidence.checks.every(c=>c.passed===true)?'PASSED':'FAILED';});
    }));},
    stop(input,caller){return track(mutate('stop',input,caller,async i=>{
      const {t}=readTrial(i);revision(t,i.expectedRevision);
      await update(i,t=>{t.stopRequested=true;t.status=t.manifest.execution==='local'||!t.dispatchAcknowledged?'stopped':'stopping';});
      if(t.manifest.execution==='agent'&&t.dispatchAcknowledged){if(!supported())return update(i,t=>{t.status='reconcile-required';});await executionOwner.stop({projectId:i.projectId,trialId:t.id,workspaceId:t.manifest.workspaceId,runOperationId:t.runOperationId,runId:t.runId??null},caller);return reconcileAgent(i,caller);}return trial(store.read(),i);
    }));},
    async compare(input,caller){await identity('compare',input,caller);return compareResearch(store.read(),input.projectId,input.experimentIds);},
    async syncComposition(input,caller){await identity('cohort-state',input,caller);if(closed||suspended)fail('RESEARCH_SUSPENDED','Research is suspended',409);return syncComposition(input,caller);},
    async export(input,caller){await identity('export',input,caller);const s=store.read(),e=verifyExperiment(record(s,'experiment',input.experimentId,input.projectId));const trials=records(s,'trial',input.projectId).filter(t=>t.manifest.experimentId===e.id);for(const t of trials)verifyTrial(t,e);const evidence=records(s,'evidence',input.projectId).filter(e=>trials.some(t=>t.id===e.trialId));for(const ev of evidence)if(digest({...ev,digest:undefined})!==ev.digest)fail('RESEARCH_EVIDENCE','Evidence digest changed',409);const data={version:1,experiment:e,trials,evidence,sources:RESEARCH_SOURCES,policyInterfaces:FUTURE_POLICY_INTERFACES,comparison:compareResearch(s,input.projectId,[e.id]),qualification:'Engineering fixture evidence only; no measured research improvement or official benchmark result',exportedAt:clock()};return {format:'forge-research-json/1',data,sha256:digest(data)};},
    async recover(){return store.transaction(s=>{for(const t of records(s,'trial'))if(['dispatching','running','stopping'].includes(t.status)){t.status='reconcile-required';t.revision++;}for(const o of records(s,'operation'))if(o.status==='pending'){o.status='reconcile-required';o.revision++;}});},
    async suspendForRestore(){suspended=true;await Promise.allSettled([...pending]);const active=records(store.read(),'trial').filter(activeTrial);if(active.length)fail('RESEARCH_RESTORE_BUSY','Stop and reconcile reserved research trials before restore',409);},
    async afterRestore(){await api.recover();suspended=false;},
    cancelRestore(){if(!closed)suspended=false;},
    async close(){closed=true;suspended=true;await Promise.allSettled([...pending]);},
  };
  return api;
}

export function compareResearch(state,projectId,experimentIds){
  if(!Array.isArray(experimentIds)||!experimentIds.length||experimentIds.length>8)fail('RESEARCH_LIMIT','Compare 1–8 experiments');
  const experiments=experimentIds.map(id=>verifyExperiment(record(state,'experiment',id,projectId))),groups=new Map();
  for(const t of records(state,'trial',projectId).filter(t=>experimentIds.includes(t.manifest.experimentId))){
    const e=experiments.find(e=>e.id===t.manifest.experimentId);verifyTrial(t,e);
    const m=t.manifest,key=canonical({experimentId:e.id,policy:m.policy,ablation:m.ablation,split:m.dataset.split});
    if(!groups.has(key))groups.set(key,{experimentId:e.id,policy:m.policy,ablation:m.ablation,components:m.components,split:m.dataset.split,trials:0,passed:0,failed:0,pending:0,tokens:0,cost:0,unknownTokens:0,unknownCost:0,currencies:[],componentQualifications:[],controllerMs:0,toolMs:0,validatorMs:0});
    const g=groups.get(key);g.trials++;g[t.status==='PASSED'?'passed':t.status==='FAILED'?'failed':'pending']++;
    if(t.status==='PASSED'){
      const evidence=record(state,'evidence',t.evidenceId,projectId);
      if(evidence.status!=='PASSED'||!evidence.independent||evidence.trialId!==t.id||evidence.manifestDigest!==t.manifestDigest||digest({...evidence,digest:undefined})!==evidence.digest)fail('RESEARCH_EVIDENCE','Comparison requires intact independent evidence',409);
    }
    for(const k of ['tokens','cost'])if(t.telemetry[k]===null)g[k==='tokens'?'unknownTokens':'unknownCost']++;else g[k]+=t.telemetry[k];
    if(t.telemetry.cost!==null&&!g.currencies.includes(t.telemetry.currency))g.currencies.push(t.telemetry.currency);
    if(!g.componentQualifications.includes(t.componentQualification))g.componentQualifications.push(t.componentQualification);
    for(const k of ['controllerMs','toolMs','validatorMs'])g[k]+=t.telemetry[k];
  }
  const sameProtocol=experiments.every(e=>canonical({adapter:e.config.adapter,dataset:e.config.dataset,seed:e.config.seed,repetitions:e.config.repetitions,limits:e.config.limits,fault:e.config.fault,execution:e.config.execution})===canonical({adapter:experiments[0].config.adapter,dataset:experiments[0].config.dataset,seed:experiments[0].config.seed,repetitions:experiments[0].config.repetitions,limits:experiments[0].config.limits,fault:experiments[0].config.fault,execution:experiments[0].config.execution}));
  return {version:1,comparable:sameProtocol,groups:[...groups.values()].map(g=>({...g,tokens:g.unknownTokens?null:g.tokens,cost:g.unknownCost||g.currencies.length!==1||g.currencies[0]===null?null:g.cost,passRate:g.trials?g.passed/g.trials:null})),interpretation:sameProtocol?'Descriptive recorded engineering observations; small fixture counts establish no research superiority. Recheck evidence to inspect current artifact bytes.':'Protocol/split/resource settings differ; no paired causal comparison'};
}
