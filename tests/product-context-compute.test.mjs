// Integrated production HTTP/SQLite boundaries. No provider/model/cloud turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';

test('mounted memory/context/goals/compute use server session, durable records and the same workspace admission',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-integrated-context-compute-'));
  let app=await createApplication({dataDir:dir});t.after(()=>app.close());
  let cookie,csrf;
  async function connect(){const response=await fetch(app.url+'/api/session');cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;}
  async function post(route,input,{auth=true}={}){const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-Forge-CSRF':csrf}:{})},body:JSON.stringify(input)}),data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error.message),{status:r.status,...data.error});return data;}
  const op=()=>crypto.randomUUID();
  const create=async(type,projectId,data)=> (await post('/api/command',{type,projectId,data,operationId:op()})).entity;
  await connect();
  const project=await create('project.create',null,{name:'Integrated engineering fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'fixture-route',model:'fixture-model',options:[]},compute:{kind:'local'}}});
  const projectId=project.id,scope={projectId,kind:'project',id:projectId};
  await assert.rejects(post('/api/memory/status',{projectId,scope},{auth:false}),{status:403,code:'BROWSER_SESSION_REQUIRED'});
  await assert.rejects(post('/api/memory/list',{projectId,scope:{projectId,kind:'task',id:'foreign-task'},callerContext:{role:'owner'}}),{status:400,code:'MEMORY_VALIDATION'});
  const memory=await post('/api/memory/remember',{operationId:op(),projectId,scope,memoryType:'semantic',title:'วิธีทำงานของโครงการ',content:'ใช้รายงานภาษาไทยและตรวจหลักฐานจริง',sourceRefs:[]});
  const central=await post('/api/owner-memory/remember',{operationId:op(),title:'Owner preference',content:'รายงานภาษาไทยจากความจำส่วนกลาง Owner',sourceRefs:[]});
  assert.ok(!(await (await fetch(app.url+'/api/state')).text()).includes('รายงานภาษาไทยจากความจำส่วนกลาง Owner'),'Generic project state does not disclose central source content');
  await post('/api/owner-memory/grant',{operationId:op(),id:central.id,expectedRevision:central.revision,projectId,expectedGrantRevision:0});
  const backup=await post('/api/storage/backup',{});
  const route={providerId:'fixture-route',modelId:'fixture-model'};
  await post('/api/context/policy',{projectId,operationId:op(),route,budget:{contextWindow:20000,outputReserve:500,safetyReserve:100},source:{kind:'engineering-fixture',reference:'No real model capacity asserted',observedAt:new Date().toISOString()}});
  const composed=await post('/api/context/compose',{projectId,operationId:op(),route,items:[],memory:{scope,query:'รายงานภาษาไทย',limit:5,maxCharacters:5000}});
  assert.match(composed.message,/ใช้รายงานภาษาไทย/);assert.match(composed.message,/ความจำส่วนกลาง Owner/);assert.ok(composed.memoryRefs.length);
  const serialized=JSON.stringify(app.store.read().events.filter(e=>e.type==='context.version'));assert.ok(!serialized.includes('ใช้รายงานภาษาไทยและตรวจหลักฐานจริง'),'Context stores memory references, never a stale private-text cache');
  await post('/api/memory/forget',{projectId,scope,operationId:op(),id:memory.id,expectedRevision:memory.revision});
  await post('/api/owner-memory/revoke',{operationId:op(),id:central.id,expectedRevision:central.revision,projectId,expectedGrantRevision:1});
  const resolved=await post('/api/context/resolve',{projectId,contextId:composed.contextId});assert.ok(!resolved.message.includes('ใช้รายงานภาษาไทย'));assert.ok(!resolved.message.includes('ความจำส่วนกลาง Owner'));
  await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});
  assert.equal((await post('/api/memory/list',{projectId,scope})).items.length,0,'Old backup cannot resurrect forgotten content');
  assert.equal((await post('/api/owner-memory/list',{})).items[0].sharing[0].effective,false,'Old backup cannot re-share Owner memory after revocation');
  const plan=await create('plan.create',projectId,{name:'Approved engineering plan',approved:true});
  const task=await create('task.create',projectId,{title:'Verify selected file',planId:plan.id,status:'ready'});
  const goal=await post('/api/goals/create',{projectId,operationId:op(),planId:plan.id,objective:'Verify actual expected bytes',taskIds:[task.id],criteria:[{id:'file',taskId:task.id,description:'Fixed SHA from an engineering fixture',kind:'artifactHash',sha256:'1'.repeat(64)}],policy:{mode:'manual'}});
  await app.goals.suspendForRestore();
  await app.store.transaction(s=>{const g=s.events.find(e=>e.id===goal.id);g.policy.mode='bounded-auto';g.status='active';g.stopRequested=null;});
  const goalBackup=await post('/api/storage/backup',{});
  await app.store.transaction(s=>{const g=s.events.find(e=>e.id===goal.id);g.status='paused';g.stopRequested='pause';});
  await post('/api/storage/restore',{id:goalBackup.id,expectedRevision:app.store.read().revision});
  await new Promise(r=>setTimeout(r,50));
  const restoredGoal=(await post('/api/goals/state',{projectId})).goals.find(g=>g.id===goal.id);
  assert.equal(restoredGoal.status,'paused');assert.equal(restoredGoal.restoreReviewRequired,true,'Restoring an auto goal must not restart a controller');assert.equal(app.store.read().runs.length,0);
  assert.equal(app.t3.goalContextVersion,1);
  await assert.rejects(post('/api/runs/start',{projectId,taskId:task.id,operationId:op()}),{code:'GOAL_CONTEXT_REQUIRED'});
  const notebook=await create('notebook.create',projectId,{name:'Actual integrated CPU execution',code:"print('FORGE integrated compute')",language:'python'});
  const remote=await post('/api/compute/configure',{projectId,config:{kind:'jupyter',baseUrl:'http://127.0.0.1:1',authEnv:'FORGE_ENGINEERING_NO_TOKEN',workspace:'forge-fixture'},select:true});
  assert.equal(remote.config.kind,'jupyter');
  const phase=await create('phase.create',projectId,{name:'Local override',planId:plan.id});
  const local=await post('/api/compute/configure',{projectId,phaseId:phase.id,config:{kind:'local'},select:true});
  await assert.rejects(post('/api/compute/start',{projectId,notebookId:notebook.id,operationId:op(),resolvedCompute:{kind:'local'}}),{code:'COMPUTE_INPUT'});
  const request={projectId,phaseId:phase.id,notebookId:notebook.id,operationId:op()};
  const job=await post('/api/compute/start',request);assert.equal((await post('/api/compute/start',request)).id,job.id);assert.equal(job.computeAttempt.targetId,local.id);
  let observed;for(let i=0;i<100;i++){observed=await post('/api/compute/status',{projectId,jobId:job.id});if(['completed','failed'].includes(observed.status))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(observed.status,'completed',observed.error);assert.match(observed.logs,/FORGE integrated compute/);
  // The root workspace and a nested selected project overlap. An unknown writer
  // in either prevents a second writer, without signalling any persisted PID.
  const nested=await create('project.create',null,{name:'Nested fixture',workspace:path.join(project.workspace,'nested')});
  const nestedNote=await create('notebook.create',nested.id,{name:'Must not execute',code:"raise Exception('must not run')"});
  await app.store.transaction(s=>s.runs.push({id:op(),projectId,status:'unknown',kind:'conversation',attemptId:op(),revision:1}));
  await assert.rejects(post('/api/compute/start',{projectId:nested.id,notebookId:nestedNote.id,operationId:op()}),{code:'WORKSPACE_BUSY'});
  await app.close();app=await createApplication({dataDir:dir});await connect();
  assert.equal((await post('/api/memory/list',{projectId,scope})).items.length,0);
  assert.equal((await post('/api/goals/state',{projectId})).goals.find(g=>g.id===goal.id).status,'paused');
  assert.equal(app.store.read().jobs.find(j=>j.id===job.id).status,'completed');
});
