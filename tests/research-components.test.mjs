import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './research-components-fixture.test.mjs';
import {validateResearchComponentContext,runResearchComposition,componentUsage} from '../app/research-components/index.mjs';
import {digest} from '../app/research/contracts.mjs';
const code=code=>e=>e.code===code;

test('headless ON uses actual existing owners for primary/helper/revision, reviewed skills, independent evidence and helper data',async t=>{
  const x=await fixture(t,{wrongPrimary:true});
  const result=await runResearchComposition({service:x.service,caller:x.owner,projectId:x.f.p.id,trialId:x.trial.id,slots:x.slots});
  assert.equal(result.data.status,'PASSED');assert.equal(x.f.starts,3);assert.deepEqual(result.data.attempts.map(x=>x.allocation.role),['primary','helper','revision']);
  assert.equal(result.sha256,digest(result.data));assert.equal(result.data.attempts[0].evidence.status,'FAILED');assert.equal(result.data.attempts[2].evidence.status,'PASSED');
  for(const m of x.messages)assert.match(m.message,/REVIEWED_TABLE_SKILL_V1/);
  assert.match(x.messages[2].message,/untrusted DATA/);assert.match(x.messages[2].message,/evidence:input-intact-artifact-observed-answer-check-failed/);
  for(const attempt of result.data.attempts){const resolved=x.resolve(attempt.allocation,{runId:attempt.run.id,attemptId:attempt.run.attemptId});assert.equal(resolved.envelope.allocationCount,3);assert.equal(resolved.manifest.configDigest,x.experiment.configDigest);assert.equal(resolved.workspace.taskId,attempt.run.taskId);assert.equal(attempt.run.fixture,'INJECTED_T3_NOT_LIVE');}
  assert.equal(result.data.usage.tokens,21);assert.equal(result.data.usage.cost,0.03);assert.equal(result.data.usage.currency,'USD');assert.ok(result.data.usage.controller.receiptIds.length);assert.equal(result.data.usage.controller.cost,null);
  assert.deepEqual(result.data.usage.controller.receiptIds,x.f.store.read().events.filter(e=>e.type==='research.controller-overhead').map(e=>e.id));
  const consumption=x.f.store.read().events.filter(e=>e.type==='research.component-consumption');assert.equal(consumption.length,3);assert.equal(consumption[2].helperArtifacts.length,1);assert.equal(consumption[0].skills[0].version,'1.0');
  assert.ok(result.data.attempts[2].evidence.checks.some(c=>c.validator==='component-output-schema/1'));
});

test('OFF ablations suppress actual skill instructions, helper dispatch and revision; final independent validator still runs',async t=>{
  const x=await fixture(t,{components:{skills:false,staffing:false,adaptation:false,verification:false},maxAgents:1,wrongPrimary:true});
  const result=await runResearchComposition({service:x.service,caller:x.owner,projectId:x.f.p.id,trialId:x.trial.id,slots:x.slots});
  assert.equal(result.data.status,'FAILED');assert.equal(x.f.starts,1);assert.equal(result.data.attempts[0].evidence.independent,true);assert.doesNotMatch(x.messages[0].message,/REVIEWED_TABLE_SKILL/);assert.deepEqual(result.data.attempts[0].allocation.skills,[]);assert.equal(result.data.attempts[0].evidence.checks.find(c=>c.kind==='deterministic').passed,false);
  assert.ok(!result.data.attempts[0].evidence.checks.some(c=>c.validator==='component-output-schema/1'));
});

test('static and initial-route execute pinned actual route without adaptive revisions',async t=>{
  for(const policy of ['static','initial-route'])await t.test(policy,async t=>{
    const x=await fixture(t,{policy,components:{adaptation:false,staffing:false},maxAgents:1});await x.prepare();await x.advance();await x.validateAll();const final=await x.advance();assert.equal(final.status,'PASSED');assert.equal(x.f.starts,1);
    const d=x.f.store.read().events.find(e=>e.type==='research.component-decision');assert.equal(d.action,policy==='static'?'fixed-reviewed-route':'initial-capability-qualified-route');
  });
});

