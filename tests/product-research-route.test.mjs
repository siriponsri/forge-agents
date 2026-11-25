// Git/SQLite/Context/Memory/Adaptive/Budget/components/checkers are real.
// Private installation observations are INJECTED_NATIVE_PROOF_NOT_LIVE.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {fixture as componentFixture} from './product-research-route-fixture.test.mjs';
import {fixture as primaryFixture} from './product-research-bridge-fixture.test.mjs';
import {createResearchRoute} from '../app/server/research-route.mjs';
import {createResearchExecutionBridge} from '../app/server/research.mjs';
import {buildResearchContext} from '../app/research/context.mjs';
import {contextForAllocation} from '../app/research-components/index.mjs';
import {digest} from '../app/research/contracts.mjs';
import {createContextService} from '../app/context/index.mjs';
import {createT3ContextSeam} from '../app/context/pre-dispatch.mjs';
import {inspectGuardedOperations} from '../app/guarded-runtime/broker.mjs';

test('final native message binds actual Context wrapper and Memory consumption',async t=>{
  const h=await primaryFixture(t,{memory:true});await h.start();
  let run=h.currentRun();const actual=await h.context.resolve({projectId:run.projectId,contextId:run.contextId},h.owner);
  assert.match(actual.message,/ACTUAL_MEMORY_RECALL_QUALIFICATION/);
  assert.notEqual(actual.message,h.observed.messages[0]);
  assert.throws(()=>h.bridge.validateFinalMessage(h.f.store.read(),run,h.observed.messages[0]),{code:'RESEARCH_FINAL_PROMPT'});
  await h.f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.researchReceipt=h.bridge.validateFinalMessage(s,r,actual.message);});
  run=h.currentRun();assert.equal(run.researchReceipt.finalMessageDigest,digest(actual.message));
  assert.deepEqual(h.bridge.validatePrepared(h.f.store.read(),run),run.researchReceipt);
  assert.throws(()=>h.bridge.validateFinalMessage(h.f.store.read(),run,actual.message+'FORGED'),{code:'RESEARCH_FINAL_PROMPT'});
});

test('recovery uses only trusted existing-owner Stop and retains unknown without redispatch',async t=>{
  const h=await primaryFixture(t);await h.start();await h.bridge.close();let calls=0,authorizations=0;
  const recovered=createResearchExecutionBridge({store:h.f.store,dataDir:h.f.dataDir,workspaces:h.f.service,t3:h.f.t3,authorizeOwner(){authorizations++;return null;},clock:()=>h.currentTrial().deadlineAt+1,stopExistingWorkspace(input,detail){calls++;assert.equal(input.workspaceId,h.w.id);assert.equal(detail.runId,h.currentRun().id);throw Error('EXISTING_OWNER_STOP_ACK_UNKNOWN');}});
  t.after(()=>recovered.close());
  await assert.rejects(recovered.recover(),/EXISTING_OWNER_STOP_ACK_UNKNOWN/);assert.equal(h.currentRun().status,'unknown');assert.equal(h.currentTrial().status,'reconcile-required');
  assert.equal((await recovered.recover()).redispatch,false);assert.equal(calls,1);assert.equal(authorizations,0);assert.equal(h.f.starts,1);
});

