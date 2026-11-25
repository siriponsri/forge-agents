// Real Git worktrees/SQLite and the production T3 reservation/dispatch owner.
// The pinned native wire is injected; no model/provider turn is performed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createT3Service} from '../app/server/t3.mjs';
import {fixture} from './workspaces-fixture.test.mjs';
import {assertWorkspaceAvailable} from '../app/server/admission.mjs';
import {createBudgetService} from '../app/budgets/index.mjs';

test('production T3 dispatch registers exact isolated paths and preserves model/options/context without changing the original project',async t=>{
  const f=await fixture(t),projects=[],launches=[],registered=[];
  const native=createT3Service({store:f.store,dataDir:f.dataDir,nativeTransport:{
    async cli(args){assert.equal(args[0],'project');assert.equal(args[1],'add');registered.push(args[2]);projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},
    async call(name,args){if(name==='t3_project_list')return {projects};assert.equal(name,'t3_thread_launch');launches.push(structuredClone(args));return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'running'};},
    async openFeed(){throw new Error('INJECTED_NATIVE_TRANSPORT: no live observation feed');},
  }});
  Object.assign(f.t3,native);
  try{
    await f.configure();const a=await f.create(0),b=await f.create(1);
    await Promise.all([f.call('start',a),f.call('start',b)]);
    assert.equal(launches.length,2);assert.equal(new Set(registered).size,2);
    for(const w of [f.w(a),f.w(b)]){
      const r=f.store.read().runs.find(r=>r.operationId===w.runOperationId),launch=launches.find(x=>x.clientRequestId===r.id);
      assert.equal(r.workspace,path.resolve(w.worktreePath));assert.equal(r.sourceWorkspace,f.repo);
      assert.equal(projects.find(x=>x.id===launch.projectId).workspaceRoot,r.workspace);
      assert.ok(launch.message.includes(r.workspace));assert.ok(launch.message.includes(w.baseSha));
      assert.deepEqual(launch.modelSelection,{instanceId:f.p.profile.provider.instanceId,model:f.p.profile.provider.model,options:f.p.profile.provider.options});
      assert.equal(launch.runtimeMode,'approval-required');assert.equal(r.workspaceContext.workspaceId,w.id);
      const originalInput={projectId:f.p.id,taskId:w.taskId,operationId:w.runOperationId,workspaceContext:r.workspaceContext};
      assert.equal((await native.startRun(originalInput)).id,r.id);assert.equal(launches.length,2);
      await assert.rejects(native.startRun({...originalInput,workspaceContext:{...r.workspaceContext,baseSha:'0'.repeat(40)}}),{code:'OPERATION_REUSE'});
    }
    assert.deepEqual(f.store.read().projects[0].profile,f.p.profile);
    assert.equal(f.store.read().projects[0].workspace,f.repo);
    assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id),{code:'WORKSPACE_BUSY'});
  }finally{await native.shutdown();}
});

test('ordinary admission fences an isolated pre-run reservation and a proactive claim before effects',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>s.events.push({id:crypto.randomUUID(),projectId:f.p.id,type:'workspace.workspace',status:'admitting'}));
  assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id),{code:'WORKSPACE_CONTEXT_REQUIRED'});
  await f.store.transaction(s=>{s.events=s.events.filter(e=>e.type!=='workspace.workspace');s.events.push({id:crypto.randomUUID(),projectId:f.p.id,type:'proactive.occurrence',held:true});});
  assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id),{code:'PROACTIVE_CONTEXT_REQUIRED'});
});

test('production final budget fence refuses a policy race and host no-dispatch proof releases only that attempt',async t=>{
  const f=await fixture(t);let budgets,launches=0;const projects=[];
  const policy={projectId:f.p.id,botId:null,enabled:true,unknown:'allow',period:'lifetime',limit:{minorUnits:100,scale:2,currency:'USD'},reserve:{minorUnits:10,scale:2,currency:'USD'}};
  const native=createT3Service({store:f.store,dataDir:f.dataDir,
    onNotDispatched:input=>budgets.confirmNotDispatched(input),
    async prepareContext({baseMessage}){await budgets.configure({...policy,operationId:crypto.randomUUID(),expectedRevision:1},f.owner);return {message:baseMessage,contextId:'INJECTED_PREFIX_FIXTURE',receipt:{qualification:'INJECTED_PREFIX_FIXTURE'}};},
    nativeTransport:{async cli(args){projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},async call(name){if(name==='t3_project_list')return {projects};launches++;throw Error('must not launch');},async openFeed(){throw Error('No live feed in fixture');}},
  });
  Object.assign(f.t3,native);budgets=createBudgetService({store:f.store,t3:native,authorize:(_r,c)=>c===f.owner?{kind:'human',subject:'local-fixture-owner',role:'owner'}:null});
  try{
    await budgets.configure({...policy,operationId:crypto.randomUUID(),expectedRevision:0},f.owner);
    await f.configure();const w=await f.create();await f.call('start',w);
    const run=f.store.read().runs[0],reservation=f.store.read().events.find(e=>e.type==='budget.reservation'&&e.binding.runId===run.id);
    assert.equal(launches,0);assert.equal(run.status,'failed');assert.match(run.error,/Budget policy changed/);
    assert.equal(reservation.held,false);assert.equal(reservation.status,'not-dispatched');assert.ok(reservation.notDispatched);
  }finally{await native.shutdown();}
});
