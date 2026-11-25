// Actual private compiled T3/OpenCode + Windows broker and model egress gateway.
// Canonical admission fixture, deterministic loopback model protocol ONLY.
// These engineering results do not mint production Research qualification.
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
import {openResearchModelGateway} from '../app/research-native/model-gateway.mjs';
import {digest,bytesDigest} from '../app/guarded-runtime/profile.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-guarded-timeout30s-20261125');
const entry=path.join(cache,'t3/apps/server/dist/forge-guarded-host.mjs');
test('actual compiled private runtime consumes bounded Research egress', {skip:!existsSync(entry)&&'qualified native cache not installed',timeout:480000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-research-native-')),workspace=path.join(root,'workspace'),dataDir=path.join(root,'data');
  await mkdir(workspace);await writeFile(path.join(workspace,'output.json'),'');await writeFile(path.join(root,'outside.json'),'OUTSIDE');
  const files=(await readdir(path.dirname(entry))).filter(n=>n.endsWith('.mjs')).map(name=>({name,path:path.join(path.dirname(entry),name)}));files.push({name:'node.exe',path:process.execPath});
  const artifacts={t3:{entry,files},opencode:{path:path.join(cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe')},fileBroker:{path:path.join(cache,'windows/ConfinedText.exe'),sha256:bytesDigest(readFileSync(path.join(cache,'windows/ConfinedText.exe')))}};
  const selected={route:{providerInstanceId:'fixture',apiProviderId:'openai',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'openai/forge-fixture',options:[{id:'variant',value:'default'}],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:digest(files.map(f=>({name:f.name,sha256:bytesDigest(readFileSync(f.path))})).sort((a,b)=>a.name.localeCompare(b.name))),opencodeBinarySha256:bytesDigest(readFileSync(artifacts.opencode.path))},policyGeneration:'1',toolGeneration:'1'};
  const expected='[{"key":"a","total":5}]';let mode='edit',limit=3,calls=0,receipts=0,actionLimit=3;
  const bodies=[],gateways=[],byRun=new Map(),deadlines=new Map(),nativePhases=new Map();let pending;
  const realFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1','fixture forbids external requests');try{return await realFetch(url,options);}catch(e){t.diagnostic('FAILED private endpoint '+new URL(url).pathname+' '+e.name);throw e;}};
  const model=createServer(async(req,res)=>{
    calls++;let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);bodies.push(body);
    if(mode==='error'){res.writeHead(503);res.end('isolated injected error');return;}
    const count=body.messages.filter(m=>m.role==='tool').length;
    const tool=mode==='edit'?(count===0?['forge_guarded_edit_text',{path:'output.json',expectedRevision:bytesDigest(''),text:expected}]:null):count===0?['forge_guarded_read_text',{path:'output.json'}]:count===1?['forge_guarded_edit_text',{path:'output.json',expectedRevision:bytesDigest(''),text:expected}]:null;
    const toolCalls=mode==='batch'&&count===0?[{index:0,id:'read',type:'function',function:{name:'forge_guarded_read_text',arguments:JSON.stringify({path:'output.json'})}},{index:1,id:'edit',type:'function',function:{name:'forge_guarded_edit_text',arguments:JSON.stringify({path:'output.json',expectedRevision:bytesDigest(''),text:expected})}}]:null;
    const delta=tool?{role:'assistant',tool_calls:toolCalls??[{index:0,id:'fixture_'+count,type:'function',function:{name:tool[0],arguments:JSON.stringify(tool[1])}}]}:{role:'assistant',content:'done'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n');
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const store=await openStore(dataDir);await store.transaction(s=>s.projects.push({id:'project',workspace,profile:{fixture:true}}));
  const bridge=createGuardedExecutionBridge({store,dataDir,artifacts,authorizeOwner:()=>true,observeSelectedRoute:()=>structuredClone(selected),
    resolveProvider:async()=>{
      let attempts=0;const maxSteps=limit;
      const g=await openResearchModelGateway({provider:{id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'NO_ACCOUNT',transport:'http'}},
        withFence:(_id,fn)=>store.transaction(fn),
        authorizeRequest:({runId,attemptId,priorAttempts})=>{const r=store.read().runs.find(r=>r.id===runId);if(!r||r.attemptId!==attemptId||r.stopRequest)throw Error('INJECTED_OWNER_DENIAL');assert.equal(priorAttempts,attempts);attempts++;return {deadlineAt:deadlines.get(runId),maxSteps,requestDigest:digest({runId,attemptId})};},onFailure:()=>{},
      });pending=g;gateways.push(g);return {provider:g.provider,credentialRef:'fixture',accountGeneration:'no-account'};
    },
    validateAdmission:(s,{run,stage,capability,path:actionPath})=>{assert.equal(s.runs.find(r=>r.id===run.id),run);if(stage==='send'&&!deadlines.has(run.id))deadlines.set(run.id,Date.now()+30000);if(stage==='action'){assert.equal(actionPath,'output.json');assert.ok(['read','workspace.write'].includes(capability));}return true;},
    onNativePhase:(s,{run,body})=>{const p=nativePhases.get(run.id)??[];nativePhases.set(run.id,p);if(body.phase==='model-request'&&p.filter(x=>x==='model-request').length>=limit)return false;p.push(body.phase);return true;},
    onBeforeAction:(s,{priorOperations})=>{if(priorOperations.length>=actionLimit)throw Object.assign(new Error('INJECTED_RESOURCE_LIMIT'),{code:'RESOURCE_LIMIT'});},
    onReceipt:()=>{receipts++;},onEvent:(s,{run,event})=>{if(event.type==='provider_turn.updated'&&event.providerTurn.status==='running')run.status='running';if(event.type==='turn.terminal')run.status=event.status;},
  });
  const reserve=async()=>{
    const input={projectId:'project',taskId:'task',operationId:randomUUID(),workspace,message:'Unprepared fixture task',request:{projectId:'project',taskId:'task',envelopeDigest:'a'.repeat(64),identitySnapshot:'b'.repeat(64),scope:{paths:['output.json'],capabilities:['read','propose','workspace.write']},limits:{maxRunMs:300000,maxTokens:null,maxCost:null}}};
    const prepared=await bridge.prepare(input),g=pending;
    const metadata=await store.transaction(s=>{const run={id:randomUUID(),projectId:'project',taskId:'task',operationId:input.operationId,status:'submitting',attemptId:randomUUID(),threadId:randomUUID(),rootNodeId:randomUUID(),workspace,selection:{instanceId:'fixture',model:'openai/forge-fixture',options:selected.route.options}};s.runs.push(run);return bridge.reserve(s,{run,input,prepared});});
    g.bind({runId:metadata.runId,attemptId:metadata.attemptId});byRun.set(metadata.runId,g);return metadata;
  };
  const waitForTerminal=id=>new Promise((resolve,reject)=>{let unsub=()=>{};const timer=setTimeout(()=>{unsub();reject(new Error('native terminal timeout'));},90000);const check=()=>{const r=bridge.reconcile(id);if(r.projection?.terminal){clearTimeout(timer);unsub();resolve(r);}};unsub=store.subscribe(check);check();});
  try{
    const checked=await bridge.check({projectId:'project',leaseMs:600000});assert.equal(checked.negativeCount,17);assert.equal(calls,0);
    await t.test('one real canonical run edits existing output through private Windows broker',async()=>{
      const r=await reserve();await bridge.launch(r.runId,{message:'Isolated engineering DATA [{"key":"a","value":2},{"key":"a","value":3}]. Aggregate to existing output.json.'});const result=await waitForTerminal(r.runId);
      if(result.status!=='completed')process.stderr.write(JSON.stringify({terminal:result.projection.terminal,gateway:byRun.get(r.runId).snapshot()})+'\n');
      assert.equal(result.status,'completed',JSON.stringify({terminal:result.projection.terminal,gateway:byRun.get(r.runId).snapshot()}));assert.equal(calls,2);assert.equal(receipts,1);assert.equal(await readFile(path.join(workspace,'output.json'),'utf8'),expected);assert.equal(await readFile(path.join(root,'outside.json'),'utf8'),'OUTSIDE');assert.equal(byRun.get(r.runId).snapshot().attempts,2);assert.equal(result.projection.providerTurn.runAttemptId,r.attemptId);assert.deepEqual([...new Set(bodies.flatMap(b=>b.tools.map(t=>t.function.name)))].sort(),['forge_guarded_edit_text','forge_guarded_propose_change','forge_guarded_read_text']);
    });
    await t.test('actual native continuation beyond maxSteps cannot reach upstream or edit output',async()=>{
      await writeFile(path.join(workspace,'output.json'),'');mode='tools';limit=1;const before=calls,r=await reserve();await bridge.launch(r.runId,{message:'Resource bound fixture'});await waitForTerminal(r.runId);assert.equal(calls-before,1);assert.equal(byRun.get(r.runId).snapshot().attempts,1);assert.equal(await readFile(path.join(workspace,'output.json'),'utf8'),'');
    });
    await t.test('native batch cannot exceed actual durable action budget',async()=>{
      mode='batch';limit=3;actionLimit=1;const beforeReceipts=receipts;const r=await reserve();await bridge.launch(r.runId,{message:'Batched action budget fixture'});await waitForTerminal(r.runId);assert.equal(receipts-beforeReceipts,1);assert.equal(await readFile(path.join(workspace,'output.json'),'utf8'),'');assert.equal(bridge.inspectOperations(r.runId).length,1);actionLimit=3;
    });
    await t.test('native upstream retry after 503 cannot make a second provider request',async()=>{
      mode='error';limit=3;const before=calls,r=await reserve();await bridge.launch(r.runId,{message:'Retry bound fixture'});await waitForTerminal(r.runId);assert.equal(calls-before,1);assert.equal(byRun.get(r.runId).snapshot().failed,true);assert.equal(byRun.get(r.runId).snapshot().attempts,1);
    });
    assert.ok([...nativePhases.values()].some(p=>p.includes('model-request')&&p.includes('executor')));
    t.diagnostic(JSON.stringify({node:process.versions.node,loopbackModelRequests:calls,actualBrokerReceipts:receipts,nativePreparedRequests:[...nativePhases.values()].map(p=>p.filter(x=>x==='model-request').length),t3Sha256:selected.route.t3BinarySha256,opencodeSha256:selected.route.opencodeBinarySha256,productionResearchProof:null,externalProviderTurns:0}));
  }finally{await bridge.close();await Promise.all(gateways.map(g=>g.close()));await store.close();globalThis.fetch=realFetch;model.closeAllConnections();await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});}
});
