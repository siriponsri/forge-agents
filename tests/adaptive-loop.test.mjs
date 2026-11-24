import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './adaptive-fixture.test.mjs';
import { entity, changed } from '../app/server/domain.mjs';

async function running(f,extra={}){let loop=await f.loop(extra);loop=await f.step(loop);return f.step(loop);}
const commandInput=(f,loop,extra={})=>f.input({loopId:loop.id,expectedRevision:loop.revision,...extra});

test('bounded loop shares resident bot, human plan, sole T3 owner and review evidence',async t => {
  const f=await fixture(t);let loop=await f.loop();assert.equal(loop.stage,'plan');
  await f.store.transaction(s=>{s.plans[0].approved=false;});
  await assert.rejects(f.step(loop),{code:'PLAN_REQUIRED'});
  await f.store.transaction(s=>{s.plans[0].approved=true;});
  loop=await f.step(loop);assert.equal(loop.stage,'execute');loop=await f.step(loop);assert.equal(loop.status,'running');assert.equal(f.turns,1);
  const run=await f.complete(loop),artifact=await f.artifact(run);
  loop=await f.service.reconcile(commandInput(f,loop));assert.equal(loop.stage,'inspect');assert.equal(f.reads,1);
  await assert.rejects(f.step(loop,{checks:[{key:'completion',kind:'runStatus',runId:run.id}]}),{code:'EVIDENCE_SCOPE'});
  loop=await f.step(loop,{checks:[{key:'bytes',kind:'artifactHash',runId:run.id,artifactId:artifact.id,sha256:artifact.sha256}]});assert.equal(loop.stage,'review');
  loop=await f.service.reconcile(commandInput(f,loop));assert.equal(loop.stage,'review');
  await assert.rejects(f.step(loop),{code:'REVIEW_REQUIRED'});
  loop=await f.step(loop,{action:'approve',reviewer:'Human fixture reviewer'});assert.equal(loop.status,'completed');assert.equal(f.turns,1);assert.equal(f.store.read().bots.length,1);assert.equal(loop.botId,f.bot.id);
  loop=await f.service.reconcile(commandInput(f,loop));assert.equal(loop.status,'completed');assert.equal(loop.stage,'review');
  assert.deepEqual(f.store.read().runs[0].adaptiveContext.skillSnapshots[0].instructions,f.skill.instructions);
});

test('duplicate advance/restart does not create second provider turn; operation reuse rejects',async t => {
  const f=await fixture(t);let loop=await f.loop();loop=await f.step(loop);
  const input=commandInput(f,loop);const [a,b]=await Promise.all([f.service.advance(input),f.service.advance(input)]);assert.equal(a.id,b.id);assert.equal(f.turns,1);
  await f.restart();await f.service.advance(input);assert.equal(f.turns,1);
  loop=f.service.status({projectId:f.p.id}).loops[0];
  await assert.rejects(f.step(loop),{code:'RECONCILE_REQUIRED'});
  await assert.rejects(f.service.advance({...input,action:'different'}),{code:'OPERATION_REUSE'});
  assert.equal(loop.attempts.length,1);assert.equal(f.turns,1);
});

test('uncertain submission stays reconcilable and blocks restart/resume duplicates',async t => {
  const f=await fixture(t);f.setStartHook(async()=>{throw new Error('Fixture lost acknowledgement');});
  let loop=await running(f);assert.equal(loop.status,'unknown');assert.equal(f.turns,1);
  await f.restart();loop=f.service.status({projectId:f.p.id}).loops[0];
  await assert.rejects(f.service.resume(commandInput(f,loop)),{code:'RECONCILE_REQUIRED'});
  loop=await f.service.reconcile(commandInput(f,loop));assert.equal(loop.status,'running');assert.equal(f.turns,1);
  loop=await f.service.stop(commandInput(f,loop));assert.equal(loop.status,'stopped');assert.equal(f.stops,1);
  loop=await f.service.resume(commandInput(f,loop));assert.equal(loop.stage,'revise');assert.equal(f.turns,1);
});

