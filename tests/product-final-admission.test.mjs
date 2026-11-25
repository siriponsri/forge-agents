// Production dispatch and HTTP owners, real SQLite; native execution is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createT3Service} from '../app/server/t3.mjs';
import {createConversationService} from '../app/providers/conversations.mjs';
import {taskDigest} from '../app/relay/common.mjs';
import {createBudgetService} from '../app/budgets/index.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';
import {createApplication} from '../app/server/main.mjs';
import {fixture as proactiveFixture,eventTrigger} from './proactive-fixture.test.mjs';

async function seed(t){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-final-admission-')),store=await openStore(dataDir),workspace=path.join(dataDir,'workspace');await mkdir(workspace);
  const selection={instanceId:'INJECTED_ROUTE',model:'INJECTED_MODEL',options:[],connectionId:crypto.randomUUID()};
  const p=entity({workspace,profile:{provider:selection}}),bot=entity({kind:'resident',name:'Fixture bot',status:'active'},p.id),plan=entity({approved:true,name:'Approved fixture'},p.id);
  const task=entity({title:'Bounded fixture',status:'ready',planId:plan.id,botId:bot.id,dependsOn:[],runIds:[],artifactIds:[],evidence:[]},p.id),chat=entity({kind:'private',botId:bot.id,messages:[]},p.id);
  await store.transaction(s=>{s.projects.push(p);s.bots.push(bot);s.plans.push(plan);s.tasks.push(task);s.conversations.push(chat);s.connections.push({id:selection.connectionId,projectId:p.id,kind:'provider'});});
  const closes=[];t.after(async()=>{for(const close of closes)await close();await store.close();});
  return {store,dataDir,p,bot,task,chat,selection,closes};
}
for(const mutation of ['none','stop','disable','task-edit'])test(`final mobile fence preserves only its own reservation and checks current channel: ${mutation}`,async t=>{
  const f=await seed(t),op=crypto.randomUUID(),bindingId=crypto.randomUUID(),inboxId=crypto.randomUUID(),approvalEventId=crypto.randomUUID();let context,launches=0;const projects=[];
  await f.store.transaction(s=>{
    const approvedDigest=taskDigest(s,f.p.id,f.task.id);context={version:1,inboxId,reservationId:crypto.randomUUID(),bindingId,approvalEventId,taskDigest:approvedDigest};
    s.relay={version:1,bindings:[{id:bindingId,projectId:f.p.id,enabled:true}],inbox:[{id:inboxId,projectId:f.p.id,bindingId,taskId:f.task.id,status:'dispatching',taskDigest:approvedDigest,approvalEventId,reservation:{id:context.reservationId,operationId:op}}],events:[{id:approvalEventId,inboxId,bindingId,action:'approve'}],nonces:[],outbox:[]};
  });
  const native=createT3Service({store:f.store,dataDir:f.dataDir,prepareContext:async({baseMessage})=>{
    if(mutation!=='none')await f.store.transaction(s=>{if(mutation==='stop')s.relay.inbox[0].stopRequested=true;else if(mutation==='disable')s.relay.bindings[0].enabled=false;else{s.tasks[0].title='Changed after approval';changed(s.tasks[0]);}});
    return {message:baseMessage,contextId:'INJECTED_CONTEXT',receipt:{qualification:'INJECTED_CONTEXT'}};
  },nativeTransport:{cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},call:async name=>{if(name==='t3_project_list')return {projects};launches++;return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'running'};},openFeed:async()=>{throw Error('INJECTED feed absent');}}});f.closes.push(()=>native.shutdown());
  const run=await native.startRun({projectId:f.p.id,taskId:f.task.id,operationId:op,relayContext:context});
  assert.equal(launches,mutation==='none'?1:0);assert.equal(run.status,mutation==='none'?'unknown':'failed');
});

for(const mutation of ['bot','workspace','profile','visibility','selection'])test(`chat final admission rejects ${mutation} drift during asynchronous setup`,async t=>{
  const f=await seed(t);let launches=0,validations=0;
  const api=createConversationService({store:f.store,providers:{validateSelection(){if(++validations>1&&mutation==='selection')throw Error('fixture catalog revoked');return f.selection;}},t3:{providers:{ensureProject:async()=>{
    await f.store.transaction(s=>{if(mutation==='bot'){s.bots[0].status='retired';changed(s.bots[0]);}else if(mutation==='workspace'){s.projects[0].workspace+='-changed';changed(s.projects[0]);}else if(mutation==='profile'){s.projects[0].profile.provider.model='other';changed(s.projects[0]);}else if(mutation==='visibility'){s.conversations[0].kind='team';changed(s.conversations[0]);}});return {id:'INJECTED_NATIVE_PROJECT'};
  },call:async()=>{launches++;return {threadId:'unexpected',runId:'unexpected'};}}}});f.closes.push(()=>api.close());
  const r=await api.send({projectId:f.p.id,conversationId:f.chat.id,botId:f.bot.id,operationId:crypto.randomUUID(),text:'Harmless fixture advice'});
  assert.equal(launches,0);assert.equal(r.status,'failed');
});