test('rule adaptation consumes exact independent failure and allocates a real new canonical revision attempt',async t=>{
  const x=await fixture(t,{policy:'rule-adapt',components:{staffing:false},maxAgents:2,wrongPrimary:true});await x.prepare();await x.advance();await x.validateAll();const state=await x.advance();assert.equal(x.f.starts,2);assert.deepEqual(state.attempts.map(x=>x.allocation.role),['primary','revision']);assert.match(x.messages[1].message,/rule:independent-answer-check-failed/);assert.equal(state.attempts[0].evidence.runId,state.attempts[0].run.id);
});

test('independent success suppresses unnecessary revisions; staffing still creates actual helper run',async t=>{
  const x=await fixture(t);await x.prepare();await x.advance();await x.validateAll();await x.advance();await x.validateAll();const final=await x.advance();assert.equal(final.status,'PASSED');assert.equal(x.f.starts,2);assert.deepEqual(final.attempts.map(x=>x.allocation.role),['primary','helper']);
});

test('unknown canonical usage and unknown finality block all cohort continuation instead of counting zero',async t=>{
  const x=await fixture(t,{report:false});const c=await x.prepare();await x.advance();await x.validateAll();await assert.rejects(x.advance(),code('RESEARCH_ACCOUNTING_UNKNOWN'));assert.equal(x.f.starts,1);
  let state=await x.state();assert.equal(state.usage.tokens,null);assert.equal(state.usage.cost,null);const run=state.attempts[0].run;await x.usage(run,{final:false});await assert.rejects(x.advance(),code('RESEARCH_ACCOUNTING_UNKNOWN'));await x.usage(run,{sequence:2,final:true});await x.advance();assert.equal(x.f.starts,2);assert.equal(componentUsage(x.f.store.read(),c).unknown,true); // helper intentionally unreported
});

test('global observed budget and currency separation block extra staffing',async t=>{
  const x=await fixture(t,{maxTokens:21,maxCost:0.3});await x.prepare();await x.advance();await x.validateAll();let run=(await x.state()).attempts[0].run;await x.usage(run,{tokens:21,sequence:2});await assert.rejects(x.advance(),code('RESEARCH_BUDGET'));assert.equal(x.f.starts,1);
});

test('missing/changed catalogs, capability, skill, human plan and mixed controllers are rejected before effects',async t=>{
  const x=await fixture(t);const c=await x.prepare(),snapshot=x.f.store.read();
  const mutations=[s=>s.connections[0].providerCatalog.canRunChildTask=false,s=>s.connections[0].providerCatalog.models[0].options[0].values=[],s=>s.connections[0].lastCheck.authentication='unknown',s=>s.skills[0].instructions+='CHANGED',s=>s.plans[0].approved=false,s=>s.events.push({id:crypto.randomUUID(),type:'assistance.loop',projectId:x.f.p.id,status:'running'})];
  for(const mutate of mutations){await x.f.store.transaction(s=>{for(const key of Object.keys(snapshot))s[key]=structuredClone(snapshot[key]);mutate(s);});await assert.rejects(x.advance());assert.equal(x.f.starts,0);}
  await x.f.store.transaction(s=>{for(const key of Object.keys(snapshot))s[key]=structuredClone(snapshot[key]);});assert.equal((await x.state()).composition.id,c.id);
});

test('host admission rejects stripped context, foreign run/attempt, tampered allocation and unclaimed cohort workspace',async t=>{
  const x=await fixture(t);await x.prepare();await x.advance();const state=await x.state(),{allocation:a,run:r}=state.attempts[0];
  assert.throws(()=>validateResearchComponentContext(x.f.store.read(),{...r,researchComponentContext:undefined}),code('RESEARCH_COMPONENT_CONTEXT'));
  assert.throws(()=>x.resolve(a,{runId:crypto.randomUUID()}),code('RESEARCH_COMPONENT_SCOPE'));
  assert.throws(()=>x.resolve(a,{attemptId:crypto.randomUUID()}),code('RESEARCH_COMPONENT_SCOPE'));
  assert.throws(()=>x.resolve({...a,workspaceId:x.slots[1].workspaceId}),code('RESEARCH_COMPONENT_SCOPE'));
  await x.f.store.transaction(s=>{s.events.find(e=>e.id===a.id).skills=[];});assert.throws(()=>x.resolve(a),code('RESEARCH_COMPONENT_INTEGRITY'));
});

