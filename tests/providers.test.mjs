import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createProviderService } from '../app/providers/service.mjs';
import { openT3ProviderChannel } from '../app/providers/t3-setup-rpc.mjs';

// Labelled T3 0.1.11 contract fixture, not a live provider account. Field names
// follow pinned orchestratorMcp.ts/providerSetup.ts/rpc.ts. Native lead-owned
// AG-UI subscription integration is separately qualified in the integrated tree.
function t3Fixture(store){
  const instances=new Map(),threads=new Map(),calls=[];let ordinal=0;
  const fixture={instances,threads,calls,holdCatalog:null,catalogError:null,loseLaunch:false,loseSend:false,failAuth:false,version:'2.2.5',
    async catalog(){if(fixture.holdCatalog)await fixture.holdCatalog;if(fixture.catalogError)throw fixture.catalogError;return {providers:[...instances].map(([providerInstanceId,i])=>({providerInstanceId,driverKind:i.driver,displayName:i.displayName,canRunChildTask:true,models:[{id:'fixture-model',options:[{id:'effort',values:['high','xhigh']}]}],constraints:[]}))};},
    providers:{
      async ensureProject(projectId){return {id:`native-${projectId}`};},
      async rpc(tag,input){calls.push({tag,input:structuredClone(input)});
        if(fixture.failAuth)throw new Error('401 bearer secret-test-token https://private/?code=secret');
        if(tag==='server.updateSettings'){const m=input.providerInstanceMutation;assert.equal(m.operation,'create');assert.equal(instances.has(m.instanceId),false);instances.set(m.instanceId,m.instance);return {};}
        if(tag==='server.refreshProviders')return {providers:[...instances].map(([instanceId,i])=>({instanceId,driver:i.driver,installed:true,enabled:true,version:fixture.version,status:'ready',auth:{status:'authenticated'},setup:{canInstall:true,canAuthenticate:true}}))};
        if(tag.startsWith('provider.auth.'))return {instanceId:input.instanceId,phase:'waiting',flowId:'flow-fixture',methods:[{id:'browser',name:'Browser',accountEmail:'never-persist@example.test'}],interaction:{type:'browser',id:'consent',url:'https://fixture.invalid/oauth?code=transient-test-code',requiresConsent:true}};
        if(tag.startsWith('provider.install.'))return {phase:'ready',operationId:'install-fixture'};
        throw new Error('Unsupported RPC fixture');
      },
      async call(tag,input){calls.push({tag,input:structuredClone(input)});
        if(tag==='t3_thread_launch'){
          const threadId=`fixture-thread-${++ordinal}`,runId=`fixture-run-${ordinal}`;
          threads.set(threadId,{thread:{threadId,projectId:input.projectId,title:input.title,providerInstanceId:input.modelSelection.instanceId,model:input.modelSelection.model,runtimeMode:input.runtimeMode,status:'running'},recentRuns:[{runId,status:'running',model:input.modelSelection.model}],items:[{itemId:`user-${ordinal}`,position:0,type:'user_message',sourceThreadId:threadId,runId,text:input.message,status:'completed'}]});
          if(fixture.loseLaunch)throw new Error('Connection lost after accepted turn');
          return {projectId:input.projectId,threadId,runId,status:'running'};
        }
        if(tag==='t3_thread_send'){
          const t=threads.get(input.threadId),runId=`fixture-run-${++ordinal}`;t.recentRuns.unshift({runId,status:'running'});t.items.push({itemId:`user-${ordinal}`,position:t.items.length,type:'user_message',sourceThreadId:input.threadId,runId,text:input.message,status:'completed'});
          if(fixture.loseSend)throw new Error('Connection lost after accepted message');return {threadId:input.threadId,runId,status:'running'};
        }
        if(tag==='t3_thread_list')return {threads:[...threads.values()].map(t=>t.thread)};
        if(tag==='t3_thread_read'){const t=threads.get(input.threadId);assert.ok(t);return structuredClone({...t,hasMore:false,nextPosition:t.items.length-1});}
        throw new Error('Unsupported MCP fixture');
      },
    },
    async stop(id){const r=store.read().runs.find(r=>r.id===id);calls.push({tag:'native-stop',input:{threadId:r.threadId,runId:r.providerRunId}});if(fixture.stopUnknown)throw new Error('timeout stopping');fixture.complete(r.threadId,r.providerRunId,'interrupted');await store.transaction(s=>{s.runs.find(x=>x.id===id).status='interrupted';});},
    complete(threadId,runId,status='completed',text='Observed fixture assistant'){
      const thread=threads.get(threadId);thread.recentRuns.find(r=>r.runId===runId).status=status;thread.thread.status=status;
      if(text)thread.items.push({itemId:`assistant-${runId}`,position:thread.items.length,type:'assistant_message',sourceThreadId:threadId,runId,text,status:'completed'});
    },
  };return fixture;
}
async function harness(t){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-providers-contract-fixture-'));let store=await openStore(dataDir);
  const t3=t3Fixture(store),api=createProviderService({dataDir,store,t3,catalogTimeoutMs:5});
  t.after(async()=>{await api.close();await store.close();});
  const create=async(type,projectId,data)=> (await command(store,{operationId:randomUUID(),type,projectId,data})).entity;
  const p=await create('project.create',null,{name:'Fixture P1',workspace:path.join(dataDir,'workspace1')});
  const q=await create('project.create',null,{name:'Fixture P2',workspace:path.join(dataDir,'workspace2')});
  const bot=await create('bot.create',p.id,{name:'Resident',kind:'resident',role:'Advisor'}),other=await create('bot.create',p.id,{name:'Other',kind:'resident'}),foreign=await create('bot.create',q.id,{name:'Foreign',kind:'resident'});
  const privateChat=await create('conversation.create',p.id,{name:'Private',kind:'private',botId:bot.id}),team=await create('conversation.create',p.id,{name:'Team',kind:'team'}),foreignChat=await create('conversation.create',q.id,{name:'Foreign',kind:'private',botId:foreign.id});
  const config={operationId:randomUUID(),projectId:p.id,routeId:'codex-local'};const connection=await api.configure(config);const context={projectId:p.id,connectionId:connection.id};await api.refresh(context);
  const selection={instanceId:connection.providerInstanceId,model:'fixture-model',options:[{id:'effort',value:'xhigh'}]};await api.select({...context,operationId:randomUUID(),expectedRevision:store.read().projects[0].revision,selection});
  const input={operationId:randomUUID(),projectId:p.id,conversationId:privateChat.id,botId:bot.id,text:'Private fixture advice'};
  const reopen=async()=>{await api.close();await store.close();store=await openStore(dataDir);return store;};
  return {dataDir,store,t3,api,create,p,q,bot,other,foreign,privateChat,foreignChat,team,connection,context,config,selection,input,reopen};
}