test('stop racing in-flight submission retains pending outcome and stops late observed run',async t => {
  const f=await fixture(t);let release;const barrier=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
  f.setStartHook(async()=>{entered();await barrier;});let loop=await f.loop();loop=await f.step(loop);
  const pending=f.service.advance(commandInput(f,loop));await started;
  const reserved=f.service.status({projectId:f.p.id}).loops[0];const stopped=await f.service.stop(commandInput(f,reserved));assert.equal(stopped.status,'stopped');release();
  loop=await pending;assert.equal(loop.status,'stopped');assert.equal(f.store.read().runs[0].status,'interrupted');assert.equal(f.turns,1);
});

test('stop before owner records a run stays pending until the late run is interrupted',async t => {
  const f=await fixture(t),owner=f.t3.startRun;let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.t3.startRun=async input=>{entered();await wait;return owner(input);};
  let loop=await f.loop();loop=await f.step(loop);const pending=f.service.advance(commandInput(f,loop));await started;
  const current=f.service.status({projectId:f.p.id}).loops[0];loop=await f.service.stop(commandInput(f,current));assert.equal(loop.status,'stopping');assert.equal(f.turns,0);
  release();loop=await pending;assert.equal(loop.status,'stopped');assert.equal(f.turns,1);assert.equal(f.stops,1);
});

test('an owner that drops adaptive context is uncertain and cannot start a second attempt',async t => {
  const f=await fixture(t),owner=f.t3.startRun;
  f.t3.startRun=async input=>{const run=await owner(input);await f.store.transaction(s=>{delete s.runs.find(r=>r.id===run.id).adaptiveContext;});return run;};
  const loop=await running(f);assert.equal(loop.status,'unknown');assert.match(loop.history.at(-1).error,/context/);
  await assert.rejects(f.step(loop),{code:'RECONCILE_REQUIRED'});assert.equal(f.turns,1);
});

test('unknown outcome without run record never resubmits and keeps stop uncertain',async t => {
  const f=await fixture(t);let calls=0;f.t3.startRun=async()=>{calls++;throw new Error('Fixture owner unavailable');};
  let loop=await running(f);assert.equal(loop.status,'unknown');
  await f.restart();loop=await f.service.reconcile(commandInput(f,loop));
  await assert.rejects(f.service.resume(commandInput(f,loop)),{code:'RECONCILE_REQUIRED'});
  loop=await f.service.stop(commandInput(f,loop));assert.equal(loop.status,'stopping');assert.equal(calls,1);
});

test('failed stop acknowledgement remains stopping and blocks a competing loop',async t => {
  const f=await fixture(t);let loop=await running(f);f.t3.stop=async()=>{throw new Error('Fixture cancellation acknowledgement lost');};
  loop=await f.service.stop(commandInput(f,loop));assert.equal(loop.status,'stopping');assert.equal(f.store.read().runs[0].status,'running');assert.match(loop.history.at(-1).error,/acknowledgement/);
  await f.restart();await assert.rejects(f.loop(),{code:'LOOP_EXISTS'});
  await assert.rejects(f.service.resume(commandInput(f,loop)),{code:'RECONCILE_REQUIRED'});assert.equal(f.turns,1);
});

test('failed inspection revises with feedback, obeys attempt cap and uses distinct stable operation IDs',async t => {
  const f=await fixture(t);let loop=await running(f,{limits:{maxAttempts:2}}),run=await f.complete(loop);
  loop=await f.service.reconcile(commandInput(f,loop));loop=await f.step(loop,{checks:[{key:'missing',kind:'artifactHash',runId:run.id,artifactId:'missing',sha256:'a'.repeat(64)}]});assert.equal(loop.stage,'revise');
  loop=await f.step(loop,{feedback:'Repair missing evidence'});assert.equal(loop.stage,'plan');loop=await f.step(loop);loop=await f.step(loop);assert.equal(f.turns,2);assert.equal(f.store.read().runs[1].adaptiveContext.feedback,'Repair missing evidence');
  await f.store.transaction(s=>{s.runs[1].status='failed';changed(s.runs[1]);});loop=await f.service.reconcile(commandInput(f,loop));
  loop=await f.step(loop,{feedback:'Cannot continue within budget'});assert.equal(loop.status,'exhausted');assert.notEqual(loop.attempts[0].operationId,loop.attempts[1].operationId);
  await assert.rejects(f.step(loop),{code:'LOOP_STOPPED'});assert.equal(f.turns,2);
});

