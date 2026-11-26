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
import {digest,bytesDigest} from '../app/guarded-runtime/profile.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-guarded-timeout30s-20261125');
const entry=path.join(cache,'t3/apps/server/dist/forge-guarded-host.mjs');
test('canonical guarded bridge with actual compiled native ownership', {skip:!existsSync(entry)&&'qualified native cache not installed',timeout:300000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-bridge-test-')),workspace=path.join(root,'workspace'),dataDir=path.join(root,'data');
  await mkdir(path.join(workspace,'allowed'),{recursive:true});await writeFile(path.join(workspace,'allowed/a.txt'),'before');await writeFile(path.join(root,'outside.txt'),'OUTSIDE');
  const files=(await readdir(path.dirname(entry))).filter(n=>n.endsWith('.mjs')).map(name=>({name,path:path.join(path.dirname(entry),name)}));files.push({name:'node.exe',path:process.execPath});
  const artifacts={t3:{entry,files},opencode:{path:path.join(cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe')},fileBroker:{path:path.join(cache,'windows/ConfinedText.exe'),sha256:bytesDigest(readFileSync(path.join(cache,'windows/ConfinedText.exe')))}};
  const selected={route:{providerInstanceId:'fixture',apiProviderId:'openai',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'openai/forge-fixture',options:[{id:'variant',value:'default'}],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:digest(files.map(f=>({name:f.name,sha256:bytesDigest(readFileSync(f.path))})).sort((a,b)=>a.name.localeCompare(b.name))),opencodeBinarySha256:bytesDigest(readFileSync(artifacts.opencode.path))},policyGeneration:'1',toolGeneration:'1'};
  assert.equal(selected.route.t3BinarySha256,'3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9');
  assert.equal(selected.route.opencodeBinarySha256,'33ef775f30afbf7808773e97bc4d70e1dc990155541162c92e5b6e2dc1c18ad3');
  let mode='complete',deniedStage=null,ownerAllowed=true,resolveHook,requests=[],observedActions=[],receiptCallbacks=0,holdObserved;
  const realFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1','all external requests blocked');return realFetch(url,options);};
  const model=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
    if(mode==='hold'){holdObserved?.();return;}
    const steps=mode==='tools'?[['forge_guarded_read_text',{path:'allowed/a.txt'}],['forge_guarded_propose_change',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}],['forge_guarded_edit_text',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}]]:[];
    const toolCount=body.messages.filter(x=>x.role==='tool').length,step=steps[toolCount];
    const delta=step?{role:'assistant',tool_calls:[{index:0,id:'fixture_'+toolCount,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{role:'assistant',content:'done'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const x of [{id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta,finish_reason:null}]},{id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}])res.write('data: '+JSON.stringify(x)+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const store=await openStore(dataDir);await store.transaction(s=>{s.projects.push({id:'project',workspace,profile:{original:true}});});
  const bridge=createGuardedExecutionBridge({store,dataDir,artifacts:async()=>artifacts,
    authorizeOwner:(s,detail)=>{
      assert.equal(s.runs.find(r=>r.id===detail.run?.id)??null,detail.run??null);
      if(detail.stage==='action'){
        assert.equal(detail.path,'allowed/a.txt');
        assert.ok(['read','propose','workspace.write'].includes(detail.capability));
        assert.ok(detail.attestation,'the Owner gate receives the actual action attestation');
        assert.equal(detail.profile.runId,detail.run.id);
      }
      return ownerAllowed;
    },
    observeSelectedRoute:(_s,input)=>{assert.equal(input.projectId,'project');return structuredClone(selected);},
    resolveProvider:async()=>{await resolveHook?.();return {provider:{id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'PRIVATE_FIXTURE_KEY',transport:'http'}},credentialRef:'fixture-ref',accountGeneration:'no-account'};},
    validateAdmission:(s,{run,stage,attestation,capability,path:actionPath})=>{
      assert.equal(s.runs.find(r=>r.id===run.id),run);if(stage===deniedStage)return false;
      if(stage==='action'){assert.equal(run.status,'running','actual running event must precede actions');assert.ok(attestation);assert.equal(actionPath,'allowed/a.txt');observedActions.push(capability);}
      return true;
    },
    onReceipt(s,{run,receipt}){assert.equal(run.status,'running');assert.equal(receipt.owner,'guarded-file-broker');assert.equal(s.receipts.filter(r=>r.id==='guarded-file:'+receipt.id).length,1);receiptCallbacks++;},
    onEvent(s,{run,event}){
      if(event.type==='provider_turn.updated'&&event.providerTurn.status==='running')run.status='running';
      if(event.type==='turn.terminal')run.status=event.status;
    },
  });
  const input=(id=randomUUID())=>({projectId:'project',taskId:'task',operationId:id,workspace,request:{projectId:'project',taskId:'task',envelopeDigest:'a'.repeat(64),identitySnapshot:'b'.repeat(64),scope:{paths:['allowed'],capabilities:['read','propose','workspace.write']},limits:{maxRunMs:300000,maxTokens:null,maxCost:null}},message:'EARLY_UNPREPARED_SENTINEL'});
  const reserve=async value=>{const prepared=await bridge.prepare(value);return store.transaction(s=>{const run={id:randomUUID(),projectId:'project',taskId:'task',operationId:value.operationId,status:'submitting',attemptId:randomUUID(),threadId:randomUUID(),rootNodeId:randomUUID(),workspace,profile:{original:true},selection:{instanceId:'fixture',model:'openai/forge-fixture',options:selected.route.options}};s.runs.push(run);return bridge.reserve(s,{run,input:value,prepared});});};
  const waitFor=(id,predicate)=>new Promise((resolve,reject)=>{let unsub=()=>{};const timer=setTimeout(()=>{unsub();reject(new Error('native observation timeout: '+JSON.stringify(bridge.reconcile(id))));},90000);const read=()=>{const r=bridge.reconcile(id);if(predicate(r)){clearTimeout(timer);unsub();resolve(r);}};unsub=store.subscribe(read);read();});
  try{
    await t.test('absent setup and owner denial produce no requests',async()=>{await assert.rejects(bridge.prepare(input()),{code:'GUARDED_SETUP_REQUIRED'});ownerAllowed=false;await assert.rejects(bridge.prepare(input()),{code:'GUARDED_OWNER_DENIED'});ownerAllowed=true;assert.equal(requests.length,0);});
    await t.test('real machine check qualifies route before canonical run',async()=>{const ready=await bridge.check({projectId:'project',leaseMs:600000});assert.equal(ready.providerTurns,0);assert.equal(ready.negativeCount,17);assert.equal(ready.t3NegativeCount,2);assert.equal(store.read().runs.length,0);assert.ok(bridge.qualifyProactive(store.read(),input().request));assert.equal(bridge.qualifyProactive(store.read(),{...input().request,projectId:'foreign'}),null);assert.equal(requests.length,0);});
    await t.test('unsupported caps and options cannot prepare',async()=>{for(const key of ['maxTokens','maxCost']){const value=input();value.request.limits[key]=1;await assert.rejects(bridge.prepare(value),{code:'UNENFORCEABLE_LIMIT'});}const original=selected.route.options;selected.route.options=[{id:'effort',value:'max'}];await assert.rejects(bridge.prepare(input()));selected.route.options=original;assert.equal(requests.length,0);});
    await t.test('async credential selection race is denied',async()=>{let release;resolveHook=()=>new Promise(r=>{release=r;});const p=bridge.prepare(input());await new Promise(r=>setImmediate(r));selected.route.accountGeneration='rotated';release();await assert.rejects(p,{code:'GUARDED_SELECTED_ROUTE_CHANGED'});selected.route.accountGeneration='no-account';resolveHook=null;assert.equal(requests.length,0);});
    await t.test('reservation admission and rolled back orphan fail with zero effects',async()=>{deniedStage='reservation';await assert.rejects(reserve(input()),{code:'GUARDED_ADMISSION_DENIED'});deniedStage=null;const value=input(),prepared=await bridge.prepare(value);let metadata;await assert.rejects(store.transaction(s=>{const run={id:'orphan',projectId:'project',taskId:'task',operationId:value.operationId,status:'submitting',attemptId:'orphan-attempt',threadId:'orphan-thread',rootNodeId:'orphan-node',workspace,profile:{original:true},selection:{instanceId:'fixture',model:'openai/forge-fixture',options:selected.route.options}};s.runs.push(run);metadata=bridge.reserve(s,{run,input:value,prepared});throw Error('rollback');}));await assert.rejects(bridge.launch(metadata.runId,{message:'final'}));assert.equal(requests.length,0);});
    await t.test('final admission denial after actual attest sends zero model requests',async()=>{const r=await reserve(input());deniedStage='send';await assert.rejects(bridge.launch(r.runId,{message:'final'}),{code:'GUARDED_ADMISSION_DENIED'});deniedStage=null;assert.equal(requests.length,0);});
    await t.test('actual turn events complete one canonical run and retain native refs',async()=>{const value=input(),r=await reserve(value);await bridge.launch(r.runId,{message:'FINAL_CONTEXT_MESSAGE'});const result=await waitFor(r.runId,r=>r.projection?.terminal);assert.equal(result.status,'completed');assert.equal(result.projection.providerTurn.runAttemptId,r.attemptId);assert.equal(result.projection.providerTurn.nodeId,r.rootNodeId);assert.equal(result.projection.terminal.providerTurnId,result.projection.providerTurn.id);assert.ok(result.projection.providerTurn.nativeTurnRef);assert.equal(result.projection.messages.at(-1).text,'done');assert.equal(requests.length,1);assert.ok(JSON.stringify(requests).includes('FINAL_CONTEXT_MESSAGE'));assert.equal(JSON.stringify(requests).includes('EARLY_UNPREPARED_SENTINEL'),false);const canonical=store.read().runs.find(x=>x.id===r.runId);assert.deepEqual(canonical.profile,{original:true});assert.equal(canonical.guardedReceipt.routeEvidenceId,r.routeProof.evidenceId);assert.notEqual(canonical.guardedReceipt.attestation.evidenceId,r.routeProof.evidenceId);assert.equal(canonical.guardedLaunch.messageDigest,digest('FINAL_CONTEXT_MESSAGE'));await bridge.launch(r.runId,{message:'FINAL_CONTEXT_MESSAGE'});await assert.rejects(bridge.launch(r.runId,{message:'different'}),{code:'GUARDED_LAUNCH_COLLISION'});assert.equal(requests.length,1);});
    await t.test('actual running event precedes broker actions and fenced receipts',async()=>{mode='tools';const before=requests.length,r=await reserve(input());await bridge.launch(r.runId,{message:'Bounded tools fixture'});const result=await waitFor(r.runId,r=>r.projection?.terminal);assert.equal(result.status,'completed');assert.equal(requests.length-before,4);assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');assert.equal(await readFile(path.join(root,'outside.txt'),'utf8'),'OUTSIDE');assert.equal(receiptCallbacks,3);assert.ok(observedActions.includes('workspace.write'));const receipts=store.read().receipts.filter(x=>x.runId===r.runId);assert.equal(receipts.length,3);const inspected=bridge.inspectReceipt(r.runId,receipts[0].receipt.operationId);assert.equal(inspected.status,'completed');assert.equal(JSON.stringify(inspected).includes('before'),true);assert.equal(Object.hasOwn(inspected,'text'),false);assert.ok(result.projection.turnItems.some(x=>x.type==='dynamic_tool'));assert.equal(JSON.stringify(requests).includes('guarded-file-broker'),false);mode='complete';});
    await t.test('actual Stop interrupts held native turn without persisted PID kill/replay',async()=>{mode='hold';let observed;const held=new Promise(r=>{observed=r;});holdObserved=observed;const r=await reserve(input());await bridge.launch(r.runId,{message:'Held request fixture'});await held;await waitFor(r.runId,r=>r.projection?.providerTurn);const before=requests.length,[result,alsoStopped]=await Promise.all([bridge.stop(r.runId),bridge.stop(r.runId)]);assert.equal(alsoStopped.status,result.status);assert.equal(result.status,'interrupted');assert.equal(result.projection.terminal.status,'interrupted');assert.equal(result.live,false);assert.equal(requests.length,before);mode='complete';});
    await t.test('current route, workspace, context, owner and policy changes deny before bind',async()=>{for(const mutate of [s=>{s.runs.at(-1).workspace=path.join(root,'other');},s=>{s.runs.at(-1).guardedContext.profile.contextDigest='c'.repeat(64);},s=>{s.runs.at(-1).stopRequest={};}]){const r=await reserve(input());await store.transaction(mutate);await assert.rejects(bridge.launch(r.runId,{message:'must not send'}));}const r=await reserve(input());selected.policyGeneration='2';await assert.rejects(bridge.launch(r.runId,{message:'must not send'}));selected.policyGeneration='1';});
    await t.test('restart metadata never recreates leases or redispatches',async()=>{const r=await reserve(input());await store.transaction(s=>{const prior=s.runs.find(x=>x.id===r.runId);s.runs.push({...structuredClone(prior),id:'lost-lease',attemptId:'lost-attempt',threadId:'lost-thread',rootNodeId:'lost-node',operationId:'lost-operation'});});const before=requests.length;assert.deepEqual(await bridge.recover(),['lost-lease']);await assert.rejects(bridge.launch('lost-lease',{message:'never'}),{code:'GUARDED_PRIVATE_LEASE_REQUIRED'});assert.equal(bridge.reconcile('lost-lease').status,'unknown');assert.deepEqual(await bridge.recover(),[]);assert.equal(requests.length,before);await bridge.stop(r.runId);});
    assert.equal(JSON.stringify(store.read()).includes('PRIVATE_FIXTURE_KEY'),false);
    assert.equal(JSON.stringify(store.read()).includes('EARLY_UNPREPARED_SENTINEL'),false);
    t.diagnostic(JSON.stringify({node:process.versions.node,providerRequests:requests.length,nativeExternalRequests:0,actualBrokerReceiptCallbacks:receiptCallbacks,actualCompiledEntry:entry}));
  }finally{await bridge.close();await store.close();globalThis.fetch=realFetch;model.closeAllConnections();await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});}
});