test('setup uses isolated T3 instance, safe homes, executable actions and no credential readback',async t=>{
  const h=await harness(t);const {api,t3,config,connection,context,store}=h;
  assert.equal((await api.configure(config)).id,connection.id);assert.equal(t3.calls.filter(c=>c.tag==='server.updateSettings').length,1);
  const native=t3.instances.get(connection.providerInstanceId);assert.equal(native.driver,'codex');assert.equal(native.config.setupMode,'existing');assert.ok(native.config.homePath.startsWith(h.dataDir));assert.equal(native.config.shadowHomePath,undefined);
  assert.ok(native.environment.every(e=>e.value.startsWith(h.dataDir)));assert.equal((await api.check(context)).authentication,'authenticated');
  const auth=await api.setup({...context,operationId:'sign-in',action:'signin'});assert.equal(auth.interaction.requiresConsent,true);assert.match(auth.interaction.url,/transient-test-code/);
  await api.setup({...context,operationId:'consent',action:'consent',flowId:auth.flowId,interactionId:auth.interaction.id,decision:'accept'});
  assert.equal((await api.setup({...context,operationId:'install',action:'install'})).phase,'ready');
  assert.equal((await api.setup({...context,operationId:'install',action:'install'})).status,'already-submitted');
  assert.doesNotMatch(JSON.stringify(store.read()),/transient-test-code|never-persist/);
  t3.failAuth=true;assert.equal((await api.check(context)).error.code,'AUTH_REQUIRED');assert.doesNotMatch(JSON.stringify(store.read()),/secret-test-token|private\/\?code/);
  await assert.rejects(api.configure({...config,operationId:'other',apiKey:'forbidden'}),{code:'SETUP_INPUT'});
  await assert.rejects(api.configure({...config,operationId:'kob',routeId:'kob'}),{code:'KOB_SECRET_REFERENCE'});
});

