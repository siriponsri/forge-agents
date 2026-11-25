import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,eventTrigger} from './proactive-fixture.test.mjs';
import {fixture as budgetFixture} from './budgets-fixture.test.mjs';
import {mergeGuardedSafety} from '../app/server/guarded-recovery.mjs';
import {emptyState} from '../app/server/store.mjs';
import {createT3Service} from '../app/server/t3.mjs';
import {applyGuardedObservation} from '../app/protocol/observations.mjs';
import {digest as taskDigest} from '../app/server/agui.mjs';
import {command} from '../app/server/domain.mjs';
import {reserveBudget} from '../app/budgets/index.mjs';

test('scheduler retains its private in-flight pre-reservation claim without inventing an uncertain outcome',async t=>{
  const f=await fixture(t);let release,entered;const ready=new Promise(r=>{entered=r;});f.control.before=()=>{entered();return new Promise(r=>{release=r;});};
  const recipe=await f.enable({trigger:eventTrigger}),start=f.event(recipe,'pending-setup');await ready;
  await f.service.tick();let o=f.state().occurrences[0];assert.equal(o.status,'dispatching');assert.equal(o.held,true);assert.equal(f.store.read().runs.length,0);
  release();await start;assert.equal(f.store.read().runs.length,1);assert.equal(f.starts,1);
});
test('a pending private setup cannot reserve after the unchanged accepted deadline',async t=>{
  const f=await fixture(t);let release,entered;const ready=new Promise(r=>{entered=r;});f.control.before=()=>{entered();return new Promise(r=>{release=r;});};
  const recipe=await f.enable({trigger:eventTrigger,budget:{maxRuns:1,maxRunMs:1000,maxTokens:null,maxCost:null,currency:null}}),start=f.event(recipe,'expired-pending-setup');await ready;
  f.advance(1001);await f.service.tick();assert.equal(f.state().occurrences[0].stopRequested,'RUN_DEADLINE');release();await start;assert.equal(f.store.read().runs.length,0);assert.equal(f.starts,1);
});
test('a matching native running event cannot adopt an Owner task edit or restore action authority',async t=>{
  const f=await fixture(t),recipe=await f.enable({trigger:eventTrigger,scope:{paths:['.'],capabilities:['read','propose','workspace.write']}});await f.event(recipe,'revision-race');
  const id=f.store.read().runs[0].id;
  await f.store.transaction(s=>{const r=s.runs[0],task=s.tasks.find(x=>x.id===r.taskId),o=s.events.find(x=>x.type==='proactive.occurrence');r.status='submitting';r.attemptId=crypto.randomUUID();r.threadId=crypto.randomUUID();r.rootNodeId=crypto.randomUUID();r.selection=structuredClone(f.project.profile.provider);r.providerInstanceId=r.selection.instanceId;r.profile=structuredClone(f.project.profile);r.workspace=f.project.workspace;r.sourceWorkspace=f.project.workspace;
    task.status='ready';r.approvalSnapshot={taskRevision:task.revision-1,planRevision:s.plans[0].revision,botRevision:s.bots[0].revision};r.guardedReservedTaskSnapshot=taskDigest(task);o.status='dispatching';o.deadlineAt=Date.now()+300000;r.proactiveContext.deadlineAt=o.deadlineAt;o.context=structuredClone(r.proactiveContext);r.guardedContext={routeProof:r.proactiveContext.enforcement};reserveBudget(s,{run:r});});
  const api=createT3Service({store:f.store,dataDir:f.dir});t.after(()=>api.shutdown());
  const detail=s=>({run:s.runs[0],input:{projectId:f.project.id,taskId:s.runs[0].taskId,operationId:s.runs[0].operationId,proactiveContext:s.runs[0].proactiveContext},stage:'current',routeProof:s.runs[0].guardedContext.routeProof});
  assert.equal(api.validateGuardedAdmission(f.store.read(),detail(f.store.read())),true);
  const task=f.store.read().tasks.find(x=>x.id===f.tasks[0].id);await command(f.store,{projectId:f.project.id,type:'task.update',id:task.id,expectedRevision:task.revision,operationId:crypto.randomUUID(),data:{status:'blocked'}});
  const r=f.store.read().runs[0],projection={providerThread:{id:'native-thread',appThreadId:r.threadId},providerTurn:{id:'native-turn',providerThreadId:'native-thread',runAttemptId:r.attemptId,nodeId:r.rootNodeId,status:'running'},terminal:null,turnItems:[]};
  await f.store.transaction(s=>applyGuardedObservation(s,s.runs[0],projection));assert.equal(f.store.read().tasks.find(x=>x.id===task.id).status,'blocked');assert.equal(f.store.read().runs[0].status,'unknown');
  let effects=0;await assert.rejects(f.store.transaction(s=>{api.validateGuardedAdmission(s,{...detail(s),stage:'action',capability:'workspace.write',path:'a.txt'});effects++;}));assert.equal(effects,0);
  await f.store.transaction(s=>applyGuardedObservation(s,s.runs[0],{...projection,terminal:{status:'completed'}}));assert.equal(f.store.read().tasks.find(x=>x.id===task.id).status,'blocked');assert.equal(f.store.read().runs[0].status,'completed','native outcome is retained without approving the edited task');
});
test('older metadata retains Guarded dispatch identity, AG-UI and actual effect receipts without recreating authority',()=>{
  const current=emptyState(),restored=emptyState(),run={id:'canonical-run',operationId:'accepted-once',status:'completed',guardedContext:{version:1},protocolReceipts:{observed:{eventId:'native-event'}}};current.runs.push(run);
  current.events.push({id:'native-event',type:'agui',runId:run.id,event:{type:'RUN_FINISHED'}});current.receipts.push({id:'guarded-file:effect',type:'guarded.file-receipt',runId:run.id,receipt:{outcome:'completed'}});
  mergeGuardedSafety(restored,current);assert.deepEqual(restored.runs,[run]);assert.equal(restored.receipts.length,1);assert.equal(restored.events.length,1);mergeGuardedSafety(restored,current);assert.equal(restored.runs.length,1);
  restored.receipts[0].receipt.outcome='forged';assert.throws(()=>mergeGuardedSafety(restored,current),{code:'GUARDED_RESTORE_CONFLICT'});
});
test('a cancelled preallocated Guarded thread releases only before native turn or final send evidence',async t=>{
  const f=await budgetFixture(t);await f.configure();
  const run=await f.start({status:'failed',threadId:'preallocated-guarded',guardedContext:{threadId:'preallocated-guarded'}});
  await f.service.confirmNotDispatched({projectId:f.projectId,runId:run.id,attemptId:run.attemptId,sourceReceiptId:'trusted-host-no-native-send'});assert.equal((await f.state()).attempts[0].held,false);
  for(const field of [{guardedLaunch:{messageDigest:'accepted-send'}},{nativeProviderTurnId:'observed-turn'},{guardedProjection:{providerTurn:{id:'observed-turn'}}}]){
    const r=await f.start({status:'failed',threadId:'guarded-'+crypto.randomUUID(),...field});await f.store.transaction(s=>{const current=s.runs.find(x=>x.id===r.id);current.guardedContext={threadId:current.threadId};});
    await assert.rejects(f.service.confirmNotDispatched({projectId:f.projectId,runId:r.id,attemptId:r.attemptId,sourceReceiptId:'must-not-release'}),{code:'BUDGET_RECONCILE'});
    await f.store.transaction(s=>{s.events.find(e=>e.type==='budget.reservation'&&e.binding.runId===r.id).held=false;});
  }
});
