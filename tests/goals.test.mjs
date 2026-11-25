// Engineering qualification: actual SQLite and local artifact bytes. The T3
// transport/execution lifecycle is injected, not a live provider/model run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {entity,changed} from '../app/server/domain.mjs';
import {validateGoalContext,goalPrompt,dispatchGoalRequest,GOAL_HTTP_METHODS} from '../app/goals/index.mjs';

import {fixture,hash,allow} from './goals-fixture.test.mjs';
const code=c=>e=>e.code===c;

test('actual bytes, independent QA and explicit same-human Owner review complete canonical tasks',async t=>{
  const f=await fixture(t);let g=await f.start();assert.equal(f.starts,1);
  assert.equal(g.attempts[0].context.criteriaDigest,g.criteriaDigest);
  assert.match(goalPrompt(g.attempts[0].context),/model completion claim cannot complete/);
  g=await f.finish(g);assert.equal(g.progress.passed,1);assert.equal(g.status,'active');
  await assert.rejects(f.call('review',g,{},f.owner),code('QA_REQUIRED'));
  await assert.rejects(f.call('qa',g,{taskId:f.tasks[0].id},f.executor),code('INDEPENDENT_QA_REQUIRED'));
  await assert.rejects(f.call('qa',g,{taskId:f.tasks[0].id}),code('HUMAN_REVIEW_REQUIRED'));
  g=await f.call('qa',g,{taskId:f.tasks[0].id},f.owner);assert.equal(g.status,'awaiting_owner');
  assert.equal(f.store.read().tasks[0].status,'done');
  g=await f.call('review',g,{},f.owner);assert.equal(g.status,'completed');
  const s=f.store.read();assert.ok(s.events.some(e=>e.type==='goal.qa'));assert.ok(s.events.some(e=>e.type==='goal.owner-review'));
  assert.deepEqual(s.projects[0].profile,f.p.profile);
});

test('file tampering fails both QA and final acceptance; model text and run status are insufficient',async t=>{
  const f=await fixture(t);let g=await f.start();g=await f.finish(g);
  const r=f.store.read().runs[0],file=path.join(f.p.workspace,`${r.id}.txt`);
  await writeFile(file,'tampered');await assert.rejects(f.call('qa',g,{taskId:f.tasks[0].id},f.owner),code('EVIDENCE_REGRESSION'));
  await writeFile(file,'actual deterministic output');g=await f.call('qa',g,{taskId:f.tasks[0].id},f.owner);
  await writeFile(file,'tampered again');await assert.rejects(f.call('review',g,{},f.owner),code('EVIDENCE_REGRESSION'));
});

test('fixed versioned trusted verifier receipts qualify without caller-provided success',async t=>{
  const f=await fixture(t);const criteria=[{id:'verifier',taskId:f.tasks[0].id,description:'Trusted static verifier',kind:'verifierReceipt',verifier:{id:'fixture-verifier',version:'1'}}];
  let g=await f.start({criteria});g=await f.finish(g,{evidence:false,verifier:{id:'wrong',version:'1'}});assert.equal(g.progress.passed,0);
  g=await f.call('advance',g);g=await f.finish(g,{evidence:false,verifier:{id:'fixture-verifier',version:'1'}});assert.equal(g.progress.passed,1);
});

test('retries continue until actual evidence passes and keep stable owner/context/attempt IDs',async t=>{
  const f=await fixture(t);let g=await f.start();g=await f.finish(g,{evidence:false});assert.equal(g.progress.passed,0);
  const first=g.attempts[0];g=await f.call('advance',g);assert.equal(g.attempts.length,2);
  assert.notEqual(g.attempts[1].id,first.id);assert.notEqual(g.attempts[1].operationId,first.operationId);assert.ok(g.attempts[1].context.feedback);
  g=await f.finish(g);assert.equal(g.progress.passed,1);assert.equal(f.starts,2);
});