test('exact cohort route, pending/final gates, global durable ledgers, gateway and actual member evidence',{timeout:120000},async t=>{
  let context;
  const h=await componentFixture(t,{complete:false,report:false,components:{adaptation:false},unknownAccounting:'allow',beforeResearch:async f=>{
    const source={kind:'fixture',reference:'INJECTED_NATIVE_NOT_LIVE',observedAt:new Date().toISOString()};
    context=await createContextService({store:f.store,dataDir:f.dataDir,authorize:({callerContext})=>callerContext===f.owner,capabilities:async()=>({contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source})});
    await context.policy({projectId:f.p.id,operationId:crypto.randomUUID(),route:{providerId:f.p.profile.provider.instanceId,modelId:f.p.profile.provider.model},budget:{contextWindow:100000,outputReserve:1000,safetyReserve:100},source},f.owner);
  }}),f=h.f;
  const original={...h.service},lives=new Map(),ledgers=new Map(),messages=new Map(),observed={requests:0};
  let calls=0,hold=false,releaseHeld,enteredHeld,startError;const held=new Promise(resolve=>releaseHeld=resolve),holding=new Promise(resolve=>enteredHeld=resolve);
  const upstream=http.createServer(async(req,res)=>{calls++;for await(const _ of req){}if(hold){enteredHeld();await held;}if(!res.destroyed){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"choices":[]}\n\ndata: [DONE]\n\n');}});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>{releaseHeld();upstream.closeAllConnections();upstream.close();});
  const selected={route:{providerInstanceId:f.p.profile.provider.instanceId,modelId:f.p.profile.provider.model,accountGeneration:'INJECTED_NO_ACCOUNT',opencodeBinarySha256:'b'.repeat(64)},policyGeneration:'one',toolGeneration:'one'};
  const policy={observe:()=>structuredClone(selected),resolve:async()=>({provider:{id:'forge',model:'loopback',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${upstream.address().port}/v1`,apiKey:'PRIVATE_UPSTREAM_NOT_PERSISTED',transport:'http'}},credentialRef:'INJECTED_REF',accountGeneration:selected.route.accountGeneration})};
  const guarded={qualifyProactive(_s,r){observed.requests++;return {version:1,projectId:r.projectId,taskId:r.taskId,envelopeDigest:r.envelopeDigest,identitySnapshot:r.identitySnapshot,scopeDigest:digest(r.scope),mode:'mediated-actions',nativeActions:'guarded',normalizedActions:'guarded',evidenceId:'INJECTED_NATIVE_PROOF_NOT_LIVE',expiresAt:Date.now()+60000};},privateSnapshot:id=>structuredClone(lives.get(id)),inspectOperations:runId=>inspectGuardedOperations({receiptPath:ledgers.get(runId),runId})};
  const route=createResearchRoute({store:f.store,dataDir:f.dataDir,policy,getGuarded:()=>guarded,components:original});t.after(()=>route.close());
  const authorizeOwner=(_r,c)=>c===h.owner?{kind:'human',role:'owner'}:null;
  const bridge=createResearchExecutionBridge({store:f.store,dataDir:f.dataDir,workspaces:f.service,t3:f.t3,authorizeOwner,components:original,qualification:route.qualification});t.after(()=>bridge.close());
  const seam=createT3ContextSeam({service:context,callerContextForRun:()=>h.owner});
  const start=f.t3.startRun.bind(f.t3);f.t3.startRun=async input=>{
    try{
    const a=f.store.read().events.find(e=>e.type==='research.allocation'&&e.operationId===input.operationId),canonical={...input,researchContext:buildResearchContext(f.store.read(),{projectId:f.p.id,trialId:h.trial.id}),researchComponentContext:contextForAllocation(a)};
    await f.store.transaction(s=>assert.ok(route.retainInput(s,canonical)));
    return await start(input);
    }catch(error){startError=error;throw error;}
  };
  h.control.beforePrompt=async run=>{
    await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.threadId='thread:'+r.id;r.workspace=r.actualWorkspace;Object.assign(run,r);});
    const request=route.requestForInput(f.store.read(),run),profile={projectId:run.projectId,taskId:run.taskId,runId:run.id,threadId:run.threadId,...selected,scope:{...request.scope,maxBytes:request.maxBytes},expiresAt:request.deadlineAt,manifestDigest:'d'.repeat(64),contextDigest:'c'.repeat(64)};
    lives.set(run.id,{profile,routeProof:guarded.qualifyProactive(f.store.read(),request),attestation:null,phases:[],live:false});
    await f.store.transaction(s=>{assert.equal(route.validate(s,{run:s.runs.find(r=>r.id===run.id),stage:'reservation'}),true);assert.ok(route.reserve(s,{run:s.runs.find(r=>r.id===run.id)}));});
    const receiptPath=path.join(f.dir,run.id+'.sqlite');ledgers.set(run.id,receiptPath);const db=new DatabaseSync(receiptPath);db.exec('CREATE TABLE guarded_receipts(run TEXT,operation TEXT,request_hash TEXT,status TEXT,result TEXT)');db.close();
  };
  h.service.preparePrompt=async args=>{
    const prepared=await bridge.prepare(args);let run=f.store.read().runs.find(r=>r.id===args.run.id);
    const actual=await seam({run,project:f.p,baseMessage:prepared.message});
    await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.contextId=actual.contextId;r.contextReceipt=actual.receipt;r.contextMode=actual.mode;r.researchReceipt=bridge.validateFinalMessage(s,r,actual.message);});
    run=f.store.read().runs.find(r=>r.id===run.id);messages.set(run.id,actual.message);
    assert.throws(()=>route.validate(f.store.read(),{run,stage:'send',messageDigest:digest(actual.message)}),{code:'RESEARCH_NATIVE_ATTESTATION_REQUIRED'});
    const live=lives.get(run.id),p=live.profile;live.attestation={profileDigest:digest(p),contextDigest:p.contextDigest,manifestDigest:p.manifestDigest,binarySha256:p.route.opencodeBinarySha256,policyGeneration:p.policyGeneration,toolGeneration:p.toolGeneration,effects:0,negativeCount:17};live.phases=['openSession','ensureThread'];live.live=true;
    const qualificationReads=observed.requests;
    assert.equal(route.validate(f.store.read(),{run,stage:'send',messageDigest:digest(actual.message)}),true);
    assert.equal(observed.requests,qualificationReads,'run callbacks use the same private accepted proof without nested installation qualification');
    const identity=live.routeProof.identitySnapshot;live.routeProof.identitySnapshot='foreign';
    assert.throws(()=>route.validate(f.store.read(),{run,stage:'send',messageDigest:digest(actual.message)}),{code:'RESEARCH_NATIVE_LIVE_PROOF_REQUIRED'});live.routeProof.identitySnapshot=identity;
    assert.throws(()=>route.validate(f.store.read(),{run,stage:'send',messageDigest:digest(actual.message+'changed')}),{code:'RESEARCH_FINAL_PROMPT'});
    return {...prepared,receipt:run.researchComponentReceipt};
  };
  await h.prepare();await h.advance();if(startError)throw startError;let state=await h.state(),primary=state.attempts[0].run;
  assert.equal(state.attempts.length,1);assert.ok(primary.researchReceipt.finalMessageDigest);assert.equal(primary.researchContext.workspaceId,h.slots[0].workspaceId);
  const request=route.requestForInput(f.store.read(),primary);assert.deepEqual(request.scope,{paths:['output.json'],capabilities:['read','propose','workspace.write']});assert.equal(request.deadlineAt,f.store.read().events.find(e=>e.id===h.trial.id).deadlineAt);assert.equal(request.limits.maxTokens,null);
  assert.equal(route.allowUnknownAccounting(f.store.read(),{run:primary}),true);assert.equal(route.allowUnknownAccounting(f.store.read(),{input:{projectId:f.p.id,taskId:'ordinary',operationId:'ordinary'}}),false);
  assert.throws(()=>route.requestForInput(f.store.read(),{...primary,taskId:h.slots[1].taskId}),{code:'RESEARCH_COMPONENT_CONTEXT'});
  assert.throws(()=>route.requestForInput(f.store.read(),{...primary,researchComponentContext:undefined}),{code:'RESEARCH_COMPONENT_CONTEXT'});
  const created=await route.precreate(primary.id);assert.equal(await readFile(created.path,'utf8'),'');
  const wrapped=await route.resolveProvider({...primary,request},{selected}),bound={runId:primary.id,attemptId:primary.attemptId},provider=wrapped.provider;
  const send=()=>fetch(provider.settings.baseURL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+provider.settings.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:provider.model,stream:true})});
  assert.equal((await send()).status,403);assert.equal(calls,0);wrapped.bind(bound);
  assert.throws(()=>wrapped.bind({...bound,attemptId:'foreign'}),{code:'RESEARCH_NATIVE_EGRESS_BINDING'});
  const response=await send();assert.equal(response.status,200);await response.text();assert.equal(calls,1);
  const resource=f.store.read().events.find(e=>e.type==='research.native-envelope');assert.equal(resource.modelRequests,1);assert.equal(resource.tokens,null);assert.equal(resource.cost,null);assert.equal(resource.finality,null);
  assert.ok(!JSON.stringify(f.store.read()).includes('PRIVATE_UPSTREAM_NOT_PERSISTED'));
  hold=true;const pending=send().then(async r=>({status:r.status,body:await r.text()})).catch(error=>({error:error.name}));await holding;await route.closeRun(primary.id);const stopped=await pending;assert.ok(stopped.error||stopped.status===403);assert.equal(calls,2);releaseHeld();await wrapped.close();
  async function finish(run){
    const text=messages.get(run.id),rows=JSON.parse(text.match(/<benchmark-input[^>]*>(.*?)<\/benchmark-input>/s)[1]),totals=new Map();for(const row of rows)totals.set(row.key,(totals.get(row.key)??0)+row.value);
    await writeFile(path.join(run.actualWorkspace,'output.json'),JSON.stringify([...totals].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({key,total}))));
    await f.store.transaction(s=>{s.runs.find(r=>r.id===run.id).status='completed';});
    return bridge.executionOwner.validate({projectId:run.projectId,trialId:h.trial.id,runId:run.id,attemptId:run.attemptId,manifestDigest:h.trial.manifestDigest,dataset:h.trial.manifest.dataset},h.owner);
  }
  assert.ok((await finish(primary)).evidenceId);await h.advance();if(startError)throw startError;state=await h.state();const helper=state.attempts[1].run;assert.equal(helper.researchReceipt.workspaceId,h.slots[1].workspaceId);assert.equal(helper.researchContext.workspaceId,h.slots[0].workspaceId);
  assert.equal(f.store.read().events.filter(e=>e.type==='research.native-envelope').length,1);
  // Unknown/completed effects remain consumed in the FIRST member's real
  // read-only local SQLite ledger, even when absent from canonical actions.
  const db=new DatabaseSync(ledgers.get(primary.id));for(let i=0;i<h.trial.manifest.limits.maxSteps;i++)db.prepare('INSERT INTO guarded_receipts VALUES (?,?,?,?,NULL)').run(primary.id,'retained'+i,'a'.repeat(64),i%2?'completed':'unknown');db.close();
  await assert.rejects(f.store.transaction(s=>route.onBeforeAction(s,{run:s.runs.find(r=>r.id===helper.id),profile:lives.get(helper.id).profile,attestation:lives.get(helper.id).attestation,operationId:'new',requestDigest:'b'.repeat(64),capability:'read',path:'output.json',priorOperations:[]})),{code:'RESEARCH_NATIVE_ACTION_LIMIT'});
  assert.ok((await finish(helper)).evidenceId);await h.advance();const exported=await bridge.exportComposition({projectId:f.p.id,trialId:h.trial.id},h.owner);assert.equal(exported.data.status,'PASSED');assert.equal(exported.data.evidence.length,2);assert.equal(exported.data.usage.tokens,null);assert.equal(exported.data.usage.cost,null);assert.ok(exported.data.attempts.every(a=>a.run.researchComponentReceipt));
  await assert.rejects(bridge.exportComposition({projectId:f.p.id,trialId:h.trial.id},{role:'owner'}),{code:'OWNER_REQUIRED'});
  await f.store.transaction(s=>{delete s.runs.find(r=>r.id===helper.id).researchReceipt;});
  await assert.rejects(bridge.exportComposition({projectId:f.p.id,trialId:h.trial.id},h.owner),{code:'RESEARCH_CONTEXT_RECEIPT'});
});
