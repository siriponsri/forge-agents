import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,readFile,mkdir,symlink} from 'node:fs/promises';
import {fixture,injectedOwner} from './research-fixture.test.mjs';
import {digest,buildResearchContext,admitResearchTrial,mergeResearchSafety,assertResearchRestoreAvailable,dispatchResearchRequest,createResearchAdapterRegistry} from '../app/research/index.mjs';
import {decideResearchPolicy} from '../app/research/policies.mjs';

test('real SQLite repeated immutable matrix, exact replay/restart and machine export',async t=>{
  const f=await fixture(t),input=f.input({config:f.config({policies:['static','rule-adapt']})}),e=await f.service.create(input,f.owner);
  assert.deepEqual(await f.service.create(input,f.owner),e);
  await assert.rejects(f.service.create({...input,config:{...input.config,name:'different'}},f.owner),{code:'OPERATION_REUSE'});
  const results=[];
  for(let repetition=0;repetition<2;repetition++)for(let policyIndex=0;policyIndex<2;policyIndex++){const reserved=await f.reserve(e,{repetition,policyIndex}),op=f.input({trialId:reserved.id,expectedRevision:reserved.revision});const done=await f.service.execute(op,f.owner);assert.equal(done.status,'PASSED');assert.equal(done.telemetry.tokens,null);assert.equal(done.telemetry.cost,null);assert.ok(done.telemetry.tools>0);assert.deepEqual(await f.service.execute(op,f.owner),done);results.push(done);}
  assert.equal(new Set(results.map(t=>t.id)).size,4);
  await assert.rejects(f.reserve(e),{code:'RESEARCH_DUPLICATE_TRIAL'});
  await f.restart();assert.deepEqual(await f.service.create(input,f.owner),e);
  const exported=await f.service.export({projectId:f.p.id,experimentId:e.id},f.owner);assert.equal(exported.sha256,digest(exported.data));assert.equal(exported.data.trials.length,4);assert.ok(exported.data.evidence.every(e=>e.independent));assert.ok(!JSON.stringify(exported).includes('"haystack_sessions":'));
  const comparison=await f.service.compare({projectId:f.p.id,experimentIds:[e.id]},f.owner);assert.equal(comparison.comparable,true);assert.equal(comparison.groups.length,2);assert.equal(comparison.groups[0].tokens,null);assert.equal(comparison.groups[0].unknownTokens,2);
  const unauthorized=Object.freeze({kind:'human',role:'owner'});await assert.rejects(f.service.export({projectId:f.p.id,experimentId:e.id},unauthorized),{code:'OWNER_REQUIRED'});
});

test('private held-out expected values and external-state/artifact validators reject real tampering',async t=>{
  const f=await fixture(t),dev=await f.create({split:'dev'}),held=await f.create({split:'test'});assert.notEqual(dev.config.dataset.digest,held.config.dataset.digest);
  let r=await f.reserve(held);r=await f.call('execute',r);assert.equal(r.status,'PASSED');
  const evidence=(await f.service.state({projectId:f.p.id},f.owner)).evidence.find(e=>e.id===r.evidenceId);assert.ok(evidence.checks.some(c=>c.kind==='held-out'));
  const dir=path.join(f.dir,'research','trials',r.id);await writeFile(path.join(dir,'output.json'),'[{"key":"alpha","total":999}]');r=await f.call('validate',r);assert.equal(r.status,'FAILED');
  await writeFile(path.join(dir,'input.json'),'[]');r=await f.call('validate',r);assert.equal(r.status,'FAILED');
  const latest=f.store.read().events.find(e=>e.id===r.evidenceId);assert.equal(latest.checks.find(c=>c.kind==='external-state').passed,false);
  const cp=path.join(dir,'checkpoint.json');await writeFile(cp,'{"phase":"executed"}');await assert.rejects(f.call('validate',r),{code:'RESEARCH_CHECKPOINT'});
  const comparison=await f.service.compare({projectId:f.p.id,experimentIds:[dev.id,held.id]},f.owner);assert.equal(comparison.comparable,false);
  await f.store.transaction(s=>{s.events.find(e=>e.id===r.id).manifest.dataset.split='dev';});await assert.rejects(f.service.export({projectId:f.p.id,experimentId:held.id},f.owner),{code:'RESEARCH_INTEGRITY'});
});