test('late trusted evidence rechecks the same terminal attempt and retains failed verification history without redispatch',async t=>{
  const f=await fixture(t),verifier={id:'late-reviewed-tests',version:'1'};
  let g=await f.start({criteria:[{id:'tests',taskId:f.tasks[0].id,description:'Reviewed local tests',kind:'verifierReceipt',verifier}],policy:{...allow,maxAttemptsPerTask:1}});
  g=await f.finish(g,{evidence:false});
  const oldId=g.attempts[0].verificationId,runId=g.attempts[0].runId;
  assert.equal(g.blockers[f.tasks[0].id].code,'TASK_ATTEMPT_LIMIT');
  g=await f.call('reconcile',g);
  assert.equal(g.attempts[0].verificationId,oldId,'Unchanged missing evidence does not create verification records');
  await f.store.transaction(s=>s.events.push(entity({type:'verification.result',runId,status:'PASSED',verifier,checkedAt:new Date().toISOString(),checks:[{status:'PASSED'}]},f.p.id)));
  const input=f.input({goalId:g.id,expectedRevision:g.revision});
  g=await f.service.reconcile(input);
  assert.equal(g.progress.passed,1);assert.equal(f.starts,1);assert.equal(g.attempts.length,1);
  assert.deepEqual(g.attempts[0].verificationHistory,[oldId]);assert.equal(g.blockers[f.tasks[0].id],undefined);
  const current=f.store.read().events.find(e=>e.id===g.attempts[0].verificationId);
  assert.equal(current.supersedes,oldId);assert.equal(f.store.read().events.find(e=>e.id===oldId).status,'FAILED');
  await f.service.reconcile(input);assert.equal(f.starts,1);
  g=await f.call('qa',g,{taskId:f.tasks[0].id},f.owner);g=await f.call('review',g,{},f.owner);
  assert.equal(g.status,'completed');
});

test('unchanged failures stop the affected task, independent ready work proceeds',async t=>{
  const f=await fixture(t);let g=await f.start({taskIds:f.tasks.slice(0,2).map(x=>x.id)});
  g=await f.finish(g,{evidence:false});g=await f.call('advance',g);g=await f.finish(g,{evidence:false});
  assert.equal(g.blockers[f.tasks[0].id].code,'UNCHANGED_FAILURE');assert.equal(f.store.read().tasks[0].status,'blocked');
  g=await f.call('advance',g);assert.equal(g.attempts.at(-1).taskId,f.tasks[1].id);
  g=await f.finish(g);assert.equal(g.progress.passed,1);
});

test('bounded auto driver retries, stops unchanged failure, never self-approves',async t=>{
  const f=await fixture(t);f.control.completeImmediately=true;
  let g=await f.create({policy:{...allow,mode:'bounded-auto',maxUnchangedFailures:2}});g=await f.call('resume',g);
  for(let n=0;n<100&&f.goal(g).status!=='blocked';n++)await delay(10);
  g=f.goal(g);assert.equal(f.starts,2);assert.equal(g.status,'blocked');assert.equal(g.blockers[f.tasks[0].id].code,'UNCHANGED_FAILURE');assert.equal(g.review,undefined);
});

test('DAG dependencies require QA-backed canonical done; independent work remains ready',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.tasks[1].dependsOn=[s.tasks[0].id];});
  let g=await f.start({taskIds:f.tasks.slice(0,2).map(x=>x.id)});g=await f.finish(g);
  g=await f.call('advance',g,{taskId:f.tasks[1].id});assert.equal(g.status,'awaiting_qa');assert.equal(f.starts,1);
  g=await f.call('qa',g,{taskId:f.tasks[0].id},f.owner);g=await f.call('advance',g,{taskId:f.tasks[1].id});assert.equal(f.starts,2);
});

