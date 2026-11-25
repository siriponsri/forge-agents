// Actual production Owner/session/CSRF API and fixed local CPU/files; no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../app/server/main.mjs';
import {command} from '../app/server/domain.mjs';
import {digest,createResearchService,defaultResearchConfig,buildResearchContext} from '../app/research/index.mjs';
import {fixture as workspaceFixture} from './workspaces-fixture.test.mjs';
import {createT3Service} from '../app/server/t3.mjs';
import {createContextService} from '../app/context/index.mjs';
import {createT3ContextSeam} from '../app/context/pre-dispatch.mjs';

test('production Research Owner API executes fixed local trials, retains evidence through restore, and never starts a provider',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-product-research-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const p=(await command(app.store,{operationId:crypto.randomUUID(),type:'project.create',data:{name:'Local research qualification',workspace:path.join(dir,'workspace')}})).entity;
  let turns=0;app.t3.startRun=async()=>{turns++;throw Error('No provider in this local fixture');};
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
  const post=async(route,input,authenticated=true)=>{const response=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Cookie:cookie,'X-Forge-CSRF':csrf}:{})},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
  const call=async(method,input={})=>{const response=await post('/api/research/'+method,{projectId:p.id,...input});assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
  assert.equal((await post('/api/research/state',{projectId:p.id},false)).status,403);
  for(const method of ['recover','close','prepare','__proto__'])assert.equal((await post('/api/research/'+method,{projectId:p.id})).status,404);
  const initial=await call('state');assert.equal(initial.capabilities.agentExecution,false);
  const backup=(await post('/api/storage/backup',{})).data;
  const config={...initial.defaultConfig,repetitions:1,policies:['static']},creation={operationId:crypto.randomUUID(),config};
  const experiment=await call('create',creation);assert.equal((await call('create',creation)).id,experiment.id);
  assert.equal((await post('/api/research/reserve',{projectId:p.id,operationId:crypto.randomUUID(),experimentId:experiment.id,repetition:0,policyIndex:0,ablationIndex:0,owner:true})).status,400);
  const trial=await call('reserve',{operationId:crypto.randomUUID(),experimentId:experiment.id,repetition:0,policyIndex:0,ablationIndex:0});
  const busy=await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});assert.equal(busy.status,409);assert.equal(busy.data.error.code,'RESEARCH_RESTORE_BUSY');
  const request={operationId:crypto.randomUUID(),trialId:trial.id,expectedRevision:trial.revision},finished=await call('execute',request);assert.equal(finished.status,'PASSED');assert.equal(turns,0);
  const exported=await call('export',{experimentId:experiment.id});assert.equal(exported.sha256,digest(exported.data));assert.equal(exported.data.evidence[0].independent,true);assert.equal(exported.data.trials[0].telemetry.tokens,null);assert.equal(exported.data.trials[0].telemetry.cost,null);
  const restored=await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});assert.equal(restored.status,200,JSON.stringify(restored.data));
  const after=await call('state');assert.equal(after.experiments.length,1);assert.equal(after.trials.find(t=>t.id===trial.id).status,'PASSED');
  const output=path.join(dir,'research','trials',trial.id,'output.json');await writeFile(output,'[]');
  await call('execute',request);assert.equal(await readFile(output,'utf8'),'[]','exact replay cannot recreate output');
  const current=(await call('state')).trials.find(t=>t.id===trial.id),checked=await call('validate',{operationId:crypto.randomUUID(),trialId:trial.id,expectedRevision:current.revision});assert.equal(checked.status,'FAILED');assert.equal(turns,0);
  const comparison=await call('compare',{experimentIds:[experiment.id]});assert.equal(comparison.groups[0].passed,0);assert.equal(comparison.groups[0].failed,1);assert.equal(comparison.groups[0].tokens,null);
});

