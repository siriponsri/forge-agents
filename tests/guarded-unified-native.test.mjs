// Engineering fixtures ONLY. Real compiled T3/OpenCode/broker, disposable
// canonical store, deterministic loopback model protocol; no external accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {openStore} from '../app/server/store.mjs';
import {createGuardedExecutionBridge} from '../app/server/guarded.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createFrontendToolBroker} from '../app/frontend-tools/broker.mjs';
import {openFrontendNativeGateway} from '../app/frontend-tools/native-gateway.mjs';
import {digest,bytesDigest} from '../app/guarded-runtime/profile.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-frontend-generation-VD6puQ');
const entry=path.join(cache,'t3/apps/server/dist/forge-guarded-host.mjs');
const sessions=existsSync(path.join(cache,'session-patches.json'));
test('unified private bridge with actual matched native image and purpose isolation', {skip:!existsSync(entry)&&'qualified native cache not installed',timeout:600000},async t=>{
  const subtest=(name,fn)=>t.test(name,{skip:!!process.env.FORGE_UNIFIED_FRONTEND_ONLY&&!name.startsWith('real machine')&&!name.startsWith('explicit frontend')},fn);
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-bridge-test-')),workspace=path.join(root,'workspace'),dataDir=path.join(root,'data');
  await mkdir(path.join(workspace,'allowed'),{recursive:true});await writeFile(path.join(workspace,'allowed/a.txt'),'before');await writeFile(path.join(root,'outside.txt'),'OUTSIDE');
  const files=(await readdir(path.dirname(entry))).filter(n=>n.endsWith('.mjs')).map(name=>({name,path:path.join(path.dirname(entry),name)}));files.push({name:'node.exe',path:process.execPath});
  const base=JSON.parse(await readFile(path.join(cache,'generation.json'),'utf8')).cache;
  const artifacts={t3:{entry,files},opencode:{path:path.join(cache,`opencode/forge-${sessions?'session':'frontend'}-cli-build/cli-windows-x64/bin/opencode.exe`)},fileBroker:{path:path.join(base,'windows/ConfinedText.exe'),sha256:bytesDigest(readFileSync(path.join(base,'windows/ConfinedText.exe')))}};
  const selected={route:{providerInstanceId:'fixture',apiProviderId:'openai',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'openai/forge-fixture',options:[{id:'variant',value:'default'}],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:digest(files.map(f=>({name:f.name,sha256:bytesDigest(readFileSync(f.path))})).sort((a,b)=>a.name.localeCompare(b.name))),opencodeBinarySha256:bytesDigest(readFileSync(artifacts.opencode.path))},policyGeneration:'1',toolGeneration:'1'};
  // Both generations retain exact independent image pins. Cache metadata alone
  // cannot approve a different binary or silently substitute the older image.
  assert.equal(selected.route.t3BinarySha256,sessions?'1435d81ad72b5838dd6f8b413bfda3576a4878f0845ec40e474758c333ba538e':'715c5c8657db3f2910b031e740f9391f04649914569a8c2a0da155d5f73179a5');
  assert.equal(selected.route.opencodeBinarySha256,sessions?'2224d7edb8a06f241c5ec764b506607af110bfec5300e91a03e00421854aef17':'edde02f4107862e229cbe5436fde8b3a28d94195dd6fba85e9f716acaf6cf934');
  let mode='complete',deniedStage=null,ownerAllowed=true,resolveHook,requests=[],observedActions=[],receiptCallbacks=0,holdObserved;
  const realFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1','all external requests blocked');return realFetch(url,options);};
  const model=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
    if(mode==='hold'){holdObserved?.();return;}
    const steps=mode==='frontend'?[['forge_frontend_selection_read',{documentId:'document',expectedRevision:1}]]:mode==='tools'?[['forge_guarded_read_text',{path:'allowed/a.txt'}],['forge_guarded_propose_change',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}],['forge_guarded_edit_text',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}]]:[];
    const toolCount=body.messages.filter(x=>x.role==='tool').length,step=steps[toolCount];
    const delta=step?{role:'assistant',tool_calls:[{index:0,id:'fixture_'+toolCount,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{role:'assistant',content:'done'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const x of [{id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta,finish_reason:null}]},{id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}])res.write('data: '+JSON.stringify(x)+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const store=await openStore(dataDir);await store.transaction(s=>{s.projects.push({id:'project',workspace,profile:{original:true}});s.documents.push({id:'document',projectId:'project',kind:'doc',revision:1});s.tasks.push({id:'task',projectId:'project'});});
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+600000});let bound=0,closedProviders=0,bridge;
  const binding=runId=>{const snapshot=bridge.privateSnapshot(runId),r=store.read().runs.find(x=>x.id===runId),thread=snapshot.providerThread,turn=snapshot.providerTurn;
    if(!snapshot.live||snapshot.profile.purpose!=='supervised-frontend-v1'||!thread?.nativeThreadRef||!turn?.nativeTurnRef||turn.runAttemptId!==r.attemptId||turn.nodeId!==r.rootNodeId)throw Error('NATIVE_NOT_OBSERVED');
    return {projectId:r.projectId,runId:r.id,attemptId:r.attemptId,identityKind:'private-adapter',threadId:r.threadId,rootNodeId:r.rootNodeId,providerThreadId:thread.id,providerTurnId:turn.id,nativeThreadRef:thread.nativeThreadRef,nativeTurnRef:turn.nativeTurnRef,nativeSessionId:thread.nativeThreadRef.nativeId,nativeTurnId:turn.nativeTurnRef.nativeId,documentId:'document',documentRevision:1};};
  const broker=createFrontendToolBroker({store,authorizeOwner:authority.goalAuthorize,authorizeNativeBinding:b=>{try{return digest(b)===digest(binding(b.runId));}catch{return false;}}});await broker.recover();
  bridge=createGuardedExecutionBridge({store,dataDir,artifacts:async()=>artifacts,
    authorizeOwner:()=>ownerAllowed,
    createFrontendGateway:args=>openFrontendNativeGateway({...args,broker,authenticateOwner:()=>null,bindingProvider:()=>binding(args.profile.runId)}),
    onNativePhase:(_s,detail)=>{if(detail.profile.purpose)t.diagnostic('frontend phase '+detail.body.phase+' at '+detail.phase);return true;},
    observeSelectedRoute:(_s,input)=>{assert.equal(input.projectId,'project');return structuredClone(selected);},
    resolveProvider:async()=>{await resolveHook?.();return {provider:{id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'PRIVATE_FIXTURE_KEY',transport:'http'}},credentialRef:'fixture-ref',accountGeneration:'no-account',bind:({runId,attemptId})=>{assert.equal(store.read().runs.find(r=>r.id===runId)?.attemptId,attemptId);bound++;},close:()=>{closedProviders++;}};},
    validateAdmission:(s,{run,stage,attestation,capability,path:actionPath})=>{
      assert.equal(s.runs.find(r=>r.id===run.id),run);if(stage===deniedStage)return false;
      if(stage==='action'){assert.equal(run.status,'running','actual running event must precede actions');assert.ok(attestation);assert.equal(actionPath,'allowed/a.txt');observedActions.push(capability);}
      return true;
    },
    onReceipt(s,{run,receipt}){assert.equal(run.status,'running');assert.equal(receipt.owner,'guarded-file-broker');assert.equal(s.receipts.filter(r=>r.id==='guarded-file:'+receipt.id).length,1);receiptCallbacks++;},
    onEvent(s,{run,event}){
      if(event.type==='provider_thread.updated'){run.nativeProviderThreadId=event.providerThread.id;run.nativeThreadRef=event.providerThread.nativeThreadRef;}
      if(event.type==='provider_turn.updated'){run.nativeProviderTurnId=event.providerTurn.id;run.nativeTurnRef=event.providerTurn.nativeTurnRef;if(event.providerTurn.status==='running')run.status='running';}
      if(event.type==='turn.terminal')run.status=event.status;
    },
  });
  const input=(id=randomUUID())=>({projectId:'project',taskId:'task',operationId:id,workspace,request:{projectId:'project',taskId:'task',envelopeDigest:'a'.repeat(64),identitySnapshot:'b'.repeat(64),scope:{paths:['allowed'],capabilities:['read','propose','workspace.write']},limits:{maxRunMs:300000,maxTokens:null,maxCost:null}},message:'EARLY_UNPREPARED_SENTINEL'});
  const reserve=async value=>{const prepared=await bridge.prepare(value);return store.transaction(s=>{const run={id:randomUUID(),projectId:'project',taskId:'task',operationId:value.operationId,status:'submitting',attemptId:randomUUID(),threadId:randomUUID(),rootNodeId:randomUUID(),workspace,profile:{original:true},selection:{instanceId:'fixture',model:'openai/forge-fixture',options:selected.route.options}};s.runs.push(run);return bridge.reserve(s,{run,input:value,prepared});});};
  const waitFor=(id,predicate)=>new Promise((resolve,reject)=>{let unsub=()=>{};const timer=setTimeout(()=>{unsub();reject(new Error('native observation timeout: '+JSON.stringify(bridge.reconcile(id))));},90000);const read=()=>{const r=bridge.reconcile(id);if(predicate(r)){clearTimeout(timer);unsub();resolve(r);}};unsub=store.subscribe(read);read();});
  try{
    await subtest('absent setup and owner denial produce no requests',async()=>{await assert.rejects(bridge.prepare(input()),{code:'GUARDED_SETUP_REQUIRED'});ownerAllowed=false;await assert.rejects(bridge.prepare(input()),{code:'GUARDED_OWNER_DENIED'});ownerAllowed=true;assert.equal(requests.length,0);});
    await subtest('real machine check qualifies route before canonical run',async()=>{const ready=await bridge.check({projectId:'project',leaseMs:600000});assert.equal(ready.providerTurns,0);assert.equal(ready.negativeCount,17);assert.equal(ready.t3NegativeCount,2);assert.equal(store.read().runs.length,0);assert.ok(bridge.qualifyProactive(store.read(),input().request));assert.equal(bridge.qualifyProactive(store.read(),{...input().request,projectId:'foreign'}),null);assert.equal(requests.length,0);});
    await subtest('unsupported caps and options cannot prepare',async()=>{for(const key of ['maxTokens','maxCost']){const value=input();value.request.limits[key]=1;await assert.rejects(bridge.prepare(value),{code:'UNENFORCEABLE_LIMIT'});}const original=selected.route.options;selected.route.options=[{id:'effort',value:'max'}];await assert.rejects(bridge.prepare(input()));selected.route.options=original;assert.equal(requests.length,0);});
    await subtest('async credential selection race is denied',async()=>{let release;resolveHook=()=>new Promise(r=>{release=r;});const p=bridge.prepare(input());await new Promise(r=>setImmediate(r));selected.route.accountGeneration='rotated';release();await assert.rejects(p,{code:'GUARDED_SELECTED_ROUTE_CHANGED'});selected.route.accountGeneration='no-account';resolveHook=null;assert.equal(requests.length,0);});
    await subtest('reservation admission and rolled back orphan fail with zero effects',async()=>{deniedStage='reservation';await assert.rejects(reserve(input()),{code:'GUARDED_ADMISSION_DENIED'});deniedStage=null;const value=input(),prepared=await bridge.prepare(value);let metadata;await assert.rejects(store.transaction(s=>{const run={id:'orphan',projectId:'project',taskId:'task',operationId:value.operationId,status:'submitting',attemptId:'orphan-attempt',threadId:'orphan-thread',rootNodeId:'orphan-node',workspace,profile:{original:true},selection:{instanceId:'fixture',model:'openai/forge-fixture',options:selected.route.options}};s.runs.push(run);metadata=bridge.reserve(s,{run,input:value,prepared});throw Error('rollback');}));await assert.rejects(bridge.launch(metadata.runId,{message:'final'}));assert.equal(requests.length,0);});
    await subtest('final admission denial after actual attest sends zero model requests',async()=>{const r=await reserve(input());deniedStage='send';await assert.rejects(bridge.launch(r.runId,{message:'final'}),{code:'GUARDED_ADMISSION_DENIED'});deniedStage=null;assert.equal(requests.length,0);});
    await subtest('actual turn events complete one canonical run and retain native refs',async()=>{const value=input(),r=await reserve(value);await bridge.launch(r.runId,{message:'FINAL_CONTEXT_MESSAGE'});const result=await waitFor(r.runId,r=>r.projection?.terminal);assert.equal(result.status,'completed');assert.equal(result.projection.providerTurn.runAttemptId,r.attemptId);assert.equal(result.projection.providerTurn.nodeId,r.rootNodeId);assert.equal(result.projection.terminal.providerTurnId,result.projection.providerTurn.id);assert.ok(result.projection.providerTurn.nativeTurnRef);assert.equal(result.projection.messages.at(-1).text,'done');assert.equal(requests.length,1);assert.ok(JSON.stringify(requests).includes('FINAL_CONTEXT_MESSAGE'));assert.equal(JSON.stringify(requests).includes('EARLY_UNPREPARED_SENTINEL'),false);const canonical=store.read().runs.find(x=>x.id===r.runId);assert.deepEqual(canonical.profile,{original:true});assert.equal(canonical.guardedReceipt.routeEvidenceId,r.routeProof.evidenceId);assert.notEqual(canonical.guardedReceipt.attestation.evidenceId,r.routeProof.evidenceId);assert.equal(canonical.guardedLaunch.messageDigest,digest('FINAL_CONTEXT_MESSAGE'));await bridge.launch(r.runId,{message:'FINAL_CONTEXT_MESSAGE'});await assert.rejects(bridge.launch(r.runId,{message:'different'}),{code:'GUARDED_LAUNCH_COLLISION'});assert.equal(requests.length,1);});
    await subtest('actual running event precedes broker actions and fenced receipts',async()=>{mode='tools';const before=requests.length,r=await reserve(input());await bridge.launch(r.runId,{message:'Bounded tools fixture'});const result=await waitFor(r.runId,r=>r.projection?.terminal);assert.equal(result.status,'completed');assert.equal(requests.length-before,4);assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');assert.equal(await readFile(path.join(root,'outside.txt'),'utf8'),'OUTSIDE');assert.equal(receiptCallbacks,3);assert.ok(observedActions.includes('workspace.write'));const receipts=store.read().receipts.filter(x=>x.runId===r.runId);assert.equal(receipts.length,3);const inspected=bridge.inspectReceipt(r.runId,receipts[0].receipt.operationId);assert.equal(inspected.status,'completed');assert.equal(JSON.stringify(inspected).includes('before'),true);assert.equal(Object.hasOwn(inspected,'text'),false);assert.ok(result.projection.turnItems.some(x=>x.type==='dynamic_tool'));assert.equal(JSON.stringify(requests).includes('guarded-file-broker'),false);mode='complete';});
    await subtest('actual Stop interrupts held native turn without persisted PID kill/replay',async()=>{mode='hold';let observed;const held=new Promise(r=>{observed=r;});holdObserved=observed;const r=await reserve(input());await bridge.launch(r.runId,{message:'Held request fixture'});await held;await waitFor(r.runId,r=>r.projection?.providerTurn);const before=requests.length,[result,alsoStopped]=await Promise.all([bridge.stop(r.runId),bridge.stop(r.runId)]);assert.equal(alsoStopped.status,result.status);assert.equal(result.status,'interrupted');assert.equal(result.projection.terminal.status,'interrupted');assert.equal(result.live,false);assert.equal(requests.length,before);mode='complete';});
    await subtest('current route, workspace, context, owner and policy changes deny before bind',async()=>{for(const mutate of [s=>{s.runs.at(-1).workspace=path.join(root,'other');},s=>{s.runs.at(-1).guardedContext.profile.contextDigest='c'.repeat(64);},s=>{s.runs.at(-1).stopRequest={};}]){const r=await reserve(input());await store.transaction(mutate);await assert.rejects(bridge.launch(r.runId,{message:'must not send'}));}const r=await reserve(input());selected.policyGeneration='2';await assert.rejects(bridge.launch(r.runId,{message:'must not send'}));selected.policyGeneration='1';});
    await subtest('restart metadata never recreates leases or redispatches',async()=>{const r=await reserve(input());await store.transaction(s=>{const prior=s.runs.find(x=>x.id===r.runId);s.runs.push({...structuredClone(prior),id:'lost-lease',attemptId:'lost-attempt',threadId:'lost-thread',rootNodeId:'lost-node',operationId:'lost-operation'});});const before=requests.length;assert.deepEqual(await bridge.recover(),['lost-lease']);await assert.rejects(bridge.launch('lost-lease',{message:'never'}),{code:'GUARDED_PRIVATE_LEASE_REQUIRED'});assert.equal(bridge.reconcile('lost-lease').status,'unknown');assert.deepEqual(await bridge.recover(),[]);assert.equal(requests.length,before);await bridge.stop(r.runId);});

    await subtest('deadline/byte identity, private pending observation and lifecycle reserve failure',async()=>{
      const value=input();value.request.deadlineAt=Date.now()+60000;value.request.maxBytes=37;const r=await reserve(value),snapshot=bridge.privateSnapshot(r.runId);
      assert.equal(snapshot.profile.expiresAt,value.request.deadlineAt);assert.equal(snapshot.profile.scope.maxBytes,37);assert.equal(snapshot.live,false);assert.equal(snapshot.phase,'reserved');assert.equal(snapshot.attestation,null);
      snapshot.profile.scope.maxBytes=100;assert.equal(bridge.privateSnapshot(r.runId).profile.scope.maxBytes,37);
      await bridge.stop(r.runId);const previous=closedProviders;deniedStage='reservation';await assert.rejects(reserve(input()));assert.equal(closedProviders,previous+1);deniedStage=null;
      for(const bad of [{maxBytes:65537},{maxBytes:0},{deadlineAt:Date.now()-1},{purpose:'research'}]){const v=input();Object.assign(v.request,bad);await assert.rejects(bridge.prepare(v));}
    });
    await subtest('explicit frontend advertises sole selection, actual binding only, SDK wait stays outside writer',async()=>{
      mode='frontend';const v=input();v.request.purpose='supervised-frontend-v1';v.request.scope={paths:['.'],capabilities:['frontend_selection_read']};
      assert.equal(bridge.qualifyProactive(store.read(),v.request),null);assert.equal(bridge.qualifyFrontend(store.read(),v.request).mode,'supervised-frontend');
      const before=requests.length,r=await reserve(v),scope={projectId:'project',runId:r.runId,attemptId:r.attemptId};
      assert.throws(()=>binding(r.runId));await bridge.launch(r.runId,{message:'Read mounted selection'});
      const pending=await new Promise((resolve,reject)=>{let off;const timer=setTimeout(()=>{off();reject(Error('selection timeout '+JSON.stringify(bridge.reconcile(r.runId))));},90000);const check=()=>{const call=broker.state(scope,owner).calls.find(x=>x.status==='pending');if(call){clearTimeout(timer);off?.();resolve(call);}};off=store.subscribe(check);check();});
      assert.equal(requests.length-before,1);assert.deepEqual(requests.at(-1).tools.map(t=>t.function.name),['forge_frontend_selection_read']);
      const observed=bridge.privateSnapshot(r.runId);assert.equal(observed.live,true);assert.equal(observed.attestation.purpose,'supervised-frontend-v1');assert.equal(observed.attestation.negativeCount,undefined);
      await broker.returnResult({...scope,pendingId:pending.pendingId,operationId:'result-1',result:{status:'ok',documentId:'document',revision:1,selection:{start:0,end:5,text:'hello'}}},owner);
      const result=await waitFor(r.runId,r=>r.projection?.terminal);assert.equal(result.status,'completed');assert.equal(requests.length-before,2);assert.ok(JSON.stringify(requests.at(-1).messages).includes('owner-frontend-selection'));
      // A terminal gateway must not close the shared broker. Start another
      // actual attempt, then revoke its held SDK result before real native Stop.
      const v2=input();v2.request.purpose='supervised-frontend-v1';v2.request.scope={paths:['.'],capabilities:['frontend_selection_read']};
      const r2=await reserve(v2),scope2={projectId:'project',runId:r2.runId,attemptId:r2.attemptId};await bridge.launch(r2.runId,{message:'Held selection for Stop'});
      const pending2=await new Promise((resolve,reject)=>{let off;const timer=setTimeout(()=>{off();reject(Error('second selection timeout'));},90000);const check=()=>{const call=broker.state(scope2,owner).calls.find(x=>x.status==='pending');if(call){clearTimeout(timer);off?.();resolve(call);}};off=store.subscribe(check);check();});
      const revoke=broker.revokeRun(scope2,'owner-stop');const stopping=bridge.stop(r2.runId);assert.equal(bridge.privateSnapshot(r2.runId).live,false);await revoke;await stopping;
      await assert.rejects(broker.returnResult({...scope2,pendingId:pending2.pendingId,operationId:'stale-result',result:{status:'error',documentId:'document',revision:1,error:{code:'DECLINED'}}},owner));
      assert.equal(broker.state(scope2,owner).calls[0].status,'unknown');
      mode='complete';
    });
    await subtest('restore synchronously revokes pending authority without proof rehydration',async()=>{
      const r=await reserve(input()),pending=bridge.invalidateForRestore();assert.equal(bridge.privateSnapshot(r.runId).live,false);await pending;await assert.rejects(bridge.launch(r.runId,{message:'never restored'}));assert.equal(bridge.privateSnapshot('unobserved'),null);
    });
    assert.equal(JSON.stringify(store.read()).includes('PRIVATE_FIXTURE_KEY'),false);
    assert.equal(JSON.stringify(store.read()).includes('EARLY_UNPREPARED_SENTINEL'),false);
    t.diagnostic(JSON.stringify({node:process.versions.node,providerRequests:requests.length,nativeExternalRequests:0,actualBrokerReceiptCallbacks:receiptCallbacks,actualCompiledEntry:entry}));
  }finally{await bridge.close();await broker.close();await store.close();globalThis.fetch=realFetch;model.closeAllConnections();await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});}
});