test('OpenCode API setup emits actual v2 config, native OpenRouter package, explicit custom protocol/model IDs',async t=>{
  const h=await harness(t),{api,p,t3}=h;
  const c=await api.configure({operationId:'router',projectId:p.id,routeId:'openrouter',apiKeyEnv:'FIXTURE_OPENROUTER_KEY'});
  const file=path.join(h.dataDir,'providers',c.providerInstanceId,'config','opencode','opencode.json');const config=JSON.parse(await readFile(file,'utf8'));
  assert.equal(config.providers.openrouter.package,'@opencode/ai/providers/openrouter');assert.equal(config.providers.openrouter.settings.apiKey,'{env:FIXTURE_OPENROUTER_KEY}');
  const c2=await api.configure({operationId:'custom',projectId:p.id,routeId:'custom-api',apiKeyEnv:'FIXTURE_API_KEY',baseURL:'http://127.0.0.1:43210/v1',apiFamily:'responses',models:['exact-upstream-model']});
  const config2=JSON.parse(await readFile(path.join(h.dataDir,'providers',c2.providerInstanceId,'config','opencode','opencode.json'),'utf8'));
  assert.equal(config2.providers.forge.package,'@opencode/ai/providers/openai-compatible/responses');assert.equal(config2.providers.forge.models['exact-upstream-model'].modelID,'exact-upstream-model');
  t3.version='1.2.0';assert.equal((await api.check({projectId:p.id,connectionId:c.id})).status,'unsupported-version');
  assert.throws(()=>api.validateSelection({projectId:p.id,connectionId:c.id,selection:{instanceId:c.providerInstanceId,model:'made-up'}}),{code:'OPENCODE_VERSION'});
  await assert.rejects(api.configure({operationId:'qwen',projectId:p.id,routeId:'qwen-api',apiKeyEnv:'KEY',models:['model']}),{code:'VALIDATION'});
});

test('catalog retains late/failing results, deduplicates refresh and validates exact model options',async t=>{
  const {api,t3,context,selection,store}=await harness(t);
  let resolve;t3.holdCatalog=new Promise(r=>resolve=r);const before=t3.calls.length;
  await Promise.all([api.refresh(context),api.refresh(context)]);assert.equal(api.catalog(context).refreshing,true);
  assert.equal(t3.calls.slice(before).filter(c=>c.tag==='server.refreshProviders').length,1);assert.equal(api.validateSelection({...context,selection}).model,'fixture-model');
  resolve();t3.holdCatalog=null;await api.settle();assert.equal(api.catalog(context).refreshing,false);
  t3.catalogError=new Error('401 raw-bearer-value');await api.refresh(context);assert.equal(api.catalog(context).error.code,'AUTH_REQUIRED');assert.ok(api.catalog(context).catalog.models.length);assert.doesNotMatch(JSON.stringify(store.read()),/raw-bearer/);
  assert.throws(()=>api.validateSelection({...context,selection}),{code:'CATALOG_STALE'});
  t3.catalogError=null;await api.refresh(context);await api.settle();
  assert.throws(()=>api.validateSelection({...context,selection:{...selection,instanceId:'wrong'}}),{code:'PROVIDER_IDENTITY'});
  assert.throws(()=>api.validateSelection({...context,selection:{...selection,model:'gpt-6.2-made-up'}}),{code:'MODEL_UNVERIFIED'});
  assert.throws(()=>api.validateSelection({...context,selection:{...selection,options:[{id:'universalReasoning',value:'xhigh'}]}}),{code:'MODEL_OPTIONS'});
  assert.throws(()=>api.validateSelection({...context,selection:{...selection,options:[{id:'effort',value:'invented'}]}}),{code:'MODEL_OPTIONS'});
});

test('catalog ignores result from a superseded provider/account generation',async t=>{
  const {api,t3,context,store,connection}=await harness(t);const old=api.catalog(context).catalog;let resolve;t3.holdCatalog=new Promise(r=>resolve=r);await api.refresh(context);
  await store.transaction(s=>{const c=s.connections.find(c=>c.id===connection.id);c.config.generation++;c.providerInstanceId='changed-instance';});
  resolve();t3.holdCatalog=null;await api.settle();assert.deepEqual(api.catalog(context).catalog,old);
  assert.throws(()=>api.validateSelection({...context,selection:{instanceId:'changed-instance',model:'fixture-model'}}),{code:'DISCOVER_FIRST'});
});