test('production Workspace/T3 research context keeps the actual Context receipt and prevents stripped/reused admission',async t=>{
  const f=await workspaceFixture(t),projects=[],launches=[];
  const ownerFixture={version:1,dispatch:async()=>{},reconcile:async()=>{},stop:async()=>{},telemetry:async()=>({tokens:null,cost:null}),validate:async()=>{throw Error('Independent owner fixture not used by this wire test');}};
  const research=createResearchService({store:f.store,dataDir:f.dataDir,executionOwner:ownerFixture,authorizeOwner:(_r,c)=>c===f.owner?{kind:'human',role:'owner'}:null});
  const context=await createContextService({store:f.store,dataDir:f.dataDir,authorize:()=>true,capabilities:async()=>({contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source:{kind:'fixture',reference:'INJECTED_NATIVE_CONTEXT_CONTRACT',observedAt:new Date().toISOString()}})});
  const prepareContext=createT3ContextSeam({service:context,callerContextForRun:()=>f.owner,allowNativePassthrough:true});
  const native=createT3Service({store:f.store,dataDir:f.dataDir,prepareContext,
    prepareResearch:async({baseMessage})=>({message:baseMessage+'\nINJECTED_RESEARCH_BRIDGE_DATA: no model execution'}),
    validatePreparedResearch:(s,r)=>{assert.equal(s.events.find(e=>e.id===r.contextId).runId,r.id);return {researchContextDigest:digest(r.researchContext),workspaceId:r.researchContext.workspaceId,contextPolicyDigest:r.researchContext.contextPolicyDigest,forgeContextId:r.contextId,forgeReceiptDigest:digest(r.contextReceipt)};},
    nativeTransport:{cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},call:async(name,args)=>{if(name==='t3_project_list')return {projects};launches.push(args);return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'running'};},openFeed:async()=>{throw Error('INJECTED wire has no native feed');}},
  });Object.assign(f.t3,native);
  try{
    await f.configure();const w=await f.create();
    const config={...defaultResearchConfig(),execution:'agent',repetitions:1,policies:['static'],ablations:[{name:'native-context-only',components:{memory:false,skills:false,adaptation:false,staffing:false,verification:true}}]};
    const e=await research.create({projectId:f.p.id,operationId:crypto.randomUUID(),config},f.owner),trial=await research.reserve({projectId:f.p.id,operationId:crypto.randomUUID(),experimentId:e.id,repetition:0,policyIndex:0,ablationIndex:0,taskId:w.taskId,workspaceId:w.id},f.owner),researchContext=buildResearchContext(f.store.read(),{projectId:f.p.id,trialId:trial.id});
    await assert.rejects(native.startRun({projectId:f.p.id,taskId:w.taskId,operationId:trial.runOperationId}),{code:'RESEARCH_CONTEXT'});assert.equal(launches.length,0);assert.equal(f.store.read().runs.length,0);
    const input={projectId:f.p.id,workspaceId:w.id,operationId:crypto.randomUUID(),expectedRevision:f.w(w).revision};
    assert.throws(()=>f.service.start({...input,researchContext},f.owner),{code:'RESEARCH_CONTEXT'});
    await f.service.start(input,f.owner,{researchContext});
    const run=f.store.read().runs[0],actual=f.store.read().events.find(e=>e.id===run.contextId);
    assert.equal(launches.length,1);assert.equal(actual.type,'context.passthrough');assert.equal(run.contextReceipt.eventId,actual.id);assert.equal(run.researchReceipt.forgeReceiptDigest,digest(run.contextReceipt));assert.equal(run.researchReceipt.forgeContextId,run.contextId);assert.deepEqual(run.researchContext,researchContext);
    assert.ok(launches[0].message.includes('INJECTED_RESEARCH_BRIDGE_DATA'));assert.equal(launches[0].runtimeMode,'approval-required');
    const dispatchInput={projectId:f.p.id,taskId:w.taskId,operationId:trial.runOperationId,workspaceContext:run.workspaceContext,researchContext};
    assert.equal((await native.startRun(dispatchInput)).id,run.id);assert.equal(launches.length,1);
    await assert.rejects(native.startRun({...dispatchInput,researchContext:undefined}),{code:'OPERATION_REUSE'});
  }finally{await native.shutdown();await research.close();}
});
