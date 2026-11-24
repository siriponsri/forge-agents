import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, open } from 'node:fs/promises';
import { fixture } from './adaptive-fixture.test.mjs';
import { entity, changed } from '../app/server/domain.mjs';

async function improvement(f) {
  const baseline=await f.evidenceRun();
  const candidate=await f.service.candidate(f.input({skillId:f.skill.id,expectedRevision:1,version:'1.1',instructions:'Inspect output bytes and retain verifier receipts.',lesson:'Preserve actual hashes before reporting success.',evidenceRefs:[{kind:'run',id:baseline.run.id},{kind:'artifact',id:baseline.artifact.id}]}));
  const measured=await f.evidenceRun(candidate);
  const evaluation=await f.service.evaluate(f.input({candidateId:candidate.id,expectedRevision:1,baselineChecks:baseline.checks,checks:measured.checks}));
  return {baseline,candidate,measured,evaluation};
}
test('versioned candidate evaluates actual bytes, requires promotion and retains reversible history',async t => {
  const f=await fixture(t),x=await improvement(f);assert.equal(x.evaluation.status,'PASSED');assert.equal(f.store.read().skills[0].status,'active');assert.equal(f.store.read().skills[1].status,'candidate');
  const decision=await f.selected({constraints:{candidateId:x.candidate.id,maxSkills:1}});assert.equal(decision.skills[0].id,x.candidate.id);
  const promotion=await f.service.promote(f.input({candidateId:x.candidate.id,expectedRevision:1,evaluationId:x.evaluation.id,reason:'Reviewed exact evidence'}));
  assert.equal(f.store.read().skills[0].status,'retired');assert.equal(f.store.read().skills[1].status,'active');
  await f.restart();const input=f.input({promotionId:promotion.id,expectedRevision:2,reason:'Owner restores previous instructions'});
  const rollback=await f.service.rollback(input);assert.equal(rollback.action,'rollback');assert.deepEqual(await f.service.rollback(input),rollback);
  assert.equal(f.store.read().skills[0].status,'active');assert.equal(f.store.read().skills[1].status,'retired');assert.equal(f.service.status({projectId:f.p.id}).history.length,2);
  assert.equal(f.service.status({projectId:f.p.id}).evaluations[0].result.outcomes[0].evidence[1].sha256,x.measured.artifact.sha256);
});

test('stale revisions and missing, foreign or unrelated evidence cannot create/qualify candidates',async t => {
  const f=await fixture(t),x=await improvement(f);
  await assert.rejects(f.service.candidate(f.input({skillId:f.skill.id,expectedRevision:0})),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.service.candidate(f.input({skillId:f.skill.id,expectedRevision:1,version:'1.2',instructions:'New instructions',lesson:'Lesson',evidenceRefs:[]})),{code:'EVIDENCE_REQUIRED'});
  const foreign=entity({status:'completed'},f.other.id);await f.store.transaction(s=>s.runs.push(foreign));
  const checks=x.measured.checks.map(c=>({...c,runId:foreign.id}));
  const evaluated=await f.service.evaluate(f.input({candidateId:x.candidate.id,expectedRevision:1,baselineChecks:x.baseline.checks,checks}));
  assert.equal(evaluated.status,'FAILED');assert.ok(evaluated.result.outcomes.every(o=>o.reason==='NOT_FOUND'));
  const unrelated=await f.evidenceRun(f.skill);
  const wrong=await f.service.evaluate(f.input({candidateId:x.candidate.id,expectedRevision:1,baselineChecks:x.baseline.checks,checks:unrelated.checks}));assert.equal(wrong.result.outcomes[0].reason,'EVIDENCE_SCOPE');
  await rm(x.measured.artifact.path);
  const missing=await f.service.evaluate(f.input({candidateId:x.candidate.id,expectedRevision:1,baselineChecks:x.baseline.checks,checks:x.measured.checks}));assert.equal(missing.status,'FAILED');
});