test('changed independently checked helper bytes cannot enter a revision prompt',async t=>{
  const x=await fixture(t,{wrongPrimary:true});await x.prepare();await x.advance();await x.validateAll();await x.advance();await x.validateAll();const helper=(await x.state()).attempts[1];await writeFile(path.join(helper.run.actualWorkspace,'output.json'),'[{"key":"malicious","total":1}]');
  const result=await x.advance();assert.equal(result.status,'running');assert.equal(result.attempts.length,3);assert.equal(x.messages.length,2);assert.equal(result.attempts[2].run.status,'running');assert.equal(x.f.store.read().events.filter(e=>e.type==='research.component-consumption').length,2);
});

test('lost accepted response and replay/reopen never dispatch another owner run',async t=>{
  const x=await fixture(t,{complete:false});await x.prepare();x.control.loseAfter=true;const input=x.input();const first=await x.service.advance(input,x.owner);assert.equal(x.f.starts,1);await x.service.advance(input,x.owner);assert.equal(x.f.starts,1);await x.restart();await x.service.advance(input,x.owner);await x.service.reconcile(x.input(),x.owner);assert.equal(x.f.starts,1);const after=await x.advance();assert.equal(after.status,'reconcile-required');assert.equal(x.f.starts,1);assert.equal(first.attempts.length,1);
});

test('unknown before reservation is a retained allocation across SQLite reopen and never redispatched',async t=>{
  const x=await fixture(t);await x.prepare();x.control.loseBefore=true;await x.advance();assert.equal(x.f.starts,0);await x.restart();x.control.loseBefore=false;const after=await x.advance();assert.equal(after.status,'reconcile-required');assert.equal(x.f.starts,0);assert.equal(after.usage.tokens,null);
});

test('Stop persists before effect, prevents further allocation and sends exact once-only workspace Stop across restart',async t=>{
  const x=await fixture(t,{complete:false});await x.prepare();await x.advance();x.f.control.stopUnknown=true;const stop=x.input();const first=await x.service.stop(stop,x.owner);assert.equal(first.status,'stopping');assert.equal(x.f.stops,1);await x.restart();await x.service.stop(stop,x.owner);await x.service.stop(x.input(),x.owner);assert.equal(x.f.stops,1);await assert.rejects(x.advance(),code('RESEARCH_COMPONENT_STOP'));
});

test('owner auth, bounded envelopes and operation identities are enforced',async t=>{
  const x=await fixture(t,{maxAgents:2});await assert.rejects(x.service.prepare(x.input({slots:x.slots}),{}),code('OWNER_REQUIRED'));await assert.rejects(x.prepare(),code('RESEARCH_COMPONENT_BUDGET'));assert.equal(x.f.starts,0);
});

test('explicit allow with null token/cost caps preserves unknowns while consuming fixed cohort capacity',async t=>{
  const x=await fixture(t,{unknownAccounting:'allow',report:false,wrongPrimary:true});
  const result=await runResearchComposition({service:x.service,caller:x.owner,projectId:x.f.p.id,trialId:x.trial.id,slots:x.slots});
  assert.equal(result.data.status,'PASSED');assert.equal(x.f.starts,3);assert.equal(result.data.usage.tokens,null);assert.equal(result.data.usage.cost,null);assert.equal(result.data.usage.unknown,true);assert.equal(result.data.usage.details.length,3);assert.ok(result.data.usage.details.every(d=>d.final===null));
  const again=await x.advance();assert.equal(again.status,'PASSED');assert.equal(x.f.starts,3);assert.equal(again.attempts.length,3);
});

test('allow with a non-null hard cap still refuses continuation with unknown spend/finality',async t=>{
  const x=await fixture(t,{unknownAccounting:'allow',report:false,maxTokens:300});await x.prepare();await x.advance();await x.validateAll();await assert.rejects(x.advance(),code('RESEARCH_ACCOUNTING_UNKNOWN'));assert.equal(x.f.starts,1);
});