test('two projects, private/team bot isolation, actual T3 identities and idempotent turns',async t=>{
  const h=await harness(t),{api,t3,input,p,q,other,foreign,foreignChat,team,store}=h;
  await assert.rejects(api.conversations.send({...input,projectId:q.id}),{code:'NOT_FOUND'});
  await assert.rejects(api.conversations.send({...input,operationId:'wrong-bot',botId:other.id}),{code:'PRIVATE_SCOPE'});
  await assert.rejects(api.conversations.send({...input,operationId:'foreign-bot',botId:foreign.id}),{code:'NOT_FOUND'});
  await assert.rejects(api.conversations.send({...input,operationId:'foreign-chat',conversationId:foreignChat.id}),{code:'NOT_FOUND'});
  const [r,replay]=await Promise.all([api.conversations.send(input),api.conversations.send(input)]);assert.equal(r.id,replay.id);assert.equal(t3.calls.filter(c=>c.tag==='t3_thread_launch').length,1);
  assert.equal(r.kind,'conversation');assert.ok(r.attemptId);assert.ok(r.providerRunId);assert.equal(r.t3ProjectId,`native-${p.id}`);assert.equal(r.botId,input.botId);assert.equal(r.operationId,input.operationId);
  const request=t3.calls.find(c=>c.tag==='t3_thread_launch').input;assert.equal(request.runtimeMode,'approval-required');assert.equal(request.interactionMode,'default');assert.match(request.message,/advice/);
  assert.equal(store.read().conversations.find(c=>c.id===input.conversationId).messages.filter(m=>m.role==='assistant').length,0);
  await assert.rejects(api.conversations.send({...input,text:'changed'}),{code:'OPERATION_REUSE'});
  await assert.rejects(api.conversations.send({...input,operationId:'busy',conversationId:team.id,botId:other.id}),{code:'WORKSPACE_BUSY'});
  t3.complete(r.threadId,r.providerRunId);await api.conversations.reconcile({projectId:p.id,runId:r.id});
  const message=store.read().conversations.find(c=>c.id===input.conversationId).messages.find(m=>m.role==='assistant');assert.equal(message.source,'T3-observed');assert.equal(message.runId,r.id);assert.equal(message.attemptId,r.attemptId);
  const teamRun=await api.conversations.send({...input,operationId:'team',conversationId:team.id,botId:other.id,text:'Team fixture advice'});assert.notEqual(teamRun.threadId,r.threadId);
  const teamPrompt=t3.calls.filter(c=>c.tag==='t3_thread_launch').at(-1).input.message;assert.doesNotMatch(teamPrompt,/Private fixture advice/);
  await assert.rejects(api.conversations.stop({projectId:q.id,runId:teamRun.id}),{code:'NOT_FOUND'});
  t3.complete(teamRun.threadId,teamRun.providerRunId);await api.conversations.reconcile({projectId:p.id,runId:teamRun.id});
  const teammate=await api.conversations.send({...input,operationId:'teammate',conversationId:team.id,text:'Another team bot contributes'});
  t3.complete(teammate.threadId,teammate.providerRunId,'completed','Another bot’s observed team result');await api.conversations.reconcile({projectId:p.id,runId:teammate.id});
  const continued=await api.conversations.send({...input,operationId:'team-follow-up',conversationId:team.id,botId:other.id,text:'Discuss the room result'});assert.equal(continued.threadId,teamRun.threadId);
  const followUp=t3.calls.filter(c=>c.tag==='t3_thread_send').at(-1).input.message;assert.match(followUp,/Another bot’s observed team result/);assert.doesNotMatch(followUp,/Private fixture advice/);
});

test('uncertain launch and send reconcile existing requests after restart without redispatch',async t=>{
  const h=await harness(t),{api,t3,input,p,store}=h;t3.loseLaunch=true;
  const r=await api.conversations.send(input);assert.equal(r.status,'unknown');assert.equal(r.threadId,undefined);
  await api.conversations.recover();const recovered=await api.conversations.reconcile({projectId:p.id,runId:r.id});assert.ok(recovered.threadId);assert.ok(recovered.providerRunId);
  assert.equal((await api.conversations.send(input)).id,r.id);assert.equal(t3.calls.filter(c=>c.tag==='t3_thread_launch').length,1);
  t3.complete(recovered.threadId,recovered.providerRunId);await api.conversations.reconcile({projectId:p.id,runId:r.id});t3.loseLaunch=false;t3.loseSend=true;
  const second=await api.conversations.send({...input,operationId:'send-reply',text:'Follow-up'});assert.equal(second.status,'unknown');assert.equal(second.threadId,recovered.threadId);assert.equal(second.providerRunId,undefined);
  const secondRecovered=await api.conversations.reconcile({projectId:p.id,runId:second.id});assert.notEqual(secondRecovered.providerRunId,recovered.providerRunId);assert.equal(t3.calls.filter(c=>c.tag==='t3_thread_send').length,1);
  const reopened=await h.reopen();assert.ok(reopened.read().conversations.find(c=>c.id===input.conversationId).messages.some(m=>m.source==='T3-observed'));
  const restarted=createProviderService({dataDir:h.dataDir,store:reopened,t3});await restarted.conversations.recover();assert.equal((await restarted.conversations.send({...input,operationId:'send-reply',text:'Follow-up'})).id,second.id);await restarted.close();
});

