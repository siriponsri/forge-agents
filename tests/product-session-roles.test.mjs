import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,gate} from './product-session-roles-fixture.mjs';
import {createConversationService} from '../app/providers/conversations.mjs';
import {createSessionRoleService,mergeSessionRoleSafety,dispatchSessionRoleRequest} from '../app/server/session-roles.mjs';
import {createBudgetService} from '../app/budgets/index.mjs';
import {command} from '../app/server/domain.mjs';

test('private authority, exact parent attempt and explicit Owner membership; no role authorizes plans/tools',async t=>{
  const f=await fixture(t),runCaller=f.callerForRun(f.parent);
  await assert.rejects(f.roles.prompt(f.input,{kind:'owner'}),{code:'SESSION_ROLE_FORBIDDEN'});
  await assert.rejects(f.roles.assign({projectId:f.p.id,operationId:'model-role',conversationId:f.child.id,botId:f.childBot.id,role:'orchestrator',expectedRevision:1},runCaller),{code:'SESSION_ROLE_OWNER_REQUIRED'});
  await assert.rejects(f.roles.bind({projectId:f.p.id,operationId:'model-bind',parentRunId:f.parent.id,childConversationId:f.child.id,childBotId:f.childBot.id},runCaller),{code:'SESSION_ROLE_OWNER_REQUIRED'});
  const children=f.roles.children({projectId:f.p.id,parentRunId:f.parent.id},runCaller);assert.equal(children.children[0].membershipId,f.m.id);
  await assert.rejects(f.roles.prompt({...f.input,threadId:'arbitrary'},runCaller),{code:'SESSION_ROLE_INPUT'});
  await assert.rejects(f.roles.bind({projectId:f.p.id,operationId:'foreign',parentRunId:f.parent.id,childConversationId:f.foreign.id,childBotId:f.foreignBot.id},f.owner),{code:'NOT_FOUND'});
  await assert.rejects(f.roles.prompt({...f.input,projectId:f.q.id},runCaller),{code:'NOT_FOUND'});
  const stale=f.callerForRun({...f.parent,attemptId:'other-attempt'});await assert.rejects(f.roles.prompt(f.input,stale),{code:'SESSION_ROLE_FORBIDDEN'});
  const accepted=await f.roles.prompt(f.input,runCaller);assert.equal(accepted.childRun.status,'running');assert.equal(f.ownerLifecycle.calls,1);assert.equal(f.ownerLifecycle.effects.length,1);
  const s=f.store.read();assert.equal(s.plans.length,0);assert.equal(s.events.filter(e=>e.type==='budget.reservation').length,1);assert.equal(s.runs.length,2);
});

