import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,gate} from './product-session-roles-fixture.mjs';
import {createSessionRoute,mergeSessionRouteSafety} from '../app/server/session-route.mjs';
import {entity,changed,find} from '../app/server/domain.mjs';
import {digest as taskDigest} from '../app/server/agui.mjs';
import {createConversationService} from '../app/providers/conversations.mjs';
import {assertWorkspaceAvailable} from '../app/server/admission.mjs';

// Canonical SQLite, role/Owner boundary and reservation hooks are real. Only
// native setup/observations are injected here; this is not live qualification.
async function routeFixture(t){
  const f=await fixture(t);let now=Date.now(),calls=0,hold;
  const plan=entity({name:'Approved coordination',approved:true},f.p.id),task=entity({title:'Coordinate reviewed child sessions',description:'Bounded advice only',planId:plan.id,botId:f.bot.id,status:'ready',runIds:[],dependsOn:[],evidence:[],artifactIds:[]},f.p.id);
  await f.store.transaction(s=>{find(s,'runs',f.parent.id).status='completed';s.plans.push(plan);s.tasks.push(task);});
  let route;
  const t3={async startRun(input){calls++;if(hold){hold.enter();await hold.promise;}return f.store.transaction(s=>{
    route.validateContext(s,input);const current=find(s,'tasks',task.id),r=entity({...input,botId:current.botId,attemptId:crypto.randomUUID(),threadId:crypto.randomUUID(),rootNodeId:crypto.randomUUID(),selection:structuredClone(f.selection),sessionRole:f.roles.captureRole(s,{...input,botId:current.botId}),status:'submitting'},f.p.id);
    s.runs.push(r);current.runIds.push(r.id);changed(current);r.guardedReservedTaskSnapshot=taskDigest(current);route.reserve(s,{run:r,input});return r;
  });}};
  route=createSessionRoute({store:f.store,authorizeOwner:(_i,caller)=>caller===f.owner&&f.ownerState.active?{kind:'human',role:'owner'}:null,policy:{observe:()=>({route:f.selection,policyGeneration:'fixture-policy',toolGeneration:'fixture-tools'})},getGuarded:()=>({privateSnapshot:()=>null}),getT3:()=>t3,getRoles:()=>f.roles,getMcp:()=>null,clock:()=>now});
  t.after(()=>route.close());
  const input={projectId:f.p.id,taskId:task.id,conversationId:f.chat.id,children:[{conversationId:f.child.id,botId:f.childBot.id}],operationId:crypto.randomUUID()};
  return {...f,route,task,input,get calls(){return calls;},setHold:x=>{hold=x;},advance:ms=>{now+=ms;}};
}

test('Owner intent pins exact roles/children and concurrent start claims canonical dispatch only once',async t=>{
  const f=await routeFixture(t);await assert.rejects(f.route.createIntent(f.input,{kind:'human',role:'owner'}),{code:'SESSION_ROUTE_OWNER_REQUIRED'});
  await assert.rejects(f.route.createIntent({...f.input,threadId:'arbitrary'},f.owner),{code:'SESSION_ROUTE_INPUT'});
  const intent=await f.route.createIntent(f.input,f.owner),same=await f.route.createIntent(f.input,f.owner);assert.deepEqual(same,intent);
  const body={projectId:f.p.id,intentId:intent.intentId,operationId:intent.operationId},hold=gate();f.setHold(hold);
  const first=f.route.start(body,f.owner);await hold.entered;const second=await f.route.start(body,f.owner);assert.equal(second.status,'dispatching');assert.equal(f.calls,1);
  hold.release();const started=await first;assert.ok(started.runId);assert.equal(f.calls,1);
  const row=f.store.read().events.find(e=>e.id===intent.intentId),run=f.store.read().runs.find(r=>r.id===started.runId);assert.equal(row.runId,run.id);assert.equal(run.sessionRole.role,'orchestrator');
  assert.throws(()=>f.route.validateContext(f.store.read(),{...run,sessionContext:undefined},{run}),{code:'SESSION_ROUTE_CONTEXT'});
  assert.throws(()=>f.route.qualifyRun(f.store.read(),run),{code:'SESSION_ROUTE_NATIVE_REQUIRED'},'configuration cannot qualify native attachment');
  assert.equal((await f.route.start(body,f.owner)).runId,run.id);assert.equal(f.calls,1);
});

test('task/role/Owner/deadline drift rejects before reservation; unknown start never automatically replays',async t=>{
  const f=await routeFixture(t),intent=await f.route.createIntent(f.input,f.owner),body={projectId:f.p.id,intentId:intent.intentId,operationId:intent.operationId};
  await f.store.transaction(s=>{find(s,'tasks',f.task.id).description='Owner changed scope';});
  await assert.rejects(f.route.start(body,f.owner),{code:'SESSION_ROUTE_CHANGED'});assert.equal(f.calls,0);
  await f.store.transaction(s=>{find(s,'tasks',f.task.id).description=f.task.description;});
  await f.assign(f.child.id,f.childBot.id,'reviewer',1);await assert.rejects(f.route.start(body,f.owner),{code:'SESSION_ROUTE_CHILD_CHANGED'});assert.equal(f.calls,0);
  const next=await f.route.createIntent({...f.input,operationId:crypto.randomUUID()},f.owner);f.advance(300001);
  await assert.rejects(f.route.start({projectId:f.p.id,intentId:next.intentId,operationId:next.operationId},f.owner),{code:'SESSION_ROUTE_INACTIVE'});assert.equal(f.calls,0);
  f.ownerState.active=false;await assert.rejects(f.route.start(body,f.owner),{code:'SESSION_ROUTE_OWNER_REQUIRED'});
});