test('isolated replayable tool/stale/interruption/checkpoint faults require actual policy recovery',async t=>{
  const f=await fixture(t);
  for(const fault of ['tool-failure','stale-state','session-interruption','checkpoint-recovery']){
    const e=await f.create({fault,policies:['static','rule-adapt','evidence-guided']}),r=await f.reserve(e,{policyIndex:1});let done=await f.call('execute',r);
    if(done.status==='interrupted'){await f.restart();done=await f.call('reconcile',done);}
    assert.equal(done.status,'PASSED',fault);assert.equal(done.trace.filter(e=>e.kind==='fault').length,1);assert.ok(done.trace.some(e=>e.kind==='policy'&&['retry','refresh','resume'].includes(e.decision.action)));
    const fixed=await f.reserve(e,{policyIndex:0});let blocked=await f.call('execute',fixed);if(blocked.status==='interrupted')blocked=await f.call('reconcile',blocked);assert.equal(blocked.status,'FAILED',fault);
  }
});

test('component ablations retain mandatory security, independent final checks and enforce bounds',async t=>{
  const f=await fixture(t),components={memory:false,skills:false,adaptation:false,staffing:false,verification:false};
  const e=await f.create({ablations:[{name:'off',components}],policies:['evidence-guided'],fault:'tool-failure'}),r=await f.reserve(e),done=await f.call('execute',r);assert.equal(done.status,'FAILED');assert.equal(done.manifest.security.mandatory,true);
  const normal=await f.create({ablations:[{name:'off',components}]}),passed=await f.call('execute',await f.reserve(normal));assert.equal(passed.status,'PASSED');assert.ok(passed.evidenceId);
  for(const patch of [{security:{mandatory:false}},{limits:{...f.config().limits,maxSteps:100}},{repetitions:9},{policies:['rl-train']},{ablations:[{name:'wrong',components:{...components,security:false}}]}])await assert.rejects(f.create(patch));
  const small=await f.create({limits:{...f.config().limits,maxSteps:1},fault:'tool-failure'});assert.equal((await f.call('execute',await f.reserve(small))).status,'FAILED');
  const byteCap=await f.create({limits:{...f.config().limits,maxBytes:10}});await assert.rejects(f.call('execute',await f.reserve(byteCap)),{code:'RESEARCH_ARTIFACT_LIMIT'});
  let time=0;const timed=await fixture(t,{clock:()=>time+=1000}),short=await timed.create({limits:{...timed.config().limits,maxMs:1}});assert.equal((await timed.call('execute',await timed.reserve(short))).status,'LIMIT_REACHED');
});

test('bounded dispatcher cannot expose internal lifecycle/authority or model-supplied evidence',async t=>{
  const f=await fixture(t);for(const method of ['recover','close','__proto__','suspendForRestore'])await assert.rejects(dispatchResearchRequest(f.service,method,{projectId:f.p.id},f.owner),{code:'NOT_FOUND'});
  await assert.rejects(dispatchResearchRequest(f.service,'state',{projectId:f.p.id,caller:{role:'owner'}},f.owner),{code:'RESEARCH_SCHEMA'});
  await assert.rejects(dispatchResearchRequest(f.service,'state',{projectId:f.p.id},{}),{code:'OWNER_REQUIRED'});
  const e=await f.create(),r=await f.reserve(e);await assert.rejects(dispatchResearchRequest(f.service,'validate',f.input({trialId:r.id,expectedRevision:1,success:true,tokens:0}),f.owner),{code:'RESEARCH_SCHEMA'});
  await assert.rejects(f.service.execute(f.input({projectId:f.q.id,trialId:r.id,expectedRevision:r.revision}),f.owner),{code:'RESEARCH_NOT_FOUND'});
  await assert.rejects(f.call('execute',r,{expectedRevision:99}),{code:'REVISION_CONFLICT'});
});

test('public registry separates source pins/license/setup from executable protocol fixtures',async t=>{
  const f=await fixture(t),registry=createResearchAdapterRegistry(),catalog=registry.list();assert.equal(catalog.length,6);
  for(const adapter of catalog.filter(a=>!a.localExecutable))await assert.rejects(f.create({adapter:{id:adapter.id,version:adapter.version}}),{code:'RESEARCH_NOT_EXECUTABLE'});
  assert.equal(catalog.find(a=>a.id==='toolmaze').pin.license,'NOT_AVAILABLE');assert.equal(catalog.find(a=>a.id==='mle-bench').setup.executed,false);
  const e=await f.create({adapter:{id:'forge-longmem-protocol',version:'1'},split:'test'}),r=await f.call('execute',await f.reserve(e));assert.equal(r.status,'PASSED');
  const evidence=f.store.read().events.find(e=>e.id===r.evidenceId);assert.match(evidence.qualification,/official model judge NOT_RUN/);
  const bytes=await readFile(path.join(f.dir,'research','trials',r.id,'output.jsonl'),'utf8');assert.ok(bytes.includes('question_id'));
});