test('promotion rejects later regression, modified candidate/base, stale evaluation and replay misuse',async t => {
  const f=await fixture(t),x=await improvement(f);
  await writeFile(x.measured.artifact.path,'tampered');
  const input=f.input({candidateId:x.candidate.id,expectedRevision:1,evaluationId:x.evaluation.id,reason:'Review'});
  await assert.rejects(f.service.promote(input),{code:'EVIDENCE_REGRESSION'});
  await f.store.transaction(s=>{s.skills[1].instructions='Changed after evaluation';changed(s.skills[1]);});
  await assert.rejects(f.service.promote({...input,operationId:crypto.randomUUID(),expectedRevision:1}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.service.promote({...input,operationId:crypto.randomUUID(),expectedRevision:2}),{code:'EVALUATION_REQUIRED'});
});

test('evaluator rejects arbitrary submitted code, process-only evidence and weakened regression suites',async t => {
  const f=await fixture(t),x=await improvement(f),common={candidateId:x.candidate.id,expectedRevision:1,baselineChecks:x.baseline.checks};
  await assert.rejects(f.service.evaluate(f.input({...common,checks:[{key:'code',kind:'javascript',runId:x.measured.run.id,code:'globalThis.executed=true'}]})),{code:'UNSUPPORTED_CHECK'});
  await assert.rejects(f.service.evaluate(f.input({...common,checks:x.measured.checks.map(c=>({...c,shell:'arbitrary'}))})),{code:'UNSUPPORTED_CHECK'});
  await assert.rejects(f.service.evaluate(f.input({...common,checks:[x.measured.checks[1]],baselineChecks:[x.baseline.checks[1]]})),{code:'REGRESSION_CONTRACT'});
  await assert.rejects(f.service.evaluate(f.input({...common,checks:[]})),{code:'EVIDENCE_REQUIRED'});
  const run=f.store.read().runs.find(r=>r.id===x.measured.run.id);await f.store.transaction(s=>{s.runs.find(r=>r.id===run.id).status='running';});
  const e=await f.service.evaluate(f.input({...common,checks:x.measured.checks}));assert.equal(e.status,'FAILED');assert.equal(e.result.outcomes[0].reason,'RUN_NOT_COMPLETED');
});

test('actual verifier receipts must match run/project and retain versioned provenance',async t => {
  const f=await fixture(t),x=await improvement(f);
  const base=entity({type:'verification.result',runId:x.baseline.run.id,status:'PASSED',verifier:{id:'fixture-output-check',version:'1'},checkedAt:new Date().toISOString(),checks:[{status:'PASSED'}],scope:'fixture'},f.p.id);
  const measured=entity({...base,runId:x.measured.run.id},f.p.id);await f.store.transaction(s=>s.events.push(base,measured));
  const checks=[{key:'verifier',kind:'verifierReceipt',runId:x.measured.run.id,receiptId:measured.id}],baselineChecks=[{key:'verifier',kind:'verifierReceipt',runId:x.baseline.run.id,receiptId:base.id}];
  const e=await f.service.evaluate(f.input({candidateId:x.candidate.id,expectedRevision:1,checks,baselineChecks}));assert.equal(e.status,'PASSED');assert.equal(e.result.qualifications.liveProvider,'NOT_RUN');
  await f.store.transaction(s=>{s.events.find(e=>e.id===measured.id).checks[0].status='FAILED';});
  const regression=await f.service.evaluate(f.input({candidateId:x.candidate.id,expectedRevision:1,checks,baselineChecks}));assert.equal(regression.status,'FAILED');
});

test('bounded checks reject oversized bytes, unrelated artifact links and excess checks',async t => {
  const f=await fixture(t),x=await improvement(f),common={candidateId:x.candidate.id,expectedRevision:1,baselineChecks:x.baseline.checks};
  const file=await open(x.measured.artifact.path,'r+');await file.truncate(16*1024*1024+1);await file.close();
  const oversized=await f.service.evaluate(f.input({...common,checks:x.measured.checks}));assert.equal(oversized.result.outcomes[0].reason,'EVALUATION_SIZE_LIMIT');
  const unrelated=await f.evidenceRun(x.candidate);
  const checks=x.measured.checks.map(c=>c.kind==='artifactHash'?{...c,artifactId:unrelated.artifact.id,sha256:unrelated.artifact.sha256}:c);
  const wrong=await f.service.evaluate(f.input({...common,checks}));assert.equal(wrong.result.outcomes[0].reason,'EVIDENCE_SCOPE');
  await assert.rejects(f.service.evaluate(f.input({...common,checks:Array.from({length:25},(_,i)=>({...unrelated.checks[0],key:`check-${i}`}))})),{code:'LIMIT'});
});

test('base changes and rollback lineage conflicts preserve prior history without overwriting',async t => {
  const f=await fixture(t),x=await improvement(f);
  await f.store.transaction(s=>{s.skills[0].instructions='New human base edit';changed(s.skills[0]);});
  await assert.rejects(f.service.promote(f.input({candidateId:x.candidate.id,expectedRevision:1,evaluationId:x.evaluation.id,reason:'Review'})),{code:'REVISION_CONFLICT'});
  // A fresh independent fixture proves rollback conflicts after a valid promotion.
  const g=await fixture(t),y=await improvement(g);
  const promotion=await g.service.promote(g.input({candidateId:y.candidate.id,expectedRevision:1,evaluationId:y.evaluation.id,reason:'Reviewed'}));
  await g.store.transaction(s=>{s.skills[0].instructions='Unexpected mutation';changed(s.skills[0]);});
  await assert.rejects(g.service.rollback(g.input({promotionId:promotion.id,expectedRevision:2,reason:'Restore'})),{code:'REVISION_CONFLICT'});
  assert.equal(g.service.status({projectId:g.p.id}).history.length,1);assert.equal(g.store.read().skills[1].status,'active');
});
