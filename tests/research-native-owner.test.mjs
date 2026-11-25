// Injected private observations ONLY. These tests cannot qualify a live runtime.
// Canonical manifests, actual Git worktree, SQLite and file operations are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,link} from 'node:fs/promises';
import {fixture} from './workspaces-fixture.test.mjs';
import {createResearchService,defaultResearchConfig,buildResearchContext} from '../app/research/index.mjs';
import {createResearchNativeOwner} from '../app/research-native/owner.mjs';
import {precreateResearchOutput} from '../app/research-native/output.mjs';
import {digest} from '../app/research/contracts.mjs';
import {createResearchRoute} from '../app/server/research-route.mjs';
import {contextFor} from '../app/workspaces/contracts.mjs';
import {validateWorkspaceContext} from '../app/workspaces/context.mjs';

test('Research private native owner: canonical resource and identity fences',async t=>{
  const f=await fixture(t);await f.configure();const w=await f.create();
  const injectedOwner={version:1,...Object.fromEntries(['dispatch','reconcile','stop','telemetry','validate'].map(k=>[k,()=>{throw new Error('INJECTED_OWNER_NOT_EXECUTABLE');}]))};
  const service=createResearchService({store:f.store,dataDir:f.dataDir,executionOwner:injectedOwner,authorizeOwner:async()=>({kind:'human',role:'owner'})});t.after(()=>service.close());
  const config={...defaultResearchConfig(),execution:'agent',repetitions:1,policies:['static'],ablations:[{name:'baseline',components:{memory:false,skills:false,adaptation:false,staffing:false,verification:false}}],limits:{...defaultResearchConfig().limits,maxMs:30000,maxSteps:3,maxRetries:0,maxAgents:2,unknownAccounting:'allow'}};
  const e=await service.create(f.input({config}),f.owner),trial=await service.reserve(f.input({experimentId:e.id,repetition:0,policyIndex:0,ablationIndex:0,workspaceId:w.id,taskId:w.taskId}),f.owner);
  const now=Date.now();
  await f.store.transaction(s=>{const t=s.events.find(x=>x.id===trial.id);t.startedAt=now;t.deadlineAt=now+30000;t.status='dispatching';});
  const before=f.store.read(),request0={version:1,projectId:f.p.id,trialId:trial.id,manifestDigest:trial.manifestDigest,workspaceId:w.id,taskId:w.taskId,runOperationId:trial.runOperationId,runId:null,attemptId:null,deadlineAt:now+30000,route:trial.manifest.contextPolicy.route,components:trial.manifest.components,limits:trial.manifest.limits};
  await f.call('start',w);
  await f.store.transaction(s=>{const r=s.runs.at(-1);r.threadId='thread';r.researchContext=buildResearchContext(s,{projectId:f.p.id,trialId:trial.id});});
  const base=f.store.read(),run=base.runs.at(-1),request={...request0,runId:run.id,attemptId:run.attemptId};
  const scope={paths:['output.json'],capabilities:['read','propose','workspace.write']};
  const route={providerInstanceId:request.route.providerId,modelId:request.route.modelId,accountGeneration:'INJECTED_NO_ACCOUNT',opencodeBinarySha256:'b'.repeat(64)};
  const profile={projectId:run.projectId,taskId:run.taskId,runId:run.id,threadId:run.threadId,route,scope:{...scope,maxBytes:config.limits.maxBytes},expiresAt:request.deadlineAt,contextDigest:'c'.repeat(64),manifestDigest:'d'.repeat(64),policyGeneration:'1',toolGeneration:'1'};
  const observed={route,scope,limits:{maxRunMs:30000,maxTokens:null,maxCost:null},policyGeneration:'1',toolGeneration:'1',routeProof:{projectId:run.projectId,taskId:run.taskId,expiresAt:now+60000,evidenceId:'INJECTED_NATIVE_PROOF_NOT_LIVE',mode:'mediated-actions',nativeActions:'guarded',normalizedActions:'guarded',scopeDigest:digest(scope)},profile,attestation:{profileDigest:digest(profile),contextDigest:profile.contextDigest,manifestDigest:profile.manifestDigest,binarySha256:route.opencodeBinarySha256,policyGeneration:'1',toolGeneration:'1',effects:0,negativeCount:17},phases:['openSession','ensureThread']};
  const setup=(state=structuredClone(base),obs=structuredClone(observed))=>{
    const owner=createResearchNativeOwner({clock:()=>now,observeGuarded:(_s,{run})=>({...obs,profile:run?obs.profile:null})});owner.retain(state,request);return {s:state,owner,obs,r:state.runs.at(-1)};
  };
  await t.test('exact null pre-reservation proof cannot qualify allocated run',()=>{
    const s=structuredClone(before),owner=createResearchNativeOwner({clock:()=>now,observeGuarded:()=>({...observed,profile:null})});
    assert.ok(owner.retain(s,request0));assert.ok(owner.qualification(s,request0));assert.equal(owner.qualification(s,request),null);
    assert.equal(JSON.stringify(s.events.filter(e=>e.type==='research.enforcement')).includes('INJECTED_NATIVE_PROOF_NOT_LIVE'),false);
    const pending=structuredClone(before),input={projectId:f.p.id,taskId:w.taskId,operationId:trial.runOperationId,workspaceContext:contextFor(w),researchContext:buildResearchContext(pending,{projectId:f.p.id,trialId:trial.id})};
    assert.throws(()=>validateWorkspaceContext(pending,{...input,preparing:true}),{code:'WORKSPACE_CONTEXT'});
    assert.ok(validateWorkspaceContext(pending,input,{preparing:true}));
    const route=createResearchRoute({store:f.store,dataDir:f.dataDir,clock:()=>now,policy:{observe:()=>observed,resolve:()=>{throw Error('No provider allowed in pending admission fixture');}},getGuarded:()=>({qualifyProactive:()=>observed.routeProof})});
    assert.ok(route.retainInput(pending,input),'initial real route contract can retain pending authority before Workspace reservation');
    assert.equal(pending.runs.length,0);void route.close();
  });
  await t.test('logical steps, actual egress attempts, one agent and unknown accounting',()=>{
    const {s,owner,r}=setup();
    owner.nativePhase(s,{run:r,body:{phase:'create',profileDigest:digest(profile)}});
    assert.throws(()=>owner.nativePhase(s,{run:r,body:{phase:'create',profileDigest:digest(profile)}}),{code:'RESEARCH_NATIVE_AGENT_LIMIT'});
    for(let i=0;i<3;i++){owner.nativePhase(s,{run:r,body:{phase:'model-request',profileDigest:digest(profile)}});owner.modelRequest(s,{run:r});}
    assert.throws(()=>owner.nativePhase(s,{run:r,body:{phase:'model-request',profileDigest:digest(profile)}}),{code:'RESEARCH_NATIVE_STEP_LIMIT'});
    assert.throws(()=>owner.modelRequest(s,{run:r}),{code:'RESEARCH_NATIVE_STEP_LIMIT'});
    const resources=owner.resourceSnapshot(s,request);assert.equal(resources.modelRequests,3);assert.equal(resources.nativePreparedRequests,3);assert.equal(resources.retries,0);assert.equal(resources.tokens,null);assert.equal(resources.cost,null);assert.equal(resources.finality,null);
  });
  await t.test('local unknown/completed operation ledger cannot be erased by canonical rollback',()=>{
    const {s,owner,r}=setup(),a={run:r,profile,operationId:'one',requestDigest:'a'.repeat(64),capability:'read',path:'output.json',priorOperations:[]};
    owner.reserveAction(s,a);owner.reserveAction(s,a);assert.equal(owner.resourceSnapshot(s,request).actions.length,1);
    assert.throws(()=>owner.reserveAction(s,{...a,requestDigest:'b'.repeat(64)}),{code:'RESEARCH_NATIVE_ACTION_COLLISION'});
    assert.throws(()=>owner.reserveAction(s,{...a,operationId:'second',priorOperations:[1,2,3].map(i=>({runId:r.id,operationId:'local'+i,status:i===1?'unknown':'completed',requestDigest:'c'.repeat(64)}))}),{code:'RESEARCH_NATIVE_ACTION_LIMIT'});
    assert.throws(()=>owner.reserveAction(s,{...a,priorOperations:undefined}),{code:'RESEARCH_NATIVE_DURABLE_ACTION_LEDGER_REQUIRED'});
  });
  await t.test('failed egress prevents all retry/restart grants',()=>{
    const {s,owner,r}=setup();owner.modelRequest(s,{run:r});owner.modelFailure(s,{run:r});assert.throws(()=>owner.modelRequest(s,{run:r}),{code:'RESEARCH_NATIVE_RETRY_DENIED'});
    const restarted=createResearchNativeOwner({clock:()=>now,observeGuarded:()=>observed});assert.equal(restarted.qualification(s,request),null);assert.throws(()=>restarted.retain(s,request),{code:'RESEARCH_NATIVE_RESTART_RECONCILE'});
  });
  await t.test('Stop/restore/account/policy/workspace/manifest/run/attempt/deadline drift deny',()=>{
    for(const mutate of [s=>s.runs.at(-1).stopRequest={},s=>s.runs.at(-1).attemptId='foreign',s=>s.runs.at(-1).workspaceContext.workspaceId='foreign',s=>s.events.find(e=>e.id===trial.id).restoreReviewRequired=true,s=>s.events.find(e=>e.id===trial.id).deadlineAt++,s=>s.events.find(e=>e.id===trial.id).manifest.seed++,s=>s.plans[0].approved=false,s=>s.tasks[0].title='changed canonical approval']){
      const {s,owner}=setup();mutate(s);assert.equal(owner.qualification(s,request),null);
    }
    for(const key of ['policyGeneration','toolGeneration']){const {s,owner,obs}=setup();obs[key]='rotated';assert.equal(owner.qualification(s,request),null);}
    const {s,owner,obs}=setup();obs.route.accountGeneration='rotated';assert.equal(owner.qualification(s,request),null);
  });
  await t.test('absent attestation cannot authorize a send or resource effect',()=>{
    const {s,owner,obs,r}=setup();obs.attestation=null;assert.throws(()=>owner.admit(s,{run:r,stage:'send'}),{code:'RESEARCH_NATIVE_ATTESTATION_REQUIRED'});assert.throws(()=>owner.modelRequest(s,{run:r}),{code:'RESEARCH_NATIVE_ATTESTATION_REQUIRED'});
  });
  await t.test('verified allocation resolver shares one global envelope across exact owned runs',async()=>{
    const helper=await f.create(1);await f.call('start',helper);
    await f.store.transaction(s=>{const r=s.runs.at(-1);r.threadId='helper-thread';r.researchContext=buildResearchContext(s,{projectId:f.p.id,trialId:trial.id});r.researchComponentContext={compositionId:'INJECTED_COMPOSITION_NOT_LIVE',allocationId:'helper'};s.runs[0].researchComponentContext={compositionId:'INJECTED_COMPOSITION_NOT_LIVE',allocationId:'primary'};});
    const s=f.store.read(),primary=s.runs[0],helperRun=s.runs[1],allocationIds=['primary','helper'];
    const owner=createResearchNativeOwner({clock:()=>now,
      resolveAllocation:(s,i)=>{const w=s.events.find(w=>w.id===i.workspaceId),trial=s.events.find(t=>t.id===i.trialId);return {composition:{id:'INJECTED_COMPOSITION_NOT_LIVE'},allocation:{id:w.id===helper.id?'helper':'primary',workspaceId:w.id,operationId:i.runOperationId},workspace:w,task:s.tasks.find(t=>t.id===w.taskId),trial,manifest:trial.manifest,envelope:{trialId:trial.id,manifestDigest:trial.manifestDigest,limits:trial.manifest.limits,deadlineAt:trial.deadlineAt,allocationCount:2,allocationIds}};},
      observeGuarded:(_s,{run})=>{const p={...profile,taskId:run.taskId,runId:run.id,threadId:run.threadId};return {...observed,profile:p,routeProof:{...observed.routeProof,taskId:run.taskId},attestation:{...observed.attestation,profileDigest:digest(p)}};},
    });
    const first=owner.requestForRun(s,primary),second=owner.requestForRun(s,helperRun);owner.retain(s,first);owner.retain(s,second);
    const pending=structuredClone(s);pending.runs=[];pending.events=pending.events.filter(e=>!e.type.startsWith('research.native-')&&e.type!=='research.enforcement');
    const pendingOwner=createResearchNativeOwner({clock:()=>now,resolveAllocation:(s,i)=>{const w=s.events.find(w=>w.id===i.workspaceId),trial=s.events.find(t=>t.id===i.trialId);return {composition:{id:'INJECTED_COMPOSITION_NOT_LIVE'},allocation:{id:w.id===helper.id?'helper':'primary',workspaceId:w.id,operationId:i.runOperationId},workspace:w,task:s.tasks.find(t=>t.id===w.taskId),trial,manifest:trial.manifest,envelope:{trialId:trial.id,manifestDigest:trial.manifestDigest,limits:trial.manifest.limits,deadlineAt:trial.deadlineAt,allocationCount:2,allocationIds}};},observeGuarded:(_s,{workspace})=>({...observed,profile:null,routeProof:{...observed.routeProof,taskId:workspace.taskId}})});
    const pendingFirst={...first,runId:null,attemptId:null},pendingSecond={...second,runId:null,attemptId:null};
    assert.ok(pendingOwner.retain(pending,pendingFirst));assert.ok(pendingOwner.retain(pending,pendingSecond));
    assert.ok(pendingOwner.qualification(pending,pendingFirst));assert.ok(pendingOwner.qualification(pending,pendingSecond));
    assert.equal(pending.events.filter(e=>e.type==='research.native-envelope').length,1);
    owner.modelRequest(s,{run:primary});owner.modelRequest(s,{run:helperRun});owner.modelRequest(s,{run:primary});assert.throws(()=>owner.modelRequest(s,{run:helperRun}),{code:'RESEARCH_NATIVE_STEP_LIMIT'});
    assert.equal(owner.resourceSnapshot(s,first).id,owner.resourceSnapshot(s,second).id);assert.equal(owner.resourceSnapshot(s,second).modelRequests,3);
    assert.equal(s.events.filter(e=>e.type==='research.native-envelope').length,1);
    const parentFixture=f.store.read();
    try{
      await f.store.transaction(current=>Object.assign(current,s));
      const helperOutput=await precreateResearchOutput({store:f.store,dataDir:f.dataDir,runId:helperRun.id,clock:()=>now,admit:(state,detail)=>owner.admit(state,detail)});
      assert.equal(helperOutput.path,path.join(helper.worktreePath,'output.json'));assert.equal(await readFile(helperOutput.path,'utf8'),'');
      await assert.rejects(readFile(path.join(w.worktreePath,'output.json')),{code:'ENOENT'});
    }finally{await f.store.transaction(current=>Object.assign(current,parentFixture));}
    allocationIds[1]='foreign';assert.equal(owner.qualification(s,second),null);
  });
  await t.test('fixed output is created once in actual owned registered pristine worktree',async()=>{
    const owner=createResearchNativeOwner({clock:()=>now,observeGuarded:()=>observed});await f.store.transaction(s=>owner.retain(s,request));
    const args={store:f.store,dataDir:f.dataDir,runId:run.id,clock:()=>now,admit:(s,d)=>owner.admit(s,d)};
    const created=await precreateResearchOutput(args);assert.equal(created.path,path.join(w.worktreePath,'output.json'));assert.equal(await readFile(created.path,'utf8'),'');assert.equal((await precreateResearchOutput(args)).replayed,true);
    await writeFile(created.path,'changed');await assert.rejects(precreateResearchOutput(args),{code:'RESEARCH_NATIVE_OUTPUT_CHANGED'});
    await writeFile(created.path,'');await link(created.path,path.join(w.worktreePath,'linked-output.json'));await assert.rejects(precreateResearchOutput(args),{code:'RESEARCH_NATIVE_OUTPUT_CHANGED'});
  });
});
