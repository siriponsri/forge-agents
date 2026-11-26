// Read-only review: all execution data and Git changes are disposable fixtures.
// Real canonical T3, Workspace, SQLite and role owners; injected transport/context.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './workspaces-fixture.test.mjs';
import {createT3Service} from '../app/server/t3.mjs';
import {createWorkspaceService} from '../app/workspaces/index.mjs';
import {createSessionRoleService} from '../app/server/session-roles.mjs';
import {createStrategyService} from '../app/strategies/index.mjs';
import {entity,find} from '../app/server/domain.mjs';
import {inspectWorkspace} from '../app/workspaces/git.mjs';

test('checked predecessor changed during canonical async setup prevents verifier dispatch',async t=>{
 const f=await fixture(t),chats=[],bots=[];
 await f.store.transaction(s=>{for(let n=0;n<2;n++){const b=entity({name:`Role ${n}`,kind:'resident',status:'active'},f.p.id),c=entity({kind:'private',botId:b.id,messages:[]},f.p.id);s.bots.push(b);s.conversations.push(c);find(s,'tasks',f.tasks[n].id).botId=b.id;bots.push(b);chats.push(c);}});
 const roles=createSessionRoleService({store:f.store,conversations:{},authorize:(_i,c)=>c===f.owner?{kind:'owner'}:null});
 t.after(()=>roles.close());
 for(let n=0;n<2;n++)await roles.assign(f.input({conversationId:chats[n].id,botId:bots[n].id,role:n?'reviewer':'executor',expectedRevision:0}),f.owner);
 const sent=[],projects=[];let generator;
 const t3=createT3Service({store:f.store,dataDir:f.dataDir,getSessionRoles:()=>roles,
  prepareContext:async({run,baseMessage})=>{
   if(run.taskId===f.tasks[1].id)await writeFile(path.join(generator.worktreePath,'generated.txt'),'CHANGED AFTER ACTUAL CHECK, BEFORE VERIFIER DISPATCH\n');
   return {message:baseMessage,contextId:'INJECTED_CONTEXT',receipt:{qualification:'INJECTED_CONTEXT'}};
  },nativeTransport:{
   cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},
   call:async(name,input)=>{if(name==='t3_project_list')return {projects};assert.equal(name,'t3_thread_launch');sent.push(input);return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'completed'};},
   openFeed:async()=>{throw Error('INJECTED_NATIVE_OBSERVATION_DISCONNECTED');},
  }});
 const workspaces=createWorkspaceService({store:f.store,dataDir:f.dataDir,t3,authorize:({callerContext})=>callerContext===f.owner});
 const strategies=createStrategyService({store:f.store,dataDir:f.dataDir,workspaces,t3,sessionRoles:roles,authorize:(_i,c)=>c===f.owner?{kind:'human',role:'owner'}:null});
 t.after(async()=>{await strategies.close();await workspaces.close();await t3.shutdown();});
 await workspaces.configure(f.input({expectedRevision:0,maxConcurrent:2,providerLimit:2,checks:['diff']}),f.owner);
 const create=n=>workspaces.create(f.input({taskId:f.tasks[n].id,expectedTaskRevision:find(f.store.read(),'tasks',f.tasks[n].id).revision}),f.owner);
 generator=await create(0);const verifier=await create(1);
 let g=await strategies.create(f.input({mode:'generator-verifier',objective:'Review exact checked predecessor',stages:[
  {id:'generator',workspaceId:generator.id,conversationId:chats[0].id,dependsOn:[],purpose:'generator'},
  {id:'verifier',workspaceId:verifier.id,conversationId:chats[1].id,dependsOn:['generator'],purpose:'verifier'},
 ],limits:{maxAttempts:2,maxConcurrent:1,maxMs:300000,reportedCost:{unknown:'allow',maxAmount:null,currency:null}}}),f.owner);
 const act=(method,extra={})=>strategies[method](f.input({strategyId:g.id,expectedRevision:g.revision,...extra}),f.owner);
 g=await act('advance',{stageId:'generator'});
 await f.edit(generator,{'generated.txt':'ACTUAL CHECKED OUTPUT\n'});
 const w=()=>find(f.store.read(),'events',generator.id);
 await workspaces.check(f.input({workspaceId:generator.id,expectedRevision:w().revision}),f.owner);
 g=await act('reconcile');assert.equal(g.stages[0].result.checkStatus,'passed');
 const checkedHead=g.stages[0].result.head;
 g=await act('advance',{stageId:'verifier'});
 const observed=await inspectWorkspace(w(),f.dataDir),child=f.store.read().runs.find(r=>r.taskId===f.tasks[1].id);
 assert.equal(observed.dirty,true);
 assert.equal(sent.length,1,'Only the generator dispatched; the stale verifier never starts');
 assert.equal(child.status,'failed');
 assert.match(child.error,/Checked predecessor files changed during setup/);
 assert.equal(child.strategyContext.dependencyRefs[0].checkStatus,'passed');
});