test('restore preserves consumed intent/run identities and revokes all transient approval',async t=>{
  const f=await routeFixture(t),intent=await f.route.createIntent(f.input,f.owner),body={projectId:f.p.id,intentId:intent.intentId,operationId:intent.operationId};
  const started=await f.route.start(body,f.owner),previous=f.store.read(),restored=structuredClone(previous);
  restored.events=restored.events.filter(e=>e.type!=='session-route.intent');restored.receipts=restored.receipts.filter(e=>e.type!=='session-route.intent');restored.runs=restored.runs.filter(r=>!r.sessionContext);
  mergeSessionRouteSafety(restored,previous);assert.equal(restored.events.find(e=>e.id===intent.intentId).status,'unknown');assert.equal(restored.runs.find(r=>r.id===started.runId).status,'unknown');
  assert.ok(restored.receipts.some(r=>r.operationId===f.input.operationId));await f.route.invalidateForRestore();await f.route.recover();
  const replay=await f.route.start(body,f.owner);assert.equal(replay.status,'unknown');assert.equal(f.calls,1);
  assert.throws(()=>f.route.validateContext(f.store.read(),f.store.read().runs.find(r=>r.id===started.runId)),{code:'SESSION_ROUTE_INACTIVE'});
});

test('Owner can revoke an unstarted retained approval without dispatch or revival',async t=>{
  const f=await routeFixture(t),intent=await f.route.createIntent(f.input,f.owner),body={projectId:f.p.id,intentId:intent.intentId,operationId:intent.operationId};
  await assert.rejects(f.route.cancel(body,{}),{code:'SESSION_ROUTE_OWNER_REQUIRED'});
  assert.equal((await f.route.cancel(body,f.owner)).status,'cancelled');assert.equal((await f.route.cancel(body,f.owner)).status,'cancelled');
  assert.equal((await f.route.start(body,f.owner)).status,'cancelled');assert.equal(f.calls,0);
  assert.equal((await f.route.createIntent(f.input,f.owner)).status,'cancelled');assert.equal(f.calls,0);
});

test('workspace exception is exact two-tool attested parent only and unrelated writable runs remain blocked',async t=>{
  const f=await fixture(t),parent=f.store.read().runs.find(r=>r.id===f.parent.id);
  const inject=s=>{const p=find(s,'runs',parent.id);p.guardedContext={profile:{purpose:'supervised-orchestrator-v1',attemptId:p.attemptId,scope:{capabilities:['session_children','session_prompt']}}};p.guardedReceipt={owner:'supervised-orchestrator-native-session'};p.nativeProviderTurnId='fixture-native-turn';p.guardedProjection={providerTurn:{id:'fixture-native-turn',status:'running'}};};
  assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id,{orchestratorRunId:parent.id}),{code:'SESSION_ORCHESTRATOR_SCOPE'});
  await f.store.transaction(inject);assert.doesNotThrow(()=>assertWorkspaceAvailable(f.store.read(),f.p.id,{orchestratorRunId:parent.id}));
  await f.store.transaction(s=>{s.runs.push(entity({status:'unknown',attemptId:'other-attempt'},f.p.id));});
  assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id,{orchestratorRunId:parent.id}),{code:'WORKSPACE_BUSY'});
  await f.store.transaction(s=>{find(s,'runs',parent.id).guardedContext.profile.scope.capabilities.push('workspace.write');});
  assert.throws(()=>assertWorkspaceAvailable(f.store.read(),f.p.id,{orchestratorRunId:parent.id}),{code:'SESSION_ORCHESTRATOR_SCOPE'});
});

test('real Conversation final fence rechecks role after asynchronous native setup without an effect',async t=>{
  const f=await fixture(t),hold=gate();let effects=0;
  await f.store.transaction(s=>{find(s,'runs',f.parent.id).status='completed';});
  const real=createConversationService({store:f.store,getSessionRoles:()=>f.roles,providers:{validateSelection:()=>f.selection},t3:{providers:{async ensureProject(){hold.enter();await hold.promise;return {id:'fixture-t3-project'};},async call(tag){if(tag==='t3_thread_read')return {thread:{threadId:`thread-${f.child.id}`,projectId:'fixture-t3-project',providerInstanceId:f.selection.instanceId,runtimeMode:'approval-required'},items:[]};effects++;throw Error('must not dispatch');}}}});t.after(()=>real.close());
  const sending=real.send({projectId:f.p.id,conversationId:f.child.id,botId:f.childBot.id,text:'Bounded role test',operationId:crypto.randomUUID()});await hold.entered;
  const r=f.store.read().runs.at(-1),captured=structuredClone(r.sessionRole);await f.assign(f.child.id,f.childBot.id,'reviewer',1);hold.release();
  const result=await sending;assert.equal(result.status,'failed');assert.equal(effects,0);assert.equal(result.error.code,'SESSION_ROLE_STALE');assert.deepEqual(result.sessionRole,captured);
});
