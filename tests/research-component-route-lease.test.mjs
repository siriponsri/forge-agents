import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './research-components-fixture.test.mjs';
import {routePin,validateCohortRoute} from '../app/research-components/routes.mjs';
import {validateResearchComponentContext} from '../app/research-components/contracts.mjs';

test('an admitted cohort retains only its unchanged fresh approval inside the absolute trial envelope',async t=>{
  const h=await fixture(t,{complete:false,report:false,maxMs:900000});await h.prepare();await h.advance();
  const s=h.f.store.read(),r=s.runs.at(-1),c=s.events.find(e=>e.type==='research.composition'),trial=s.events.find(e=>e.id===h.trial.id),clock=()=>trial.startedAt+300001;
  assert.throws(()=>routePin(s,h.f.p.id,clock),{code:'RESEARCH_COMPONENT_ROUTE'},'the old observation does not qualify ordinary new work');
  assert.deepEqual(validateCohortRoute(s,c,clock),c.routePin);
  assert.deepEqual(validateResearchComponentContext(s,r,clock),r.researchComponentContext);
  for(const mutate of [x=>{x.connections[0].config.generation++;},x=>{x.connections[0].lastCheck.authentication='unauthenticated';},x=>{x.connections[0].providerCatalog.models[0].id='foreign';}]){
    const changed=structuredClone(s);mutate(changed);assert.throws(()=>validateCohortRoute(changed,c,clock),{code:'RESEARCH_COMPONENT_ROUTE'});
  }
  assert.throws(()=>validateResearchComponentContext(s,r,()=>trial.deadlineAt),{code:'RESEARCH_COMPONENT_STOP'});
});

test('an unclaimed cohort cannot adopt an expired catalog observation',async t=>{
  const h=await fixture(t,{complete:false,report:false,maxMs:900000});await h.prepare();
  const s=h.f.store.read(),c=s.events.find(e=>e.type==='research.composition');
  assert.throws(()=>validateCohortRoute(s,c,()=>Date.parse(c.createdAt)+300001),{code:'RESEARCH_COMPONENT_ROUTE'});
});