test('host proof releases a failed continued-chat attempt without releasing an uncertain sent turn',async t=>{
  const f=await seed(t),owner=Object.freeze({});let budgets,sends=0,failBefore=true;
  await f.store.transaction(s=>{s.conversations[0].bindings={[f.bot.id]:{threadId:'existing-thread',t3ProjectId:'native-project',selection:{instanceId:f.selection.instanceId,model:f.selection.model,options:[]}}};});
  const api=createConversationService({store:f.store,providers:{validateSelection:()=>f.selection},onNotDispatched:i=>budgets.confirmNotDispatched(i),t3:{providers:{assertEnvironment:async()=>{if(failBefore)throw Error('fixture preflight failure');},ensureProject:async()=>({id:'native-project'}),call:async(name)=>{if(name==='t3_thread_read')return {thread:{threadId:'existing-thread',projectId:'native-project',providerInstanceId:f.selection.instanceId,runtimeMode:'approval-required'},items:[],hasMore:false};sends++;throw Error('fixture lost send acknowledgment');}}}});f.closes.push(()=>api.close());
  budgets=createBudgetService({store:f.store,authorize:(_r,c)=>c===owner?{kind:'human',subject:'fixture-owner',role:'owner'}:null});
  await budgets.configure({projectId:f.p.id,botId:null,operationId:crypto.randomUUID(),expectedRevision:0,enabled:true,unknown:'allow',period:'lifetime',limit:{minorUnits:100,scale:2,currency:'USD'},reserve:{minorUnits:10,scale:2,currency:'USD'}},owner);
  const input=()=>({projectId:f.p.id,conversationId:f.chat.id,botId:f.bot.id,operationId:crypto.randomUUID(),text:'Fixture advice'});
  const failed=await api.send(input());assert.equal(failed.status,'failed');assert.equal(sends,0);
  const reservation=id=>f.store.read().events.find(e=>e.type==='budget.reservation'&&e.binding.runId===id);
  assert.equal(reservation(failed.id).held,false);assert.equal(reservation(failed.id).status,'not-dispatched');
  failBefore=false;const uncertain=await api.send(input());assert.equal(uncertain.status,'unknown');assert.equal(sends,1);assert.equal(reservation(uncertain.id).held,true);
  await assert.rejects(budgets.confirmNotDispatched({projectId:f.p.id,runId:uncertain.id,attemptId:uncertain.attemptId,sourceReceiptId:'not-proof'}),{code:'BUDGET_RECONCILE'});
});

test('older metadata cannot erase authenticated event dedupe, consumed task or proactive run budget',async t=>{
  const f=await proactiveFixture(t);f.control.completeImmediately=true;
  const r=await f.enable({trigger:eventTrigger,budget:{maxRuns:1,maxRunMs:300000,maxTokens:null,maxCost:null,currency:null}}),artifacts=createArtifactService({store:f.store,dataDir:f.dir}),backup=await artifacts.backup();
  const first=await f.event(r,'same-event');assert.equal(f.starts,1);assert.equal(f.recipe(r).usage.runs,1);
  await f.service.suspendForRestore();try{await artifacts.restore({id:backup.id,expectedRevision:f.store.read().revision});await f.service.afterRestore();}finally{f.service.cancelRestore();}
  assert.equal(f.recipe(r).grant,null);assert.equal(f.recipe(r).usage.runs,1);assert.ok(f.store.read().runs.some(run=>run.operationId===first.operationId));
  await f.call('approve',r);await assert.rejects(f.call('enable',r),{code:'RUN_LIMIT'});
  assert.equal((await f.event(r,'same-event')).id,first.id);assert.equal(f.starts,1);
});

