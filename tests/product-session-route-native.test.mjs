// Actual mounted application + private T3/OpenCode parent + SDK + canonical
// Conversation owner. Child transport/catalog/account responses are injected;
// this does not qualify an external child provider or model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';
import {digest,source} from '../app/providers/common.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-frontend-generation-Vmhthl');
test('mounted Owner-approved orchestrator calls an existing child through the real Conversation boundary in the same native parent turn',{timeout:480000,skip:process.env.FORGE_RUN_SESSION_NATIVE!=='1'?'opt-in actual native qualification':!existsSync(path.join(cache,'session-patches.json'))&&'session-capable generation unavailable'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-product-session-native-')),workspace=path.join(dir,'workspace');await mkdir(workspace);await writeFile(path.join(workspace,'README.md'),'Disposable native session fixture\n');
  let requests=0;const bodies=[];
  const model=createServer(async(req,res)=>{try{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);bodies.push(body);requests++;
    assert.deepEqual(body.tools.map(t=>t.function.name).sort(),['forge_sessions_session_children','forge_sessions_session_prompt']);
    const replies=body.messages.filter(m=>m.role==='tool');let call;
    if(!replies.length)call={name:'forge_sessions_session_children',args:{}};
    else if(replies.length===1){const value=JSON.parse(replies[0].content);assert.equal(value.children.length,1);call={name:'forge_sessions_session_prompt',args:{membershipId:value.children[0].membershipId,operationId:'native-parent-child-once',text:'Review this bounded engineering fixture and report evidence.'}};}
    else {const value=JSON.parse(replies.at(-1).content);assert.equal(value.childRun.status,'running');assert.ok(value.childRun.providerRunId);}
    const delta=call?{role:'assistant',tool_calls:[{index:0,id:`native-session-call-${requests}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{role:'assistant',content:'Child review received through the canonical session owner.'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const chunk of [{delta,finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,...chunk}]})+'\n\n');res.end('data: [DONE]\n\n');
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{model.closeAllConnections();model.close(r);}));
  const app=await createApplication({dataDir:path.join(dir,'data'),machineSecretDir:path.join(dir,'machine'),guardedArtifactOptions:{approvedCache:cache}});t.after(()=>app.close());
  const envName='FORGE_SESSION_FIXTURE_'+crypto.randomUUID().replaceAll('-','');process.env[envName]='INJECTED_NOT_LIVE';t.after(()=>delete process.env[envName]);
  const p=entity({name:'Actual native parent; injected child transport',workspace,profile:{}}),plan=entity({name:'Approved session coordination',approved:true},p.id),bot=entity({name:'Coordinator',kind:'resident',status:'active'},p.id),childBot=entity({name:'Reviewer',kind:'resident',status:'active'},p.id),task=entity({title:'Coordinate the approved child review',description:'Use session_children and session_prompt only. Do not modify files.',planId:plan.id,botId:bot.id,status:'ready',runIds:[],dependsOn:[],evidence:[],artifactIds:[]},p.id);
  const parent=entity({name:'Coordinator session',kind:'private',botId:bot.id,messages:[]},p.id),child=entity({name:'Bound reviewer session',kind:'private',botId:childBot.id,messages:[]},p.id);
  const c=entity({name:'Loopback engineering model',kind:'provider',enabled:true,providerInstanceId:'forge_session_fixture',config:{routeId:'custom-api',accountRoute:'machine-env-api-key',generation:1,envRefs:[envName],apiKeyEnv:envName,setupStatus:'configured'},lastCheck:{version:'2.4.1',providerInstanceId:'forge_session_fixture',installed:true,enabled:true,authentication:'authenticated',status:'ready',checkedAt:Date.now()}},p.id);
  c.providerCatalog={providerInstanceId:c.providerInstanceId,identityKey:digest([c.providerInstanceId,1,c.config.routeId,c.config.accountRoute,source]),models:[{id:'forge/fixture-model',options:[]}],catalogComplete:true,stale:false,canRunChildTask:true,runtimeModes:['approval-required'],omittedModels:0,observedAt:Date.now()};p.profile.provider={instanceId:c.providerInstanceId,connectionId:c.id,connectionGeneration:1,model:'forge/fixture-model',options:[]};
  child.bindings={[childBot.id]:{botId:childBot.id,threadId:'injected-child-thread',t3ProjectId:'injected-child-project',selection:{instanceId:c.providerInstanceId,model:'forge/fixture-model',options:[]}}};
  await app.store.transaction(s=>{s.projects.push(p);s.plans.push(plan);s.bots.push(bot,childBot);s.tasks.push(task);s.conversations.push(parent,child);s.connections.push(c);});
  // The fixture seeds catalog/project records directly. Provision the SAME
  // builtin bindings that production project.create initializes before an
  // intent is approved; first-start setup must not change its pinned policy.
  for(const capability of ['models','provider','mcp','skills','environment','desktop','browser'])await app.plugins.enable({projectId:p.id,pluginId:'forge.'+capability,expectedRevision:0,operationId:`builtin-default:${p.id}:forge.${capability}`});
  const configDir=path.join(dir,'data/providers',c.providerInstanceId,'config/opencode');await mkdir(configDir,{recursive:true});await writeFile(path.join(configDir,'opencode.json'),JSON.stringify({providers:{forge:{package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:`{env:${envName}}`},models:{'fixture-model':{modelID:'fixture-model'}}}}}));
  // These replace ONLY the ordinary child transport. Parent T3 adapter/native
  // execution, live attestation, SDK attachment and all domain guards are real.
  let childSends=0,childPrompt;
  app.t3.providers.assertEnvironment=async()=>{};app.t3.providers.ensureProject=async()=>({id:'injected-child-project'});
  app.t3.providers.call=async(tag,input)=>{
    if(tag==='t3_thread_read')return {thread:{threadId:'injected-child-thread',projectId:'injected-child-project',providerInstanceId:c.providerInstanceId,runtimeMode:'approval-required'},items:[]};
    assert.equal(tag,'t3_thread_send');assert.equal(input.threadId,'injected-child-thread');childSends++;childPrompt=input.message;return {threadId:input.threadId,runId:'injected-child-native-run',status:'running'};
  };
  app.t3.observe=async()=>{};
  const response=await fetch(app.url+'/api/session'),session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const post=async(route,input)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':session.csrf},body:JSON.stringify(input)}),value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  const until=async(fn,limit=240000)=>{const end=Date.now()+limit;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Native session timeout: '+JSON.stringify(app.store.read().runs.map(r=>({status:r.status,error:r.error,dispatch:r.guardedDispatch}))));};
  await post('/api/session-roles/assign',{projectId:p.id,operationId:crypto.randomUUID(),conversationId:parent.id,botId:bot.id,role:'orchestrator',expectedRevision:0});
  await post('/api/session-roles/assign',{projectId:p.id,operationId:crypto.randomUUID(),conversationId:child.id,botId:childBot.id,role:'reviewer',expectedRevision:0});
  await post('/api/guarded/install',{projectId:p.id,operationId:crypto.randomUUID()});await until(async()=>{const value=await post('/api/guarded/state',{projectId:p.id});assert.notEqual(value.installation.status,'failed',JSON.stringify(value));return value.installation.status==='ready';});
  await post('/api/guarded/check',{projectId:p.id,operationId:crypto.randomUUID(),leaseMs:900000});assert.equal(requests,0);
  const intent=await post('/api/session-orchestrator/intent',{projectId:p.id,taskId:task.id,conversationId:parent.id,children:[{conversationId:child.id,botId:childBot.id}],operationId:crypto.randomUUID()});
  const started=await post('/api/session-orchestrator/start',{projectId:p.id,intentId:intent.intentId,operationId:intent.operationId});
  const run=await until(()=>{const r=app.store.read().runs.find(r=>r.id===started.runId);if(r&&['failed','unknown'].includes(r.status))throw Error(JSON.stringify(r));return r?.terminalEvent?r:null;});
  assert.equal(run.status,'completed');assert.equal(run.sessionRole.role,'orchestrator');assert.equal(run.guardedContext.profile.purpose,'supervised-orchestrator-v1');assert.equal(run.providerRunId,undefined);assert.equal(run.nativeTurnRef.strength,'weak');assert.equal(childSends,1);assert.ok(childPrompt.includes('Session working role: reviewer.'));
  const s=app.store.read(),commands=s.events.filter(e=>e.type==='session-role.prompt');assert.equal(commands.length,1);assert.equal(s.runs.length,2);assert.equal(s.receipts.filter(r=>r.type==='guarded.file-receipt').length,0);
  assert.equal(run.guardedProjection.turnItems.some(i=>i.status==='failed'),false);assert.equal(requests,3);assert.ok(bodies.at(-1).messages.some(m=>m.role==='tool'&&m.content.includes('injected-child-native-run')));
  const replay=await post('/api/session-orchestrator/start',{projectId:p.id,intentId:intent.intentId,operationId:intent.operationId});assert.equal(replay.runId,run.id);assert.equal(childSends,1);
  t.diagnostic(JSON.stringify({directory:dir,nativeParentProtocolRequests:requests,externalProviderRequests:0,childTransport:'INJECTED_NOT_LIVE',childSends,parentRun:run.id,childRun:s.runs.find(r=>r.kind==='conversation').id}));
});