test('wall-clock watchdog requests T3 stop and restart does not submit a turn',async t => {
  const f=await fixture(t);let loop=await running(f,{limits:{maxMs:400}});
  await f.restart();
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){loop=f.service.status({projectId:f.p.id}).loops[0];if(loop.status==='exhausted')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(loop.status,'exhausted');assert.equal(f.stops,1);assert.equal(f.turns,1);
  await assert.rejects(f.service.resume(commandInput(f,loop)),{code:'LOOP_STOPPED'});
});

test('explicit replay of a crashed reservation preserves its operation ID and single T3 turn',async t => {
  const f=await fixture(t),ownerStart=f.t3.startRun;let calls=0,firstOperation;
  f.t3.startRun=async input=>{calls++;firstOperation ??= input.operationId;assert.equal(input.operationId,firstOperation);if(calls===1)throw new Error('Fixture crashed before owner reservation');return ownerStart(input);};
  let loop=await running(f);assert.equal(loop.status,'unknown');assert.equal(f.turns,0);
  await f.restart();loop=f.service.status({projectId:f.p.id}).loops[0];
  loop=await f.service.resume(commandInput(f,loop,{retryReservation:true}));assert.equal(loop.status,'running');assert.equal(f.turns,1);assert.equal(loop.attempts.length,1);assert.equal(calls,2);
  await assert.rejects(f.service.resume(commandInput(f,loop,{retryReservation:true})),{code:'RECONCILE_REQUIRED'});assert.equal(f.turns,1);
});

test('revised task accepts a new scoped decision and keeps the same resident identity',async t => {
  const f=await fixture(t);let loop=await running(f);
  await f.store.transaction(s=>{s.runs[0].status='failed';s.tasks[0].description='Human adds a bounded repair';changed(s.tasks[0]);});
  loop=await f.service.reconcile(commandInput(f,loop));const decision=await f.selected();
  loop=await f.step(loop,{decisionId:decision.id,feedback:'Use revised human task'});assert.equal(loop.stage,'plan');assert.equal(loop.botId,f.bot.id);assert.equal(loop.decisionId,decision.id);
});

test('step budget blocks dispatch; stale decision/revision and unsupported context fail closed',async t => {
  const f=await fixture(t);let loop=await f.loop({limits:{maxSteps:1}});loop=await f.step(loop);loop=await f.step(loop);assert.equal(loop.status,'exhausted');assert.equal(f.turns,0);
  loop=await f.loop();await f.store.transaction(s=>{s.skills[0].instructions='Changed instructions';changed(s.skills[0]);});await assert.rejects(f.step(loop),{code:'STALE_DECISION'});
  await assert.rejects(f.service.stop(commandInput(f,{...loop,revision:0})),{code:'REVISION_CONFLICT'});
  loop=await f.service.stop(commandInput(f,loop));
  loop=await f.loop();loop=await f.step(loop);delete f.t3.adaptiveContextVersion;
  await assert.rejects(f.step(loop),{code:'ADAPTIVE_CONTEXT_UNSUPPORTED'});assert.equal(f.turns,0);
});

test('helper scope, project scope and competing run owner cannot be bypassed',async t => {
  const f=await fixture(t),decision=await f.selected();
  await assert.rejects(f.service.createLoop(f.input({projectId:f.other.id,taskId:f.task.id,decisionId:decision.id})),{code:'NOT_FOUND'});
  await f.store.transaction(s=>{s.bots[0].kind='helper';s.bots[0].taskId='another-task';});
  await assert.rejects(f.loop(),{code:'BOT_SCOPE'});
  await f.store.transaction(s=>{s.bots[0].taskId=f.task.id;});let loop=await f.loop();loop=await f.step(loop);
  await f.store.transaction(s=>s.runs.push(entity({taskId:f.task.id,botId:f.bot.id,status:'unknown',operationId:'other-owner'},f.p.id)));
  await assert.rejects(f.step(loop),{code:'WORKSPACE_BUSY'});assert.equal(f.turns,0);assert.equal(f.store.read().bots.length,1);
});