test('atomic competing checkouts and stale revisions never dispatch twice',async t=>{
  const f=await fixture(t);let g=await f.create();g=await f.call('resume',g);
  const input=f.input({goalId:g.id,expectedRevision:g.revision});
  const results=await Promise.allSettled([f.service.advance(input),f.service.advance({...input,operationId:crypto.randomUUID()})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.starts,1);
  await f.service.advance(input);assert.equal(f.starts,1);
  await assert.rejects(f.service.advance({...input,taskId:f.tasks[1].id}),code('OPERATION_REUSE'));
  const other=await f.create({taskIds:[f.tasks[1].id]});const active=await f.call('resume',other);
  await assert.rejects(f.call('advance',active),code('WORKSPACE_BUSY'));
});

test('unknown run without durable receipt never auto-replays across restart, resume, or reconcile',async t=>{
  const f=await fixture(t);f.control.loseBefore=true;let g=await f.start();assert.equal(g.status,'unknown');
  g=await f.restart();assert.equal(g.status,'unknown');assert.equal(f.starts,1);
  g=await f.call('reconcile',g);assert.equal(g.status,'unknown');
  await assert.rejects(f.call('resume',g),code('RECONCILE_REQUIRED'));
  await assert.rejects(f.call('advance',g),code('GOAL_INACTIVE'));
  g=await f.call('cancel',g);assert.equal(g.status,'cancelling');assert.equal(f.stops,0);
  await delay(30);assert.equal(f.starts,1);
});

test('lost accepted response reconciles the durable exact run; no retry is issued',async t=>{
  const f=await fixture(t);f.control.loseAfter=true;let g=await f.start();assert.equal(g.status,'unknown');
  g=await f.finish(g);assert.equal(g.progress.passed,1);assert.equal(f.starts,1);
});

test('pause stops exact owned run once, resume retains elapsed deadline and attempts',async t=>{
  const f=await fixture(t);let g=await f.start(),deadline=g.deadlineAt;
  const r=f.store.read().runs[0];g=await f.call('pause',g);assert.equal(g.status,'paused');assert.equal(f.stops,1);
  assert.equal(f.store.read().runs.find(x=>x.id===r.id).status,'interrupted');
  g=await f.call('resume',g);assert.equal(g.deadlineAt,deadline);assert.equal(g.attempts.length,1);
  g=await f.call('advance',g);assert.equal(g.attempts.length,2);
  g=await f.call('cancel',g);assert.equal(g.status,'cancelled');await assert.rejects(f.call('resume',g),code('RECONCILE_REQUIRED'));
});

test('pause while dispatch is in flight never claims cancellation before exact run appears',async t=>{
  const f=await fixture(t);let release,arrived;
  const waiting=new Promise(r=>release=r),entered=new Promise(r=>arrived=r);
  f.control.before=async()=>{arrived();await waiting;};
  let g=await f.create();g=await f.call('resume',g);const dispatch=f.call('advance',g);
  await entered;g=await f.call('pause',g);assert.equal(g.status,'pausing');assert.equal(f.stops,0);
  release();g=await dispatch;assert.equal(g.status,'pausing');assert.equal(f.stops,0);assert.equal(f.store.read().runs.length,0);
  await assert.rejects(f.call('resume',g),code('RECONCILE_REQUIRED'));
});

test('unknown Stop is not reissued on reconcile or watchdog; unrelated runs stay untouched',async t=>{
  const f=await fixture(t);f.control.stopUnknown=true;let g=await f.start();g=await f.call('cancel',g);
  assert.equal(g.status,'cancelling');g=await f.call('reconcile',g);assert.equal(f.stops,1);
  assert.equal(g.attempts[0].stopRequest.status,'unknown');
});

test('watchdog enforces elapsed time against only the exact owned execution',async t=>{
  const f=await fixture(t);let g=await f.start({policy:{...allow,maxMs:50}});f.tick(100);
  await delay(100);g=f.goal(g);assert.equal(g.status,'exhausted');assert.equal(f.stops,1);
  assert.equal(g.attempts[0].stopRequest.runId,f.store.read().runs[0].id);
});

test('attempt limits and observed token/currency caps stop continuation without estimated prices',async t=>{
  const f=await fixture(t);let g=await f.start({policy:{...allow,maxAttempts:1}});g=await f.finish(g,{evidence:false});g=await f.call('advance',g);assert.equal(g.status,'exhausted');assert.equal(f.starts,1);
  const second=await f.create({taskIds:[f.tasks[1].id],policy:{tokens:{unknown:'block',maxTotal:10},reportedCost:{unknown:'block',maxAmount:2,currency:'THB'}}});
  let h=await f.call('resume',second);h=await f.call('advance',h);h=await f.finish(h,{evidence:false,usage:{totalTokens:10,source:'injected-trusted-runtime'},cost:{amount:1,currency:'THB',source:'injected-trusted-runtime'}});
  assert.equal(h.status,'exhausted');assert.equal(h.blocker.code,'TOKEN_LIMIT');assert.equal(h.usage.tokens.total,10);assert.equal(h.usage.reportedCost.perCurrency.THB,1);
});

test('unknown usage blocks by explicit policy; allowing unknown preserves null totals',async t=>{
  const f=await fixture(t);let g=await f.start({policy:{}});g=await f.finish(g,{evidence:false});assert.equal(g.status,'blocked');assert.equal(g.blocker.code,'TOKENS_UNKNOWN');assert.equal(g.usage.tokens.total,null);
  await f.call('cancel',g);
  let h=await f.start({taskIds:[f.tasks[1].id],policy:{...allow,reportedCost:{unknown:'allow',maxAmount:2,currency:'USD'}}});
  h=await f.finish(h,{evidence:false,cost:{amount:2,currency:'USD',source:'runtime-reported'}});assert.equal(h.status,'exhausted');assert.equal(h.blocker.code,'REPORTED_SPENDING_LIMIT');
});

test('cycle, cross-project and plan/ownership changes fail closed without losing reviewed plan',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.tasks[0].dependsOn=[s.tasks[1].id];s.tasks[1].dependsOn=[s.tasks[0].id];});
  await assert.rejects(f.create(),code('CYCLE'));
  await f.store.transaction(s=>{s.tasks[0].dependsOn=[];s.tasks[1].dependsOn=[];});
  await assert.rejects(f.create({projectId:f.q.id}),code('NOT_FOUND'));
  let g=await f.create();g=await f.call('resume',g);
  await f.store.transaction(s=>{s.tasks[0].botId=null;changed(s.tasks[0]);});
  await assert.rejects(f.call('advance',g),code('TASK_CHANGED'));assert.equal(f.starts,0);assert.equal(f.store.read().plans[0].approved,true);
});