test('durable concurrent replay sends once; changed text/op collisions fail; restart/reconcile never resend',async t=>{
  const f=await fixture(t);f.ownerLifecycle.hold=gate();const sending=f.roles.prompt(f.input,f.owner);await f.ownerLifecycle.hold.entered;
  const replay=await f.roles.prompt(f.input,f.owner);assert.equal(replay.status,'dispatching');assert.equal(f.ownerLifecycle.calls,1);
  await assert.rejects(f.roles.prompt({...f.input,text:'different'},f.owner),{code:'OPERATION_REUSE'});
  const c=f.store.read().events.find(e=>e.type==='session-role.prompt');assert.throws(()=>f.roles.validateDispatch(f.store.read(),{...c.dispatchInput,sessionRoleContext:undefined}),{code:'SESSION_ROLE_CONTEXT'});
  f.ownerLifecycle.hold.release();const result=await sending;assert.equal(result.childRun.id,replay.childRun.id);
  await f.reopen();const recovered=await f.roles.prompt(f.input,f.owner);assert.equal(recovered.id,result.id);assert.equal(f.ownerLifecycle.effects.length,1);
  const reconciled=await f.roles.reconcile({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(reconciled.childRun.status,'completed');assert.equal(f.ownerLifecycle.calls,1);
  await command(f.store,{operationId:'shared-op',type:'settings.update',data:{language:'en'}});
  await assert.rejects(f.roles.prompt({...f.input,operationId:'shared-op'},f.owner),{code:'OPERATION_REUSE'});
});

test('role edits during setup invalidate final dispatch without rewriting the reserved role snapshot',async t=>{
  const f=await fixture(t);f.ownerLifecycle.hold=gate();const sending=f.roles.prompt(f.input,f.owner);await f.ownerLifecycle.hold.entered;
  const r=f.store.read().runs.at(-1),snapshot=structuredClone(r.sessionRoleContext),role=structuredClone(r.sessionRole);
  await f.assign(f.child.id,f.childBot.id,'reviewer',1);f.ownerLifecycle.hold.release();const result=await sending;
  assert.equal(result.childRun.status,'failed');assert.equal(f.ownerLifecycle.effects.length,0);assert.deepEqual(f.store.read().runs.at(-1).sessionRoleContext,snapshot);assert.deepEqual(f.store.read().runs.at(-1).sessionRole,role);
  assert.equal(f.roles.children({projectId:f.p.id,parentRunId:f.parent.id},f.callerForRun(f.parent)).children.length,0);
  await assert.rejects(f.roles.prompt({...f.input,operationId:'changed-role'},f.owner),{code:'SESSION_ROLE_STALE'});
});

test('role edits after dispatch preserve attempt authority; revoked membership fences future prompts',async t=>{
  const f=await fixture(t),result=await f.roles.prompt(f.input,f.owner),before=f.store.read().runs.at(-1);
  await f.assign(f.child.id,f.childBot.id,'reviewer',1);const after=f.store.read().runs.at(-1);assert.deepEqual(after,before);
  await f.roles.revoke({projectId:f.p.id,membershipId:f.m.id,operationId:'revoke',expectedRevision:1},f.owner);
  await assert.rejects(f.roles.prompt({...f.input,operationId:'revoked-prompt'},f.owner),{code:'SESSION_ROLE_MEMBERSHIP'});
  await f.roles.stop({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(f.ownerLifecycle.stopCalls,1);
});

test('Stop during asynchronous admission prevents effects; Stop and unknown response recover exact canonical run',async t=>{
  const f=await fixture(t);f.ownerLifecycle.hold=gate();const pending=f.roles.prompt(f.input,f.owner);await f.ownerLifecycle.hold.entered;
  const c=f.store.read().events.find(e=>e.type==='session-role.prompt');await f.roles.stop({projectId:f.p.id,commandId:c.id},f.owner);f.ownerLifecycle.hold.release();await pending;assert.equal(f.ownerLifecycle.effects.length,0);
  f.ownerLifecycle.hold=null;f.ownerLifecycle.loseResponse=true;const next=await f.roles.prompt({...f.input,operationId:'lost-response'},f.owner);assert.equal(next.childRun.status,'unknown');
  await f.roles.prompt({...f.input,operationId:'lost-response'},f.owner);assert.equal(f.ownerLifecycle.effects.length,1);
  const observed=await f.roles.reconcile({projectId:f.p.id,commandId:next.id},f.owner);assert.equal(observed.childRun.status,'completed');assert.equal(f.ownerLifecycle.calls,2);
});

test('uncertain send before canonical reservation is never resent by replay, recovery or restore',async t=>{
  const f=await fixture(t);f.ownerLifecycle.beforeReserve=()=>{throw new Error('fixture process gap');};const result=await f.roles.prompt(f.input,f.owner);assert.equal(result.status,'unknown');assert.equal(result.childRun,null);
  await f.reopen();await f.roles.prompt(f.input,f.owner);await f.roles.reconcile({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(f.ownerLifecycle.calls,1);
  const previous=f.store.read(),restored=structuredClone(previous);restored.events=restored.events.filter(e=>!e.type.startsWith('session-role.'));restored.receipts=restored.receipts.filter(e=>!e.type?.startsWith('session-role.'));mergeSessionRoleSafety(restored,previous);
  assert.equal(restored.events.find(e=>e.id===f.m.id).status,'revoked');assert.equal(restored.events.find(e=>e.id===result.id).stopRequested,true);assert.ok(restored.receipts.some(e=>e.operationId===f.input.operationId));
});

test('durable Stop on an uncertain accepted send is delivered after exact run identity is observed',async t=>{
  const f=await fixture(t);f.ownerLifecycle.loseResponse=true;f.ownerLifecycle.reconcileStatus='running';const result=await f.roles.prompt(f.input,f.owner);
  assert.equal(result.childRun.providerRunId,undefined);await f.roles.stop({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(f.ownerLifecycle.stopCalls,0);
  const stopped=await f.roles.reconcile({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(stopped.childRun.status,'interrupted');assert.equal(f.ownerLifecycle.stopCalls,1);
  await f.roles.reconcile({projectId:f.p.id,commandId:result.id},f.owner);assert.equal(f.ownerLifecycle.stopCalls,1);assert.equal(f.ownerLifecycle.calls,1);
});

test('queued human command rechecks opaque authority inside SQLite transaction; async claims fail closed',async t=>{
  const f=await fixture(t),hold=gate(),blocking=f.store.transaction(async()=>{hold.enter();await hold.promise;});await hold.entered;
  const change=f.assign(f.child.id,f.childBot.id,'reviewer',1);f.ownerState.active=false;hold.release();await blocking;await assert.rejects(change,{code:'SESSION_ROLE_FORBIDDEN'});
  const invalid=createSessionRoleService({store:f.store,authorize:async()=>({kind:'owner'})});assert.throws(()=>invalid.state({projectId:f.p.id},{}),{code:'SESSION_ROLE_FORBIDDEN'});await invalid.close();
});

test('Budget remains canonical: policy change at final fence prevents dispatch',async t=>{
  const f=await fixture(t),budgets=createBudgetService({store:f.store,t3:{},authorize:()=>({kind:'human',role:'owner',subject:'fixture-owner'})});
  const configure=(operationId,expectedRevision,limit)=>budgets.configure({projectId:f.p.id,operationId,expectedRevision,enabled:true,unknown:'allow',period:'lifetime',limit:{minorUnits:limit,currency:'USD',scale:2},reserve:{minorUnits:20,currency:'USD',scale:2}},f.owner);
  await configure('initial-budget',0,100);f.ownerLifecycle.hold=gate();const sending=f.roles.prompt(f.input,f.owner);await f.ownerLifecycle.hold.entered;await configure('changed-budget',1,80);f.ownerLifecycle.hold.release();const result=await sending;
  assert.equal(result.childRun.status,'failed');assert.equal(f.ownerLifecycle.effects.length,0);assert.equal(f.store.read().events.filter(e=>e.type==='budget.reservation').length,1);
});

test('real conversation owner refuses active parent in shared writable workspace without a provider call',async t=>{
  const f=await fixture(t);let called=0;
  const real=createConversationService({store:f.store,t3:{providers:{ensureProject(){called++;throw new Error('must not run');}}},providers:{validateSelection:()=>f.selection},getSessionRoles:()=>f.roles});t.after(()=>real.close());
  const service=createSessionRoleService({store:f.store,conversations:real,authorize:f.authorize});t.after(()=>service.close());
  const result=await service.prompt(f.input,f.owner);assert.equal(result.status,'unknown');assert.equal(result.error.code,'WORKSPACE_BUSY');assert.equal(called,0);assert.equal(f.store.read().runs.length,1);
});

test('host-only bind shares the Owner boundary/receipt in the existing native writer and replay never revives revocation',async t=>{
  const f=await fixture(t),input={projectId:f.p.id,operationId:'attested-native-running-child',parentRunId:f.parent.id,childConversationId:f.child.id,childBotId:f.childBot.id};
  const linked=await f.store.transaction(s=>{const value=f.roles.bindInTransaction(s,input,f.owner);assert.equal(value?.then,undefined,'host hook is fully synchronous');return value;});
  const replay=await f.roles.bind(input,f.owner);assert.equal(replay.id,linked.id);assert.equal(f.store.read().events.filter(e=>e.type==='session-role.membership').length,2);
  await f.roles.revoke({projectId:f.p.id,operationId:'revoke-native-link',membershipId:linked.id,expectedRevision:1},f.owner);
  const revoked=await f.store.transaction(s=>f.roles.bindInTransaction(s,input,f.owner));assert.equal(revoked.status,'revoked');assert.equal(f.store.read().events.filter(e=>e.type==='session-role.membership').length,2);
  await assert.rejects(f.store.transaction(s=>f.roles.bindInTransaction(s,{...input,operationId:'wrong-project',projectId:f.q.id},f.owner)),{code:'NOT_FOUND'});
  await assert.rejects(f.store.transaction(s=>f.roles.bindInTransaction(s,{...input,operationId:'fake-owner'},{})),{code:'SESSION_ROLE_FORBIDDEN'});
  await assert.rejects(f.store.transaction(s=>f.roles.bindInTransaction(s,{...input,operationId:'agent-bind'},f.callerForRun(f.parent))),{code:'SESSION_ROLE_OWNER_REQUIRED'});
  assert.throws(()=>dispatchSessionRoleRequest(f.roles,'bindInTransaction',input,f.owner),{code:'NOT_FOUND'});
});