test('native observation hook, stop uncertainty, scoped handoff and temporary helper lifetime',async t=>{
  const h=await harness(t),{api,t3,input,p,other,store}=h;
  let observations=0;t3.observe=async()=>{observations++;};const r=await api.conversations.send(input);assert.equal(observations,1);
  t3.stopUnknown=true;assert.equal((await api.conversations.stop({projectId:p.id,runId:r.id})).status,'unknown');
  await assert.rejects(api.conversations.handoff({operationId:'active-handoff',projectId:p.id,conversationId:input.conversationId,fromBotId:input.botId,toBotId:other.id,summary:'Reviewed summary'}),{code:'RUN_ACTIVE'});
  t3.stopUnknown=false;await api.conversations.stop({projectId:p.id,runId:r.id});
  const handoff={operationId:'handoff',projectId:p.id,conversationId:input.conversationId,fromBotId:input.botId,toBotId:other.id,summary:'Only this reviewed summary transfers'};const result=await api.conversations.handoff(handoff);assert.notEqual(result.conversationId,input.conversationId);assert.deepEqual(await api.conversations.handoff(handoff),result);
  const target=store.read().conversations.find(c=>c.id===result.conversationId);assert.equal(target.messages.length,1);assert.equal(target.messages[0].text,handoff.summary);assert.equal(target.bindings,undefined);
  const task=await h.create('task.create',p.id,{title:'Fixture helper scope'}),helper=await h.create('bot.create',p.id,{name:'Helper',kind:'helper',taskId:task.id}),chat=await h.create('conversation.create',p.id,{name:'Helper',kind:'private',botId:helper.id});
  const helperRun=await api.conversations.send({...input,operationId:'helper',conversationId:chat.id,botId:helper.id});assert.equal(helperRun.helperTaskId,task.id);t3.complete(helperRun.threadId,helperRun.providerRunId);await api.conversations.reconcile({projectId:p.id,runId:helperRun.id});
  await api.conversations.handoff({operationId:'retire',projectId:p.id,conversationId:chat.id,fromBotId:helper.id,toBotId:other.id,summary:'Helper results reviewed',retireHelper:true});
  await assert.rejects(api.conversations.send({...input,operationId:'retired',conversationId:chat.id,botId:helper.id}),{code:'BOT_RETIRED'});
});

test('pinned Effect RPC setup framing, stream snapshots and forbidden operation boundary',async()=>{
  const frames=[];
  class Socket extends EventTarget {constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(text){const f=JSON.parse(text);frames.push(f);if(f._tag==='Request')queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(f.tag.endsWith('.subscribe')?{_tag:'Chunk',requestId:f.id,values:[{phase:'waiting',flowId:'fixture-flow'}]}:{_tag:'Exit',requestId:f.id,exit:{_tag:'Success',value:{providers:[]}}})})));}close(){}}
  const channel=await openT3ProviderChannel({url:'http://127.0.0.1:12345',ticket:'fixture-ticket',WebSocketImpl:Socket});
  assert.deepEqual(await channel.request('server.getConfig',{}),{providers:[]});assert.equal((await channel.request('provider.auth.subscribe',{instanceId:'fixture'})).phase,'waiting');
  assert.ok(frames.some(f=>f._tag==='Ack'));assert.ok(frames.some(f=>f._tag==='Interrupt'));assert.equal(frames[0].tag,'server.getConfig');
  assert.throws(()=>channel.request('orchestration.dispatchCommand',{}),{code:'SETUP_RPC_FORBIDDEN'});
  assert.throws(()=>channel.request('server.updateSettings',{patch:{defaultRuntimeMode:'full-access'}}),{code:'SETUP_RPC_FORBIDDEN'});channel.close();
});
