import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,symlink,link,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,injectedOwner} from './research-fixture.test.mjs';
import {digest,mergeResearchSafety,createResearchAdapterRegistry,createResearchService} from '../app/research/index.mjs';
import {readPinnedResearchConfig,runResearchExperiment} from '../app/research/runner.mjs';

test('headless CLI runs genuine CPU fixtures and exports parseable pinned records without a provider',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,['app/research/cli.mjs','--fixture'],{timeout:15000,maxBuffer:2000000,windowsHide:true});const result=JSON.parse(stdout);assert.equal(result.qualification,'REAL_LOCAL_FIXTURE_NO_AGENT_PROVIDER');assert.equal(result.data.trials.length,4);assert.ok(result.data.trials.every(t=>t.status==='PASSED'&&t.telemetry.providerExecution==='NONE'));assert.equal(result.sha256,digest(result.data));assert.ok(result.data.experiment.config.adapterPin.implementationDigest);
});

test('memory ablations inspect real context event shape; absent component receipts never establish use',async t=>{
  const f=await fixture(t,{executionOwner:s=>injectedOwner(s)}),policy={id:crypto.randomUUID(),type:'context.policy',projectId:f.p.id,route:{providerId:'injected-t3',modelId:'fixture-only'},budget:{window:8192}},workspace={id:crypto.randomUUID(),type:'workspace.workspace',projectId:f.p.id,taskId:'task',status:'ready',baseSha:'a'.repeat(40)};
  await f.store.transaction(s=>{s.events.push(policy,workspace);});const e=await f.create({execution:'agent'}),r=await f.reserve(e,{taskId:workspace.taskId,workspaceId:workspace.id});let observed=await f.call('execute',r);assert.equal(observed.status,'awaiting-validation');assert.equal(observed.componentReceipts.memory.status,'NEEDS_SETUP');assert.equal(observed.componentReceipts.skills.status,'OWNER_RECEIPTS_REQUIRED');
  // Explicitly injected Context event, using actual active/memoryGroups shape.
  await f.store.transaction(s=>{const context=s.events.find(e=>e.id===s.runs[0].contextId);context.memoryGroups=[{scope:{kind:'project',id:f.p.id,projectId:f.p.id},refs:[{id:'fixture-memory',sha256:'a'.repeat(64)}]}];context.active=[{id:'fixture-memory',memory:true}];});observed=await f.call('reconcile',observed);assert.equal(observed.componentReceipts.memory.status,'APPLIED');assert.equal(observed.componentReceipts.memory.selectedCount,1);
  const snapshot=f.store.read(),merged=mergeResearchSafety({...snapshot,runs:[],events:snapshot.events.filter(e=>!e.type.startsWith('research.'))},snapshot);assert.equal(merged.runs[0].id,snapshot.runs[0].id);assert.ok(merged.events.some(e=>e.id===r.id));
  await f.store.transaction(s=>{const run=s.runs[0];run.contextReceipt.sourceVersionId='stale-source';});await assert.rejects(f.call('reconcile',observed),{code:'RESEARCH_CONTEXT_RECEIPT'});
});

test('Stop invalidates a reserved provider admission while injected dispatch is still waiting',async t=>{
  let release,arrived,owner;const gate=new Promise(r=>release=r),ready=new Promise(r=>arrived=r);
  const f=await fixture(t,{executionOwner:s=>{owner=injectedOwner(s);const original=owner.dispatch;owner.dispatch=async i=>{arrived();await gate;return original(i);};return owner;}}),e=await f.create({execution:'agent',ablations:[{name:'native',components:{memory:false,skills:false,adaptation:false,staffing:false,verification:true}}]}),workspace={id:crypto.randomUUID(),type:'workspace.workspace',projectId:f.p.id,taskId:'task',status:'ready',baseSha:'a'.repeat(40)};await f.store.transaction(s=>s.events.push(workspace));const r=await f.reserve(e,{taskId:workspace.taskId,workspaceId:workspace.id});
  const starting=f.call('execute',r);await ready;const stopping=f.call('stop',r);await assert.rejects(stopping,{code:'RESEARCH_CONTEXT_RECEIPT'});release();const result=await starting;assert.equal(result.status,'reconcile-required');assert.equal(result.stopRequested,true);assert.equal(f.store.read().runs.length,0);
});

test('all trials retain independent final checks, and registry rejects unpinned or mixed split execution',async t=>{
  const registry=createResearchAdapterRegistry();assert.throws(()=>registry.register({id:'bad',version:'1',pin:{revision:'x'},localExecutable:true,dataset:{digests:{dev:'same',test:'same'}}}),{code:'RESEARCH_SPLIT'});
  const f=await fixture(t),e=await f.create({policies:['static'],ablations:[{name:'no-optional-verifier',components:{memory:false,skills:false,adaptation:false,staffing:false,verification:false}}]}),r=await f.call('execute',await f.reserve(e));assert.equal(r.status,'PASSED');assert.ok(f.store.read().events.find(e=>e.id===r.evidenceId).checks.length>=3);
  await f.store.transaction(s=>{const evidence=s.events.find(e=>e.id===r.evidenceId);evidence.checks[0].passed=false;});await assert.rejects(f.service.export({projectId:f.p.id,experimentId:e.id},f.owner),{code:'RESEARCH_EVIDENCE'});
});

test('pinned exports reproduce configuration through headless service runner and reject changed source pins',async t=>{
  const f=await fixture(t),e=await f.create({policies:['static'],repetitions:1}),first=await f.service.export({projectId:f.p.id,experimentId:e.id},f.owner),pinned=readPinnedResearchConfig(first);
  const repeated=await runResearchExperiment({service:f.service,caller:f.owner,projectId:f.p.id,...pinned});assert.equal(repeated.data.experiment.configDigest,e.configDigest);assert.equal(repeated.data.trials[0].status,'PASSED');
  const changed=structuredClone(first);changed.data.experiment.config.adapterPin.implementationDigest='0'.repeat(64);changed.data.experiment.configDigest=digest(changed.data.experiment.config);changed.sha256=digest(changed.data);assert.throws(()=>readPinnedResearchConfig(changed),{code:'RESEARCH_ADAPTER_PIN'});
});

test('managed local trial paths reject junction escape and hard-linked validator artifacts',async t=>{
  const f=await fixture(t),e=await f.create(),r=await f.reserve(e),root=path.join(f.dir,'research','trials'),outside=path.join(f.dir,'outside');await mkdir(root,{recursive:true});await mkdir(outside);await symlink(outside,path.join(root,r.id),process.platform==='win32'?'junction':'dir');await assert.rejects(f.call('execute',r),{code:'RESEARCH_PATH'});
  const second=await f.reserve(e,{repetition:1});let done=await f.call('execute',second);assert.equal(done.status,'PASSED');const artifact=path.join(root,second.id,'output.json'),linked=path.join(outside,'shared.json');await writeFile(linked,'[]');await unlink(artifact);await link(linked,artifact);done=await f.call('validate',done);assert.equal(done.status,'FAILED');const evidence=f.store.read().events.find(e=>e.id===done.evidenceId);assert.equal(evidence.checks[0].code,'RESEARCH_ARTIFACT_LIMIT');
});
