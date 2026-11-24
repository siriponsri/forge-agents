import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,provenance} from './assistance-fixture.test.mjs';
import {assistancePrompt,validateAssistanceContext} from '../app/assistance/index.mjs';

test('Executor -> stuck Asst -> reviewed Executor handoff stays on one task/bot and requires human review',async t=>{
  const h=await fixture(t);let l=await h.loop();l=await h.advance(l);
  assert.equal(l.status,'running');assert.equal(l.attempts[0].role,'executor');
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'stuck',reason:'blocked',provenance}),{code:'RECONCILE_REQUIRED'});
  l=await h.complete(l);await assert.rejects(h.transition(l,{action:'escalate',trigger:'every-task'}),{code:'TRIGGER_REQUIRED'});
  l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed dependency conflict',provenance});l=await h.advance(l);
  assert.equal(l.attempts[1].role,'asst');assert.match(assistancePrompt(l.attempts[1].context),/does not approve/);
  l=await h.complete(l);await assert.rejects(h.transition(l,{action:'approve',reviewer:'owner',evidence:'checked'}),{code:'REVIEW_REQUIRED'});
  l=await h.transition(l,{action:'return',feedback:'Reviewed diagnosis: apply the bounded dependency fix.',provenance});
  l=await h.advance(l);l=await h.complete(l);
  l=await h.transition(l,{action:'approve',reviewer:'fixture-owner',evidence:'Inspected actual fixture output and scoped diff'});
  assert.equal(l.status,'completed');assert.deepEqual(l.attempts.map(a=>a.role),['executor','asst','executor']);
  const runs=h.store.read().runs;assert.equal(runs.length,3);for(const r of runs){assert.equal(r.taskId,h.task.id);assert.equal(r.botId,h.bot.id);assert.equal(r.assistanceContext.runtimeMode,'approval-required');assert.equal(r.selection.instanceId,r.providerInstanceId);}
  assert.equal(h.store.read().projects[0].profile.provider.model,'unchanged');
});

test('explicit difficult-work evidence permits bounded assistance, ordinary tasks never schedule Asst',async t=>{
  const h=await fixture(t);let l=await h.loop({constraints:{difficulty:{kind:'difficult',reason:'Owner-classified complex migration',provenance}}});
  l=await h.advance(l);assert.equal(l.attempts[0].role,'executor');l=await h.complete(l);
  l=await h.transition(l,{action:'escalate',trigger:'difficult'});l=await h.advance(l);l=await h.complete(l);
  l=await h.transition(l,{action:'return',feedback:'Reviewed plan',provenance});l=await h.advance(l);l=await h.complete(l);
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'difficult'}),{code:'ESCALATION_LIMIT'});
});

test('human plan revocation, helper scope and foreign project refuse work before dispatch',async t=>{
  const h=await fixture(t);const l=await h.loop();await h.store.transaction(s=>{s.plans[0].approved=false;});
  await assert.rejects(h.advance(l),{code:'PLAN_REQUIRED'});
  await h.store.transaction(s=>{s.plans[0].approved=true;s.bots[0].kind='helper';s.bots[0].taskId='other';});
  await assert.rejects(h.advance(l),{code:'BOT_SCOPE'});
  await assert.rejects(h.service.advance(h.input({projectId:h.q.id,loopId:l.id,expectedRevision:l.revision})),{code:'NOT_FOUND'});assert.equal(h.turns,0);
});

test('missing or ignored T3 seam never falls back; durable route/context mismatch freezes further work',async t=>{
  const h=await fixture(t);let l=await h.loop();delete h.t3.assistanceContextVersion;
  await assert.rejects(h.advance(l),{code:'ASSISTANCE_CONTEXT_UNSUPPORTED'});assert.equal(h.turns,0);
  h.t3.assistanceContextVersion=1;h.control.ignoreContext=true;l=await h.advance(l);assert.equal(l.status,'unknown');assert.equal(h.turns,1);
  l=await h.reconcile(l);assert.equal(l.status,'unknown');assert.equal(l.history.at(-1).errorCode,'CONTEXT_MISMATCH');
  await assert.rejects(h.advance(l),{code:'RECONCILE_REQUIRED'});assert.equal(h.turns,1);
});

