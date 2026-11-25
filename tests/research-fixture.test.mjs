import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../app/server/store.mjs';
import {createResearchService,defaultResearchConfig,digest,buildResearchContext,admitResearchTrial} from '../app/research/index.mjs';
export async function fixture(t,{executionOwner,clock}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-research-fixture-'));let store=await openStore(dir),service;
  const owner=Object.freeze({}),p={id:randomUUID(),name:'Disposable CPU engineering project',revision:1,profile:{provider:{instanceId:'injected-t3',model:'fixture-only'}}},q={...p,id:randomUUID()};
  await store.transaction(s=>{s.projects.push(p,q);});
  const make=()=>service=createResearchService({store,dataDir:dir,executionOwner:typeof executionOwner==='function'?executionOwner(()=>store):executionOwner,authorizeOwner:(_r,c)=>c===owner?{kind:'human',role:'owner',subject:'isolated-engineering-fixture'}:null,...(clock?{clock}:{})});make();
  t.after(async()=>{await service.close();await store.close();});
  const f={dir,p,q,owner,get store(){return store;},get service(){return service;},input(extra={}){return {projectId:p.id,operationId:randomUUID(),...extra};},config(patch={}){return {...defaultResearchConfig(),policies:['rule-adapt'],repetitions:2,...patch};},
    async create(patch={}){return service.create(f.input({config:f.config(patch)}),owner);},
    async reserve(e,extra={}){return service.reserve(f.input({experimentId:e.id,repetition:0,policyIndex:0,ablationIndex:0,...extra}),owner);},
    trial(id){return store.read().events.find(e=>e.id===(id.id??id));},
    async call(method,t,extra={}){t=f.trial(t);return service[method](f.input({trialId:t.id,expectedRevision:t.revision,...extra}),owner);},
    async restart(){await service.close();await store.close();store=await openStore(dir);make();await service.recover();},
  };return f;
}
// Deliberately injected T3 lifecycle. SQLite, context/evidence binding and file
// validators remain real; this fixture does not call any provider or account.
export function injectedOwner(storeFor,{loseResponse=false,omitReceipt=false}={}){
  const counters={dispatch:0,reconcile:0,stop:0};
  return {version:1,counters,
    async dispatch(input){counters.dispatch++;const store=storeFor();await store.transaction(s=>{
      admitResearchTrial(s,{projectId:input.projectId,taskId:input.taskId,operationId:input.runOperationId,workspaceContext:{workspaceId:input.workspaceId},researchContext:input.researchContext});
      const trial=s.events.find(t=>t.id===input.trialId),prefix=trial.manifest.contextPolicy.mode==='forge-prefix';
      const id=randomUUID(),contextId=randomUUID(),contextReceipt=prefix?{eventId:contextId,type:'context.version',sourceVersionId:null}:{eventId:contextId,type:'context.passthrough',mode:'native-managed',reason:'NO_FORGE_CONTEXT_POLICY'};
      s.events.push({id:contextId,revision:1,type:contextReceipt.type,projectId:input.projectId,runId:id,policyId:trial.manifest.contextPolicy.policy?.id??null,memoryGroups:[],active:[]});
      s.runs.push({id,projectId:input.projectId,taskId:input.taskId,attemptId:randomUUID(),operationId:input.runOperationId,status:'completed',fixture:'INJECTED_T3_NOT_LIVE',workspaceContext:{workspaceId:input.workspaceId},researchContext:input.researchContext,contextId,contextReceipt,...(omitReceipt?{}:{researchReceipt:{researchContextDigest:digest(input.researchContext),workspaceId:input.workspaceId,contextPolicyDigest:input.researchContext.contextPolicyDigest,forgeContextId:contextId,forgeReceiptDigest:digest(contextReceipt)}})});
    });if(loseResponse)throw new Error('INJECTED_T3 response lost after acceptance');},
    async reconcile(){counters.reconcile++;},async stop(){counters.stop++;},async telemetry(){return {tokens:null,cost:null};},
    async validate(input){const store=storeFor();return store.transaction(s=>{const e={id:randomUUID(),type:'research.evidence',projectId:input.projectId,trialId:input.trialId,manifestDigest:input.manifestDigest,runId:input.runId,attemptId:input.attemptId,independent:true,status:'PASSED',checks:[{kind:'artifact',passed:true,validator:'INJECTED_INDEPENDENT_OWNER_FIXTURE_NOT_LIVE'}]};e.digest=digest(e);s.events.push(e);return {evidenceId:e.id};});},
  };
}