test('Owner revisions invalidate QA, retain previous attempts and original time bounds',async t=>{
  const f=await fixture(t);let g=await f.start();g=await f.finish(g);g=await f.call('qa',g,{taskId:f.tasks[0].id},f.owner);const deadline=g.deadlineAt;
  const d={planId:g.planId,objective:'Explicit Owner revised target',taskIds:g.taskIds,criteria:g.criteria,policy:{...g.policy,maxMs:3600000}};
  await assert.rejects(f.call('revise',g,d),code('HUMAN_REVIEW_REQUIRED'));
  g=await f.call('revise',g,d,f.owner);assert.equal(g.goalRevision,2);assert.equal(g.deadlineAt,deadline);assert.equal(g.attempts.length,1);assert.deepEqual(g.qa,{});assert.equal(g.status,'paused');
  assert.equal(f.store.read().events.filter(e=>e.type==='goal.revision').length,2);
});

test('T3 unsupported, ignored context and foreign owner are exposed; generic dispatch cannot bypass checkout',async t=>{
  const f=await fixture(t);f.t3.goalContextVersion=0;let g=await f.create();g=await f.call('resume',g);
  await assert.rejects(f.call('advance',g),code('GOAL_CONTEXT_UNSUPPORTED'));assert.equal(f.starts,0);
  f.t3.goalContextVersion=1;f.control.ignoreContext=true;g=await f.call('advance',g);assert.equal(g.status,'unknown');
  assert.throws(()=>validateGoalContext(f.store.read(),{projectId:f.p.id,taskId:f.tasks[1].id}),code('GOAL_CONTEXT_REQUIRED'));
  g=await f.call('pause',g);assert.equal(f.stops,1);assert.equal(g.status,'paused');
});

test('HTTP allowlist rejects body reviewer/approved/caller and private recovery/execution methods',async t=>{
  const f=await fixture(t);let g=await f.create();
  assert.ok(!GOAL_HTTP_METHODS.includes('recover'));assert.ok(!GOAL_HTTP_METHODS.includes('close'));
  await assert.rejects(dispatchGoalRequest(f.service,'recover',{}),code('NOT_FOUND'));
  await assert.rejects(dispatchGoalRequest(f.service,'qa',f.input({goalId:g.id,expectedRevision:g.revision,taskId:f.tasks[0].id,reviewer:'owner',approved:true,caller:f.owner})),code('VALIDATION'));
  assert.equal((await dispatchGoalRequest(f.service,'state',{projectId:f.p.id})).capabilities.parallelExecution,false);
});

test('foreign durable owner cannot be stopped or inspected through a matching operation',async t=>{
  const f=await fixture(t);f.control.foreign=true;let g=await f.start();assert.equal(g.status,'unknown');
  await assert.rejects(f.call('pause',g),code('RUN_SCOPE'));assert.equal(f.stops,0);assert.equal(f.store.read().runs[0].status,'running');
});

test('admission rejects tampered revision, criteria, task and attempt context before execution',async t=>{
  const f=await fixture(t);let examined=false;
  f.control.before=async input=>{
    const s=f.store.read();
    for(const patch of [{goalRevision:99},{criteriaDigest:'forged'},{attemptId:'forged'},{taskId:f.tasks[1].id},{claimId:'forged'}]){
      assert.throws(()=>validateGoalContext(s,{...input,goalContext:{...input.goalContext,...patch}},()=>Date.now()));
    }
    assert.deepEqual(validateGoalContext(s,input),input.goalContext);examined=true;
  };
  await f.start();assert.equal(examined,true);assert.equal(f.store.read().runs.length,1);
});

test('dependency and ownership races are revalidated in the final authoritative reservation',async t=>{
  const f=await fixture(t);f.control.before=async()=>{await f.store.transaction(s=>{s.tasks[0].dependsOn=[s.tasks[1].id];changed(s.tasks[0]);});};
  const g=await f.start();assert.equal(g.status,'unknown');assert.equal(f.store.read().runs.length,0);assert.equal(g.attempts[0].error,'TASK_CHANGED');
  assert.equal(f.service.state({projectId:f.p.id}).claims.filter(c=>c.status==='held').length,1);
});