test('lost accepted response + SQLite restart reconcile exact attempt without redispatch',async t=>{
  const h=await fixture(t);let l=await h.loop();h.control.loseAfter=true;
  const input=h.input({loopId:l.id,expectedRevision:l.revision});l=await h.service.advance(input);assert.equal(l.status,'unknown');assert.equal(h.turns,1);
  await h.restart();assert.equal(h.turns,1);assert.equal(h.service.state({projectId:h.p.id}).loops[0].status,'unknown');
  await h.service.advance(input);assert.equal(h.turns,1);l=await h.reconcile(l);assert.equal(l.status,'running');
  l=await h.complete(l);assert.equal(l.attempts[0].reconciled,true);assert.equal(h.turns,1);
});

test('no durable run after unknown outcome cannot create new attempt, even after restart',async t=>{
  const h=await fixture(t);let l=await h.loop();h.control.loseBefore=true;l=await h.advance(l);const op=l.attempts[0].operationId;
  assert.equal(l.status,'unknown');await h.restart();l=await h.reconcile(l);assert.equal(l.status,'unknown');
  await assert.rejects(h.advance(l),{code:'RECONCILE_REQUIRED'});await assert.rejects(h.transition(l,{action:'escalate',trigger:'stuck',reason:'guess',provenance}),{code:'RECONCILE_REQUIRED'});
  assert.equal(l.attempts.length,1);assert.equal(l.attempts[0].operationId,op);assert.equal(h.turns,0);
});

test('stop before dispatch, active stop and stop racing a delayed accepted response prevent extra effects',async t=>{
  const h=await fixture(t);let l=await h.loop();l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopped');await assert.rejects(h.advance(l),{code:'LOOP_STOPPED'});assert.equal(h.turns,0);
  l=await h.loop();let release,entered;const accepted=new Promise(r=>entered=r);h.control.afterStart=async()=>{entered();await new Promise(r=>release=r);};
  const start=h.advance(l);await accepted;l=h.service.state({projectId:h.p.id}).loops.at(-1);
  l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopped');release();l=await start;
  assert.equal(l.status,'stopped');assert.equal(h.turns,1);assert.equal(h.stops,1);await assert.rejects(h.advance(l),{code:'LOOP_STOPPED'});
});

test('unknown Stop never claims cancellation and recovery never dispatches',async t=>{
  const h=await fixture(t);let l=await h.loop();l=await h.advance(l);h.control.stopUnknown=true;
  l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopping');await h.restart();l=await h.reconcile(l);assert.equal(l.status,'stopping');assert.equal(h.turns,1);
  h.control.stopUnknown=false;await h.store.transaction(s=>{s.runs[0].status='interrupted';});l=await h.reconcile(l);assert.equal(l.status,'stopped');assert.equal(h.turns,1);assert.equal(h.stops,1);
});

test('elapsed/attempt/step and reported expenditure policies bound continuation without guessing costs',async t=>{
  const h=await fixture(t);let l=await h.loop({limits:{maxAttempts:1}});l=await h.advance(l);l=await h.complete(l);l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed block',provenance});l=await h.advance(l);assert.equal(l.status,'exhausted');assert.equal(h.turns,1);
  l=await h.loop({limits:{maxMs:2}});h.tick(3);l=await h.advance(l);assert.equal(l.status,'exhausted');assert.equal(h.turns,1);
  l=await h.loop({limits:{reportedCost:{mode:'require-reported',maxAmount:1,currency:'USD'}}});l=await h.advance(l);l=await h.complete(l);l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed block',provenance});
  await assert.rejects(h.advance(l),{code:'COST_UNKNOWN'});assert.equal(h.turns,2);
  await h.store.transaction(s=>{s.runs.at(-1).reportedCost={amount:1,currency:'USD',source:'injected-provider-cost-report'};});
  l=await h.advance(l);assert.equal(l.status,'exhausted');assert.equal(h.turns,2);
});