for(const route of ['/api/runs/start','/api/relay/bridge'])test(`an incomplete body cannot dispatch during restore: ${route}`,{timeout:20000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-http-restore-race-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir:dir}).backup();let calls=0,release,entered;
  app.t3.startRun=async()=>{calls++;return {qualification:'INJECTED_NO_PROVIDER_TURN'};};
  app.relay.bridge=async()=>{calls++;return {qualification:'INJECTED_NO_GATEWAY_EFFECT'};};
  const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});const original=app.memory.afterRestore;
  app.memory.afterRestore=async()=>{entered();await held;return original();};
  const payload=JSON.stringify({operationId:crypto.randomUUID(),projectId:'no-effect',taskId:'no-effect'});
  let request;const requestEntered=new Promise(resolve=>app.server.on('request',req=>{if(req.url===route)setImmediate(resolve);}));
  const response=new Promise((resolve,reject)=>{request=http.request(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});request.on('error',reject);request.write(payload[0]);});
  await requestEntered;
  const restoring=fetch(app.url+'/api/storage/restore',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify({id:backup.id,expectedRevision:app.store.read().revision})});
  try{await inside;request.end(payload.slice(1));const denied=await response;assert.equal(denied.status,409);assert.equal(denied.body.error.code,'APPLICATION_BUSY');assert.equal(calls,0);}finally{release();await restoring;}
});

test('restore drains previously admitted work and rejects later mutations until projection recovery finishes',{timeout:20000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-http-restore-drain-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir:dir}).backup();
  let release,entered,projectionRecovered=false;const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});
  app.t3.startRun=async()=>{entered();await held;return {qualification:'INJECTED_NO_PROVIDER_TURN'};};
  const original=app.memory.afterRestore;app.memory.afterRestore=async()=>{projectionRecovered=true;return original();};
  const post=(route,input)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify(input)});
  const admitted=post('/api/runs/start',{operationId:crypto.randomUUID()});await inside;
  let restoreEntered;const restoreSeen=new Promise(r=>{restoreEntered=r;});app.server.on('request',req=>{if(req.url==='/api/storage/restore')setImmediate(restoreEntered);});
  const restoring=post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});
  try{await restoreSeen;const denied=await post('/api/command',{operationId:crypto.randomUUID(),type:'project.create',data:{name:'must not mutate'}});assert.equal(denied.status,409);assert.equal(projectionRecovered,false);}finally{release();}
  assert.equal((await admitted).status,200);assert.equal((await restoring).status,200);assert.equal(projectionRecovered,true);
});

test('OAuth credential callbacks cannot mutate bindings during restore',{timeout:20000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-http-oauth-restore-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir:dir}).backup();let calls=0,release,entered;
  app.storage.finishDriveAuth=async()=>{calls++;return {secretRef:'fixture-only'};};
  const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;}),original=app.memory.afterRestore;app.memory.afterRestore=async()=>{entered();await held;return original();};
  const restoring=fetch(app.url+'/api/storage/restore',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify({id:backup.id,expectedRevision:app.store.read().revision})});
  try{await inside;for(const callback of ['/api/storage/drive/auth/callback','/api/mcp/oauth/callback']){const response=await fetch(app.url+callback+'?state=fixture&code=fixture',{headers:{Cookie:cookie}});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'APPLICATION_BUSY');}assert.equal(calls,0);}finally{release();await restoring;}
});

test('a declined normalized Office path releases admission and cannot wedge later restore',{timeout:20000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-http-office-admission-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const response=await new Promise((resolve,reject)=>{const target=new URL(app.url),req=http.request({hostname:target.hostname,port:target.port,path:'/mcp/./office',method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});assert.equal(response,404);
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir:dir}).backup();
  const restored=await fetch(app.url+'/api/storage/restore',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify({id:backup.id,expectedRevision:app.store.read().revision}),signal:AbortSignal.timeout(5000)});assert.equal(restored.status,200);
});

test('restore waits for an already admitted credential callback',{timeout:20000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-http-oauth-drain-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir:dir}).backup();
  let release,entered,recovered=false,calls=0;const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});
  app.storage.finishDriveAuth=async()=>{calls++;entered();await held;return {secretRef:'fixture-no-credential'};};
  const original=app.memory.afterRestore;app.memory.afterRestore=async()=>{recovered=true;return original();};
  const callback=fetch(app.url+'/api/storage/drive/auth/callback?state=fixture&code=fixture');await inside;
  let restoreEntered;const restoreSeen=new Promise(r=>{restoreEntered=r;});app.server.on('request',req=>{if(req.url==='/api/storage/restore')setImmediate(restoreEntered);});
  const restoring=fetch(app.url+'/api/storage/restore',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify({id:backup.id,expectedRevision:app.store.read().revision})});
  try{await restoreSeen;const late=await fetch(app.url+'/api/storage/drive/auth/callback?state=fixture&code=fixture');assert.equal(late.status,409);assert.equal(recovered,false);assert.equal(calls,1);}finally{release();}
  assert.equal((await callback).status,200);assert.equal((await restoring).status,200);assert.equal(recovered,true);
});
