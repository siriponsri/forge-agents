// Actual canonical Workspace/T3/SQLite/Budget services. Only native transport
// is injected; these checks make no external provider or product-quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture as workspaceFixture} from './workspaces-fixture.test.mjs';
import {createApplication} from '../app/server/main.mjs';
import {createT3Service} from '../app/server/t3.mjs';
import {createWorkspaceService} from '../app/workspaces/index.mjs';
import {createSessionRoleService} from '../app/server/session-roles.mjs';
import {createStrategyService} from '../app/strategies/index.mjs';
import {entity,find} from '../app/server/domain.mjs';

for(const drift of [false,true])test(`production Workspace and T3 retain strategy scope and final role fence: drift=${drift}`,async t=>{
  const f=await workspaceFixture(t),chat=entity({kind:'private',botId:f.bot.id,messages:[]},f.p.id);
  await f.store.transaction(s=>{find(s,'bots',f.bot.id).kind='resident';find(s,'bots',f.bot.id).status='active';s.conversations.push(chat);});
  const roles=createSessionRoleService({store:f.store,conversations:{},authorize:(_i,c)=>c===f.owner?{kind:'owner'}:null});
  t.after(()=>roles.close());
  await roles.assign(f.input({conversationId:chat.id,botId:f.bot.id,role:'executor',expectedRevision:0}),f.owner);
  const projects=[],sent=[];
  const t3=createT3Service({store:f.store,dataDir:f.dataDir,getSessionRoles:()=>roles,
    prepareContext:async({baseMessage})=>{
      if(drift)await roles.assign(f.input({conversationId:chat.id,botId:f.bot.id,role:'reviewer',expectedRevision:1}),f.owner);
      return {message:baseMessage,contextId:'INJECTED_CONTEXT',receipt:{qualification:'INJECTED_CONTEXT'}};
    },nativeTransport:{
      cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},
      call:async(name,input)=>{if(name==='t3_project_list')return {projects};assert.equal(name,'t3_thread_launch');sent.push(input);return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'running'};},
      openFeed:async()=>{throw Error('INJECTED_NATIVE_OBSERVATION_DISCONNECTED');},
    }});
  const workspaces=createWorkspaceService({store:f.store,dataDir:f.dataDir,t3,authorize:({callerContext})=>callerContext===f.owner});
  const strategies=createStrategyService({store:f.store,dataDir:f.dataDir,workspaces,t3,sessionRoles:roles,authorize:(_i,c)=>c===f.owner?{kind:'human',role:'owner'}:null});
  t.after(async()=>{await strategies.close();await workspaces.close();await t3.shutdown();});
  await workspaces.configure(f.input({expectedRevision:0,maxConcurrent:2,providerLimit:2,checks:['diff']}),f.owner);
  const w=await workspaces.create(f.input({taskId:f.tasks[0].id,expectedTaskRevision:find(f.store.read(),'tasks',f.tasks[0].id).revision}),f.owner);
  let g=await strategies.create(f.input({mode:'dag',objective:'Approved production-owner integration fixture',stages:[{id:'work',workspaceId:w.id,conversationId:chat.id,dependsOn:[],purpose:'work'}],limits:{maxAttempts:1,maxConcurrent:1,maxMs:300000,reportedCost:{unknown:'allow',maxAmount:null,currency:null}}}),f.owner);
  await assert.rejects(async()=>workspaces.start(f.input({workspaceId:w.id,expectedRevision:w.revision,strategyContext:{}}),f.owner),{code:'STRATEGY_CONTEXT'});
  await assert.rejects(t3.startRun({projectId:f.p.id,taskId:f.tasks[0].id,operationId:crypto.randomUUID()}),{code:'STRATEGY_HELD'});
  g=await strategies.advance(f.input({strategyId:g.id,expectedRevision:g.revision,stageId:'work'}),f.owner);
  const state=f.store.read(),run=state.runs.find(r=>r.strategyContext?.strategyId===g.id);
  assert.ok(run);assert.equal(run.workspaceContext.workspaceId,w.id);assert.equal(run.strategyContext.role.role,'executor');
  assert.equal(state.events.filter(e=>e.type==='budget.reservation'&&e.binding.runId===run.id).length,1);
  assert.equal(sent.length,drift?0:1);
  if(!drift){assert.ok(sent[0].message.includes(`FORGE strategy ${g.id}`));assert.ok(sent[0].message.includes('Working role: executor'));assert.equal((await t3.startRun({...run})).id,run.id);assert.equal(sent.length,1);}
  else assert.equal(run.status,'failed');
});

test('mounted six-mode API requires the actual browser Owner/CSRF and rejects private lifecycle methods',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-strategy-http-')),app=await createApplication({dataDir});t.after(()=>app.close());
  const p=entity({name:'Mode-list fixture',workspace:dataDir,profile:{}});await app.store.transaction(s=>s.projects.push(p));
  const request=()=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id})});
  assert.equal((await fetch(app.url+'/api/strategies/state',request())).status,403);
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
  const options=request();options.headers={...options.headers,Cookie:cookie,'X-Forge-CSRF':csrf};
  const response=await fetch(app.url+'/api/strategies/state',options);assert.equal(response.status,200);const state=await response.json();assert.equal(state.modes.length,6);assert.equal(state.capabilities.workspace,true);
  assert.equal((await fetch(app.url+'/api/strategies/recover',options)).status,404);
});
