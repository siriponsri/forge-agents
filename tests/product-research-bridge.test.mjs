import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,link,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './product-research-bridge-fixture.test.mjs';
import {canonical,digest} from '../app/research/contracts.mjs';
import {gitText} from '../app/workspaces/git.mjs';
import {createBudgetService} from '../app/budgets/index.mjs';
import {openStore} from '../app/server/store.mjs';
import {createResearchExecutionBridge} from '../app/server/research.mjs';
import {assertResearchRestoreAvailable} from '../app/research/index.mjs';

async function output(h,{correct=true}={}){
  const dir=path.join(h.f.dataDir,'research','trials',h.trial.id),input=JSON.parse(await readFile(path.join(dir,'input.json'),'utf8')),sums={};
  for(const r of input)sums[r.key]=(sums[r.key]??0)+r.value;
  const value=correct?Object.keys(sums).sort().map(key=>({key,total:sums[key]})):[{key:'agent-self-report',total:1}];
  await writeFile(path.join(h.w.worktreePath,'output.json'),canonical(value));
  await h.f.store.transaction(s=>{s.runs.find(r=>r.id===h.currentRun().id).status='completed';});
}

test('a completed run observed after its deadline is not retroactively cancelled by the watchdog',async t=>{
  const h=await fixture(t);await h.start();await output(h);await h.bridge.close();
  const later=createResearchExecutionBridge({store:h.f.store,dataDir:h.f.dataDir,workspaces:h.f.service,t3:h.f.t3,authorizeOwner:(_r,c)=>c===h.owner?{kind:'human',role:'owner'}:null,clock:()=>h.currentTrial().deadlineAt+1});
  try{const result=await later.executionOwner.reconcile(h.scopeInput(),h.owner);assert.equal(result.status,'completed');assert.equal(h.currentTrial().stopRequested,false);assert.equal(h.f.w(h.w).stopRequested,undefined);assert.equal(h.f.store.read().events.filter(e=>e.type==='research.bridge-stop').length,0);assert.equal(h.f.stops,0);}finally{await later.close();}
});

for(const status of ['cancelled','rolled_back'])test(`Research settles ${status} native outcomes and subsequent Stop without holding restore`,async t=>{
  const h=await fixture(t);await h.start();
  await h.f.store.transaction(s=>{s.runs.find(r=>r.id===h.currentRun().id).status=status;});
  const input=()=>({projectId:h.f.p.id,trialId:h.trial.id,operationId:crypto.randomUUID(),expectedRevision:h.currentTrial().revision});
  const reconciled=await h.research.reconcile(input(),h.owner);assert.equal(reconciled.status,'FAILED');assert.doesNotThrow(()=>assertResearchRestoreAvailable(h.f.store.read()));
  const stopped=await h.research.stop(input(),h.owner);assert.equal(stopped.status,'stopped');
  assert.equal((await h.research.reconcile(input(),h.owner)).status,'stopped');assert.equal(h.f.starts,1);assert.equal(h.f.stops,0);assert.doesNotThrow(()=>assertResearchRestoreAvailable(h.f.store.read()));
});