test('concurrent duplicate command claims one effect; T3 validator rejects forged context',async t=>{
  const h=await fixture(t);const l=await h.loop(),input=h.input({loopId:l.id,expectedRevision:l.revision});
  await Promise.all([h.service.advance(input),h.service.advance(input)]);assert.equal(h.turns,1);
  const run=h.store.read().runs[0],forged={projectId:h.p.id,taskId:h.task.id,operationId:run.operationId,assistanceContext:{...run.assistanceContext,role:'asst'}};
  assert.throws(()=>validateAssistanceContext(h.store.read(),forged),{code:'ASSISTANCE_CONTEXT'});
});

test('plan content edits, provider refresh and explicit policy changes invalidate old decisions',async t=>{
  const h=await fixture(t);let l=await h.loop();await h.store.transaction(s=>{s.plans[0].description='Changed work even though approval flag stayed true';});
  await assert.rejects(h.advance(l),{code:'STALE_DECISION'});assert.equal(h.turns,0);
  await h.service.stop(h.input({loopId:l.id}));l=await h.loop();await h.configure();await assert.rejects(h.advance(l),{code:'STALE_DECISION'});
});

test('mismatched selected route or executed model blocks continuation but Stop retains exact owned identity',async t=>{
  const h=await fixture(t);let l=await h.loop();h.control.ignoreSelection=true;l=await h.advance(l);assert.equal(l.status,'unknown');
  l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopped');assert.equal(h.stops,1);assert.equal(h.turns,1);
  h.control.ignoreSelection=false;l=await h.loop();l=await h.advance(l);
  await h.store.transaction(s=>{s.runs.at(-1).executedModel='fixture-unexpected-fallback';});l=await h.reconcile(l);assert.equal(l.status,'unknown');
  l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopped');assert.equal(h.stops,2);
});

test('step exhaustion, currency separation and disconnected reads cannot authorize continuation',async t=>{
  const h=await fixture(t);let l=await h.loop({limits:{maxSteps:1}});l=await h.advance(l);l=await h.complete(l);l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed problem',provenance});assert.equal(l.status,'exhausted');
  l=await h.loop();l=await h.advance(l);l=await h.complete(l,'completed',{reportedCost:{amount:2,currency:'USD',source:'fixture'}});
  l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed block',provenance});l=await h.advance(l);l=await h.complete(l,'completed',{reportedCost:{amount:3,currency:'THB',source:'fixture'}});
  l=await h.transition(l,{action:'return',feedback:'Owner reviewed handoff',provenance});l=await h.advance(l);
  assert.equal(l.reportedCost.amount,null);assert.deepEqual(l.reportedCost.perCurrency,{USD:2,THB:3});
  l=await h.complete(l);h.control.reconcileError=true;l=await h.reconcile(l);assert.equal(l.attempts.at(-1).reconciled,false);
  await assert.rejects(h.transition(l,{action:'approve',reviewer:'owner',evidence:'check'}),{code:'RECONCILE_REQUIRED'});
});

test('wall-clock watchdog stops the observed T3 run without another provider dispatch',async t=>{
  const h=await fixture(t);let l=await h.loop({limits:{maxMs:150}});l=await h.advance(l);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{unsubscribe();reject(new Error('Assistance deadline did not stop the run'));},3000);
    const unsubscribe=h.store.subscribe(()=>{const current=h.service.state({projectId:h.p.id}).loops.at(-1);if(current.status==='exhausted'){clearTimeout(timer);unsubscribe();resolve();}});
  });
  assert.equal(h.stops,1);assert.equal(h.turns,1);assert.equal(h.store.read().runs[0].status,'interrupted');
});