test('different currencies and modified canonical Budget receipts cannot authorize another allocation',async t=>{
  const x=await fixture(t,{wrongPrimary:true});const c=await x.prepare();await x.advance();await x.validateAll();x.control.report=false;await x.advance();await x.validateAll();
  const state=await x.state(),helper=state.attempts[1].run;await x.usage(helper,{currency:'THB'});await assert.rejects(x.advance(),code('RESEARCH_COMPONENT_CURRENCY'));assert.equal(x.f.starts,2);
  const mixed=componentUsage(x.f.store.read(),c);assert.equal(mixed.cost,null);assert.equal(mixed.knownCost,null);assert.deepEqual(mixed.knownCostByCurrency,{USD:0.01,THB:0.01});
  await x.f.store.transaction(s=>{s.events.find(e=>e.type==='budget.observation').usage.totalTokens=0;});assert.throws(()=>componentUsage(x.f.store.read(),c),code('RESEARCH_COMPONENT_USAGE'));
});

test('concurrent commands allocate at most once and same operation cannot be rebound',async t=>{
  const x=await fixture(t,{complete:false});const input=x.input({slots:x.slots});await x.service.prepare(input,x.owner);await assert.rejects(x.service.prepare({...input,slots:x.slots.slice(0,1)},x.owner),code('OPERATION_REUSE'));
  const results=await Promise.allSettled([x.advance(),x.advance()]);assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal(x.f.starts,1);assert.equal((await x.state()).attempts.length,1);
});

test('Stop arriving during awaited prompt setup invalidates final admission and suppresses model prompt consumption',async t=>{
  const x=await fixture(t,{complete:false});await x.prepare();let reached,release;const atPrompt=new Promise(r=>reached=r),gate=new Promise(r=>release=r);x.control.beforePrompt=async()=>{reached();await gate;};
  const start=x.advance();await atPrompt;const stop=await x.service.stop(x.input(),x.owner);release();await start;assert.equal(stop.status,'stopped');assert.equal(x.f.stops,1);assert.equal(x.messages.length,0);assert.equal(x.f.store.read().events.filter(e=>e.type==='research.component-consumption').length,0);
});

test('absolute deadline survives restart and reconciles retained allocation through exact Stop',async t=>{
  const x=await fixture(t,{complete:false});await x.prepare();await x.advance();await x.f.store.transaction(s=>{s.events.find(e=>e.id===x.trial.id).deadlineAt=Date.now()-1;});await x.restart();await x.service.reconcile(x.input(),x.owner);await assert.rejects(x.advance(),code('RESEARCH_COMPONENT_STOP'));assert.equal(x.f.starts,1);assert.equal(x.f.stops,1);
});

test('terminal self-report cannot replace independent artifact evidence for adaptation',async t=>{
  const x=await fixture(t,{wrongPrimary:true});await x.prepare();await x.advance();const {allocation:a,run:r}=(await x.state()).attempts[0];
  await x.f.store.transaction(s=>{const e={id:crypto.randomUUID(),type:'research.evidence',projectId:x.f.p.id,trialId:x.trial.id,allocationId:a.id,compositionId:a.compositionId,manifestDigest:x.trial.manifestDigest,runId:r.id,attemptId:r.attemptId,workspaceId:a.workspaceId,status:'FAILED',independent:false,checks:[{kind:'deterministic',passed:false}]};e.digest=digest(e);s.events.push(e);});
  await assert.rejects(x.advance(),code('RESEARCH_COMPONENT_EVIDENCE'));assert.equal(x.f.starts,1);
});

test('completed cohort remains completed after SQLite reopen past its absolute deadline without Stop or redispatch',async t=>{
  const x=await fixture(t,{components:{staffing:false,adaptation:false},maxAgents:1});
  const result=await runResearchComposition({service:x.service,caller:x.owner,projectId:x.f.p.id,trialId:x.trial.id,slots:x.slots});assert.equal(result.data.status,'PASSED');
  await x.f.store.transaction(s=>{s.events.find(e=>e.id===x.trial.id).deadlineAt=Date.now()-1;});await x.restart();const reconciled=await x.service.reconcile(x.input(),x.owner);assert.equal(reconciled.status,'PASSED');assert.equal(x.f.stops,0);assert.equal(x.f.starts,1);assert.equal(x.f.store.read().events.find(e=>e.id===x.trial.id).stopRequested,false);
  const a=reconciled.attempts[0];await writeFile(path.join(a.run.actualWorkspace,'output.json'),'[]');await x.service.validate(x.input({allocationId:a.allocation.id}),x.owner);const rechecked=await x.state();assert.equal(rechecked.status,'ready');assert.equal(rechecked.effectiveEvidence.status,'FAILED');assert.equal(x.f.starts,1);
});
