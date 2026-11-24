import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './adaptive-fixture.test.mjs';
import {validateAdaptiveContext,adaptivePrompt} from '../app/server/adaptive-context.mjs';
import {command} from '../app/server/domain.mjs';

test('T3 context boundary validates reserved selection and instructions before dispatch',async t=>{
  const f=await fixture(t),original=f.t3.startRun;
  f.t3.startRun=async input=>{const context=validateAdaptiveContext(f.store.read(),input);assert.match(adaptivePrompt(context),/Inspect actual output/);return original(input);};
  let loop=await f.loop();loop=await f.step(loop);loop=await f.step(loop);
  const run=f.store.read().runs[0],input={projectId:f.p.id,taskId:f.task.id,operationId:run.operationId,adaptiveContext:run.adaptiveContext};
  assert.deepEqual(validateAdaptiveContext(f.store.read(),input),run.adaptiveContext);
  const forged=structuredClone(input);forged.adaptiveContext.skillSnapshots[0].instructions='Unreviewed replacement';assert.throws(()=>validateAdaptiveContext(f.store.read(),forged),e=>e.code==='ADAPTIVE_CONTEXT');
  assert.throws(()=>validateAdaptiveContext(f.store.read(),{...input,projectId:f.other.id}),e=>e.code==='NOT_FOUND');
  await f.store.transaction(s=>s.skills[0].revision++);assert.throws(()=>validateAdaptiveContext(f.store.read(),input),e=>e.code==='STALE_DECISION');
});
test('ordinary skill command cannot bypass managed candidate review',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.skills[0].provenance={kind:'adaptive.candidate'};});
  await assert.rejects(command(f.store,{operationId:crypto.randomUUID(),type:'skill.update',projectId:f.p.id,id:f.skill.id,expectedRevision:1,data:{instructions:'bypass',status:'active'}}),e=>e.code==='ADAPTIVE_REVIEW_REQUIRED');
});