test('another unknown chat and overlapping project workspace prevent checkout',async t=>{
  const f=await fixture(t);let g=await f.create();g=await f.call('resume',g);
  await f.store.transaction(s=>{s.projects.find(p=>p.id===f.q.id).workspace=path.join(f.p.workspace,'nested');s.runs.push(entity({status:'unknown',taskId:null},f.q.id));});
  await assert.rejects(f.call('advance',g),code('WORKSPACE_BUSY'));assert.equal(f.starts,0);
});

test('per-task attempt bound stops changed failures and permits independent ready tasks',async t=>{
  const f=await fixture(t);let g=await f.start({taskIds:f.tasks.slice(0,2).map(x=>x.id),policy:{...allow,maxAttemptsPerTask:2,maxUnchangedFailures:8}});
  g=await f.finish(g,{bytes:'different output A'});g=await f.call('advance',g);g=await f.finish(g,{bytes:'different output B'});
  assert.equal(g.blockers[f.tasks[0].id].code,'TASK_ATTEMPT_LIMIT');g=await f.call('advance',g);assert.equal(g.attempts.at(-1).taskId,f.tasks[1].id);
});

test('concurrent goal creation shares canonical task ownership; no competing planner records appear',async t=>{
  const f=await fixture(t);const results=await Promise.allSettled([f.create(),f.create()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'GOAL_EXISTS');
  assert.equal(f.store.read().tasks.length,3);assert.equal(f.store.read().plans.length,1);assert.equal(f.store.read().schemaVersion,1);
});

test('restart between terminal rounds pauses auto continuation and retains stable run identities',async t=>{
  const f=await fixture(t);let g=await f.start();g=await f.finish(g,{evidence:false});const operation=g.attempts[0].operationId;
  g=await f.restart();assert.equal(g.status,'paused');assert.equal(f.starts,1);assert.equal(g.attempts[0].operationId,operation);
  g=await f.call('resume',g);g=await f.call('advance',g);assert.equal(f.starts,2);
});

test('a late exact run after an unknown cancelled dispatch is stopped once on durable observation',async t=>{
  const f=await fixture(t);f.control.loseBefore=true;let g=await f.start();g=await f.call('cancel',g);assert.equal(g.status,'cancelling');
  const a=g.attempts[0];
  await f.store.transaction(s=>{s.runs.push(entity({operationId:a.operationId,taskId:a.taskId,botId:a.botId,conversationId:a.conversationId,goalContext:a.context,status:'running'},f.p.id));});
  for(let n=0;n<60&&f.goal(g).status!=='cancelled';n++)await delay(10);
  assert.equal(f.goal(g).status,'cancelled');assert.equal(f.stops,1);assert.equal(f.starts,1);
});

test('partial measurable progress reports actual passed criteria without completing the task',async t=>{
  const f=await fixture(t);const criteria=[{id:'bytes',taskId:f.tasks[0].id,description:'Correct bytes',kind:'artifactHash',sha256:hash},{id:'additional-verifier',taskId:f.tasks[0].id,description:'Versioned verifier',kind:'verifierReceipt',verifier:{id:'qualifier',version:'1'}}];
  let g=await f.start({criteria});g=await f.finish(g);assert.equal(g.progress.passed,1);assert.equal(g.progress.total,2);assert.equal(g.progress.perTask[f.tasks[0].id].status,'FAILED');
  await assert.rejects(f.call('qa',g,{taskId:f.tasks[0].id},f.owner),code('EVIDENCE_REQUIRED'));
});

test('canonical blocked work is preserved while another ready task executes',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.tasks[0].status='blocked';changed(s.tasks[0]);});
  const g=await f.start({taskIds:f.tasks.slice(0,2).map(t=>t.id)});assert.equal(g.attempts[0].taskId,f.tasks[1].id);assert.equal(f.store.read().tasks[0].status,'blocked');
});

test('canonical task-status race rejects final provider admission without changing plan approval',async t=>{
  const f=await fixture(t);f.control.before=async()=>f.store.transaction(s=>{s.tasks[0].status='blocked';changed(s.tasks[0]);});
  const g=await f.start();assert.equal(g.status,'unknown');assert.equal(g.attempts[0].error,'GOAL_CONTEXT');assert.equal(f.store.read().runs.length,0);assert.equal(f.store.read().plans[0].approved,true);
});