test('reserved pre-run restore gap is guarded; historical restore preserves effect identity and freezes admission',async t=>{
  const f=await fixture(t),before=f.store.read(),e=await f.create(),r=await f.reserve(e);assert.throws(()=>assertResearchRestoreAvailable(f.store.read()),{code:'RESEARCH_RESTORE_BUSY'});
  await assert.rejects(f.service.suspendForRestore(),{code:'RESEARCH_RESTORE_BUSY'});await assert.rejects(f.call('execute',r),{code:'RESEARCH_SUSPENDED'});f.service.cancelRestore();
  const merged=mergeResearchSafety(before,f.store.read()),saved=merged.events.find(e=>e.id===r.id);assert.equal(saved.status,'reconcile-required');assert.equal(saved.restoreReviewRequired,true);assert.ok(merged.events.some(x=>x.id===e.id));
  await f.call('stop',r);await f.service.suspendForRestore();f.service.cancelRestore();assert.doesNotThrow(()=>assertResearchRestoreAvailable(f.store.read()));
});

test('agent admission fails closed without existing owner; canonical injected run/context receipts reconcile once',async t=>{
  const no=await fixture(t),e=await no.create({execution:'agent'});await assert.rejects(no.reserve(e,{taskId:'task',workspaceId:'workspace'}),{code:'RESEARCH_OWNER_INTEGRATION'});
  let owner;const f=await fixture(t,{executionOwner:storeFor=>owner=injectedOwner(storeFor,{loseResponse:true})}),components={memory:false,skills:false,adaptation:true,staffing:false,verification:true},a=await f.create({execution:'agent',ablations:[{name:'native-compatible',components}]});
  const workspace={id:crypto.randomUUID(),type:'workspace.workspace',projectId:f.p.id,taskId:'task-1',status:'ready',baseSha:'a'.repeat(40),runOperationId:null};await f.store.transaction(s=>{s.events.push(workspace);});
  const reserved=await f.reserve(a,{taskId:workspace.taskId,workspaceId:workspace.id});assert.ok(reserved.manifest.contextPolicyDigest);const input={projectId:f.p.id,taskId:workspace.taskId,operationId:reserved.runOperationId,workspaceContext:{workspaceId:workspace.id},researchContext:buildResearchContext(f.store.read(),{projectId:f.p.id,trialId:reserved.id})};
  assert.equal(admitResearchTrial(f.store.read(),input).id,reserved.id);assert.throws(()=>admitResearchTrial(f.store.read(),{...input,researchContext:undefined}),{code:'RESEARCH_CONTEXT'});
  assert.throws(()=>admitResearchTrial(f.store.read(),{...input,researchContext:{...input.researchContext,split:'test'}}),{code:'RESEARCH_CONTEXT'});
  let unknown=await f.call('execute',reserved);assert.equal(unknown.status,'reconcile-required');assert.equal(owner.counters.dispatch,1);await f.restart();unknown=await f.call('reconcile',unknown);assert.equal(unknown.status,'awaiting-validation');assert.equal(unknown.telemetry.tokens,null);const final=await f.call('validate',unknown);assert.equal(final.status,'PASSED');assert.equal(f.store.read().runs.length,1);assert.equal(f.store.read().runs[0].fixture,'INJECTED_T3_NOT_LIVE');
  await f.store.transaction(s=>{s.runs[0].researchReceipt.forgeReceiptDigest='forged';});await assert.rejects(f.call('reconcile',final),{code:'RESEARCH_CONTEXT_RECEIPT'});
});

test('native passthrough cannot claim memory, context-policy changes invalidate admission',async t=>{
  const f=await fixture(t,{executionOwner:s=>injectedOwner(s)}),w={id:crypto.randomUUID(),type:'workspace.workspace',projectId:f.p.id,taskId:'task',status:'ready',baseSha:'b'.repeat(40)};await f.store.transaction(s=>s.events.push(w));const e=await f.create({execution:'agent'});await assert.rejects(f.reserve(e,{taskId:w.taskId,workspaceId:w.id}),{code:'RESEARCH_COMPONENT_UNAVAILABLE'});
  const a=await f.create({execution:'agent',ablations:[{name:'no-memory',components:{memory:false,skills:false,adaptation:false,staffing:false,verification:false}}]}),r=await f.reserve(a,{taskId:w.taskId,workspaceId:w.id}),context=buildResearchContext(f.store.read(),{projectId:f.p.id,trialId:r.id});await f.store.transaction(s=>s.events.push({id:crypto.randomUUID(),type:'context.policy',projectId:f.p.id,route:{providerId:'injected-t3',modelId:'fixture-only'},budget:{tokens:100}}));assert.throws(()=>admitResearchTrial(f.store.read(),{projectId:f.p.id,taskId:w.taskId,operationId:r.runOperationId,workspaceContext:{workspaceId:w.id},researchContext:context}),{code:'RESEARCH_CONTEXT_POLICY'});
});