test('sole Workspace dispatch, opaque authority, actual Context consumption, bounded input and independent exact-byte evidence',async t=>{
  const h=await fixture(t,{config:{split:'test'}});await h.start();assert.equal(h.observed.starts.length,1);assert.equal(h.f.starts,1);
  const start=h.observed.starts[0];assert.equal(start.caller,h.owner);assert.deepEqual(start.internal,{researchContext:h.dispatchInput().researchContext});assert.equal(start.input.workspaceId,h.w.id);
  assert.match(h.observed.messages[0],/^Original canonical task/);assert.match(h.observed.messages[0],/BENCHMARK DATA \(untrusted input/);assert.match(h.observed.messages[0],/Pinned adapter task/);assert.ok(!h.observed.messages[0].includes('reference('));
  assert.equal(await gitText(h.w.worktreePath,['status','--porcelain']),'');
  const run=h.currentRun(),originalReceipt=structuredClone(run.contextReceipt);assert.deepEqual(h.bridge.validatePrepared(h.f.store.read(),run),run.researchReceipt);assert.deepEqual(run.contextReceipt,originalReceipt);
  const replay=await h.bridge.prepare({run,baseMessage:`Original canonical task ${run.taskId}. Preserve original Owner constraints.`});assert.equal(replay.message,h.observed.messages[0]);assert.equal(h.f.store.read().events.filter(e=>e.type==='research.bridge-prepared').length,1);assert.ok(!JSON.stringify(h.f.store.read().events.filter(e=>e.type==='research.bridge-prepared')).includes('Preserve original Owner constraints'));
  await output(h);const result=await h.bridge.executionOwner.validate(h.validateInput(),h.owner),e=h.f.store.read().events.find(e=>e.id===result.evidenceId);
  assert.equal(e.status,'PASSED');assert.equal(e.independent,true);assert.equal(e.runId,run.id);assert.equal(e.attemptId,run.attemptId);assert.equal(e.manifestDigest,h.trial.manifestDigest);assert.equal(e.digest,digest({...e,digest:undefined}));assert.ok(e.checks.every(c=>c.passed));assert.ok(e.checks.some(c=>c.kind==='held-out'));
  await writeFile(path.join(h.w.worktreePath,'output.json'),'[{"key":"self-report","total":0}]');
  const changed=await h.bridge.executionOwner.validate(h.validateInput(),h.owner);assert.equal(h.f.store.read().events.find(e=>e.id===changed.evidenceId).status,'FAILED');assert.equal(h.f.store.read().events.find(saved=>saved.id===e.id).digest,e.digest);
});

test('Research service rechecks evaluated owned bytes and keeps every prior evidence snapshot',async t=>{
  const h=await fixture(t);await h.start();await output(h);
  const input=()=>({projectId:h.f.p.id,trialId:h.trial.id,operationId:crypto.randomUUID(),expectedRevision:h.currentTrial().revision});
  assert.equal((await h.research.reconcile(input(),h.owner)).status,'awaiting-validation');
  const passed=await h.research.validate(input(),h.owner),first=structuredClone(h.f.store.read().events.find(e=>e.id===passed.evidenceId));assert.equal(passed.status,'PASSED');
  await writeFile(path.join(h.w.worktreePath,'output.json'),'[]');
  const failed=await h.research.validate(input(),h.owner);assert.equal(failed.status,'FAILED');assert.notEqual(failed.evidenceId,first.id);assert.deepEqual(h.f.store.read().events.find(e=>e.id===first.id),first);
  await output(h);assert.equal((await h.research.validate(input(),h.owner)).status,'PASSED');
  assert.equal(h.f.store.read().events.filter(e=>e.type==='research.evidence').length,3);assert.equal(h.f.starts,1);
  await h.research.stop(input(),h.owner);await assert.rejects(h.research.validate(input(),h.owner),{code:'RESEARCH_EVIDENCE'});
});

test('default and incomplete native qualification refuse before the Workspace owner or dataset effect',async t=>{
  const h=await fixture(t,{qualified:false});await assert.rejects(h.start(),{code:'RESEARCH_ENFORCEMENT_UNAVAILABLE'});assert.equal(h.observed.starts.length,0);assert.equal(h.f.starts,0);assert.equal(h.currentTrial().prepared,undefined);
});

test('unsupported skills, staffing, adaptive policies and token/cost proof gaps never dispatch',async t=>{
  for(const name of ['skills','staffing','adaptation']){
    await t.test(name,async t=>{const h=await fixture(t,{config:{ablations:[{name,components:{memory:false,skills:false,staffing:false,adaptation:false,verification:false,[name]:true}}]}});await assert.rejects(h.start(),{code:'RESEARCH_COMPONENT_UNAVAILABLE'});assert.equal(h.f.starts,0);});
  }
  await t.test('token and cost caps require exact native enforced caps',async t=>{const h=await fixture(t,{config:{limits:{maxMs:30000,maxSteps:8,maxBytes:65536,maxRetries:0,maxAgents:1,maxTokens:10,maxCost:0.01,unknownAccounting:'block'}},afterAuthorize:async({action},_c,f)=>{if(action==='dispatch')await f.store.transaction(s=>{for(const e of s.events.filter(e=>e.type==='research.enforcement'))e.limits.maxCost=null;});}});await assert.rejects(h.start(),{code:'RESEARCH_ENFORCEMENT_UNAVAILABLE'});assert.equal(h.f.starts,0);});
});

test('memory-off suppresses real FORGE recall; memory-on consumes real saved references and missing refs fail',async t=>{
  const off=await fixture(t);await off.start();const offContext=off.f.store.read().events.find(e=>e.id===off.currentRun().contextId);assert.deepEqual(offContext.memoryGroups,[]);assert.equal(off.bridge.memoryEnabled(off.currentRun()),false);
  const on=await fixture(t,{memory:true});await on.start();const r=on.currentRun(),event=on.f.store.read().events.find(e=>e.id===r.contextId);assert.ok(event.memoryGroups[0].refs.length);assert.ok(event.active.some(i=>i.memory));assert.ok((await on.context.resolve({projectId:on.f.p.id,contextId:r.contextId},on.owner)).message.includes('ACTUAL_MEMORY_RECALL_QUALIFICATION'));
  await on.f.store.transaction(s=>{s.events.find(e=>e.id===r.contextId).memoryGroups=[];});assert.throws(()=>on.bridge.validatePrepared(on.f.store.read(),on.currentRun()),{code:'RESEARCH_MEMORY_UNAVAILABLE'});
});

test('native passthrough binds the prepared request hash and never qualifies ambient memory',async t=>{
  const h=await fixture(t,{passthrough:true});await h.start();assert.ok(h.currentRun().researchReceipt);assert.equal(h.currentRun().contextReceipt.type,'context.passthrough');
  await h.f.store.transaction(s=>{s.events.find(e=>e.id===h.currentRun().contextId).accounting.requestHash='0'.repeat(64);});assert.throws(()=>h.bridge.validatePrepared(h.f.store.read(),h.currentRun()),{code:'RESEARCH_CONTEXT_RECEIPT'});
});

test('input tamper, linked artifact, oversized file and foreign run/attempt cannot mint evidence',async t=>{
  const h=await fixture(t);await h.start();await output(h);
  await assert.rejects(h.bridge.executionOwner.validate({...h.validateInput(),attemptId:crypto.randomUUID()},h.owner),{code:'RESEARCH_EVIDENCE'});
  await assert.rejects(h.bridge.executionOwner.telemetry({projectId:h.f.p.id,runId:h.currentRun().id,attemptId:'foreign'},h.owner),{code:'RESEARCH_OWNERSHIP'});
  await assert.rejects(h.bridge.executionOwner.stop({...h.scopeInput(),runId:'foreign'},h.owner),{code:'RESEARCH_OWNERSHIP'});
  const artifact=path.join(h.w.worktreePath,'output.json'),foreign=path.join(h.f.dir,'foreign.json');await writeFile(foreign,'[]');await unlink(artifact);await link(foreign,artifact);
  await assert.rejects(h.bridge.executionOwner.validate(h.validateInput(),h.owner),{code:'RESEARCH_ARTIFACT_LIMIT'});await unlink(artifact);await writeFile(artifact,' '.repeat(65537));await assert.rejects(h.bridge.executionOwner.validate(h.validateInput(),h.owner),{code:'RESEARCH_ARTIFACT_LIMIT'});
  await output(h);await writeFile(path.join(h.f.dataDir,'research','trials',h.trial.id,'input.json'),'[]');await assert.rejects(h.bridge.executionOwner.validate(h.validateInput(),h.owner),{code:'RESEARCH_SPLIT'});
  assert.equal(h.f.store.read().events.filter(e=>e.type==='research.evidence').length,0);
});

test('policy drift after awaited authorization and forged opaque authority fail before dispatch',async t=>{
  let drift=false;const h=await fixture(t,{afterAuthorize:async({action},_c,f)=>{if(action==='dispatch'&&drift)await f.store.transaction(s=>{s.events.find(e=>e.type==='context.policy').revision++;});}});drift=true;
  await assert.rejects(h.start(),{code:'RESEARCH_CONTEXT_POLICY'});assert.equal(h.f.starts,0);
  await assert.rejects(h.bridge.executionOwner.dispatch(h.dispatchInput(),{...h.owner}),{code:'OWNER_REQUIRED'});
});

test('late policy drift and removal of canonical researchContext cannot prepare input or append Context',async t=>{
  const h=await fixture(t);h.f.control.before=async()=>h.f.store.transaction(s=>{s.events.find(e=>e.type==='context.policy').revision++;});
  await h.start();assert.equal(h.observed.messages.length,0);assert.equal(h.currentTrial().prepared,undefined);assert.ok(!h.currentRun().researchReceipt);
  await h.f.store.transaction(s=>{delete s.runs.find(r=>r.id===h.currentRun().id).researchContext;});assert.throws(()=>h.bridge.memoryEnabled(h.currentRun()),{code:'RESEARCH_CONTEXT'});
});

test('lost acknowledgement/reopen replays retain one execution and exact once-only unknown Stop',async t=>{
  let calls=0;const h=await fixture(t,{workspacesPatch:{async stop(){calls++;throw Error('INJECTED_STOP_LOST_ACK');}}});await h.start();
  await assert.rejects(h.bridge.executionOwner.stop(h.scopeInput(),h.owner),/INJECTED_STOP_LOST_ACK/);await h.reopenBridge();
  assert.equal((await h.bridge.executionOwner.stop(h.scopeInput(),h.owner)).status,'unknown');assert.equal(calls,1);assert.equal(h.currentTrial().status,'reconcile-required');assert.equal(h.f.starts,1);
  const reopened=await openStore(h.f.dataDir);let restartedCalls=0;const restarted=createResearchExecutionBridge({store:reopened,dataDir:h.f.dataDir,t3:{},workspaces:{start(){throw Error('must not dispatch');},reconcile(){},stop(){restartedCalls++;}},authorizeOwner:(_r,c)=>c===h.owner?{kind:'human',role:'owner'}:null});
  try{assert.equal((await restarted.executionOwner.stop(h.scopeInput(),h.owner)).status,'unknown');assert.equal(restartedCalls,0);}finally{await restarted.close();await reopened.close();}
  // Reconcile never launches another run or releases a budget hold.
  await h.bridge.executionOwner.reconcile(h.scopeInput(),h.owner);assert.equal(h.f.starts,1);assert.equal(calls,1);
});

test('dispatch replay and lost Workspace acceptance acknowledgement never launch twice',async t=>{
  const h=await fixture(t);h.f.control.loseAfter=true;await h.start();assert.equal(h.f.starts,1);
  const before=h.f.starts;await h.bridge.executionOwner.dispatch(h.dispatchInput(),h.owner);await h.reopenBridge();await h.bridge.executionOwner.dispatch(h.dispatchInput(),h.owner);assert.equal(h.f.starts,before);
});

test('deadline during awaited Workspace setup reaches canonical Stop once and retains unknown outcome',{timeout:40000},async t=>{
  let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r),h=await fixture(t,{config:{limits:{maxMs:15000,maxSteps:8,maxBytes:65536,maxRetries:0,maxAgents:1,maxTokens:null,maxCost:null,unknownAccounting:'block'}},workspacesPatch:{async start(input,caller){entered();await gate;return h.f.service.start(input,caller);}}});
  const running=h.start().catch(e=>e);let timer,off=()=>{};
  try{
    // Git admission can take longer under a combined suite. Fail on an early
    // dispatch rejection instead of waiting forever for an unreached gate.
    await Promise.race([ready,running.then(result=>{throw result instanceof Error?result:new Error('Workspace setup bypassed its gate');})]);
    const stopped=new Promise(resolve=>{off=h.f.store.subscribe(()=>{if(h.f.store.read().events.some(e=>e.type==='research.bridge-stop'))resolve();});});
    await Promise.race([stopped,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Deadline Stop was not observed')),18000);})]);
    const stop=h.f.store.read().events.find(e=>e.type==='research.bridge-stop');assert.ok(stop);assert.equal(stop.reason,'deadline');
  }finally{clearTimeout(timer);off();release();}
  assert.equal((await running).code,'REVISION_CONFLICT');
  assert.equal(h.currentTrial().stopRequested,true);assert.equal(h.observed.messages.length,0);assert.equal(h.f.store.read().events.filter(e=>e.type==='research.bridge-stop').length,1);assert.ok(h.f.w(h.w).stopRequested);
});

test('telemetry uses actual canonical Budget receipt and preserves unknown nulls and currency provenance',async t=>{
  const h=await fixture(t);await h.start();const r=h.currentRun(),input={projectId:h.f.p.id,runId:r.id,attemptId:r.attemptId};
  const missing=await h.bridge.executionOwner.telemetry(input,h.owner);assert.equal(missing.tokens,null);assert.equal(missing.cost,null);assert.equal(missing.provenance.nativeFinal,null);
  const budget=createBudgetService({store:h.f.store,t3:h.f.t3,authorize:(_r,c)=>c===h.owner?{kind:'human',role:'owner'}:null});
  await budget.observe({projectId:r.projectId,botId:r.botId,runId:r.id,attemptId:r.attemptId,providerInstanceId:r.selection.instanceId,model:r.selection.model,source:'INJECTED_NATIVE_CUMULATIVE_NOT_LIVE',sourceReceiptId:'native-cost-1',sequence:1,cost:{minorUnits:17,scale:3,currency:'USD'},usage:{totalTokens:9},final:false,occurredAt:Date.now()});
  const observed=await h.bridge.executionOwner.telemetry(input,h.owner);assert.equal(observed.tokens,9);assert.equal(observed.cost,0.017);assert.equal(observed.currency,'USD');assert.equal(observed.provenance.costReceiptId,'native-cost-1');assert.equal(observed.provenance.nativeFinal,false);
  await h.f.store.transaction(s=>{s.events.find(e=>e.type==='budget.observation').cost.minorUnits=0;});await assert.rejects(h.bridge.executionOwner.telemetry(input,h.owner),{code:'RESEARCH_TELEMETRY'});
});
