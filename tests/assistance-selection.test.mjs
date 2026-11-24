import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,provenance} from './assistance-fixture.test.mjs';

test('all connected catalogs compete under explicit quality/cost policy without changing project route',async t=>{
  const h=await fixture(t);await h.configure();const d=await h.select();
  assert.equal(d.status,'selected');assert.equal(d.candidates.length,3);
  assert.equal(d.selection.executor.model,'fixture-economy');assert.equal(d.selection.asst.instanceId,h.c2.providerInstanceId);
  assert.deepEqual(d.selection.executor.selection.options,[{id:'effort',value:'high'}]);
  assert.deepEqual(d.selection.asst.selection.options,[{id:'thinking',value:true}]);
  assert.equal(d.selection.asst.classification.monetaryCost,null);assert.equal(d.selection.asst.utility,null);
  assert.equal(h.store.read().projects[0].profile.provider.model,'unchanged');assert.equal(h.turns,0);
  const d2=await h.select({constraints:{minExecutorQuality:6}});assert.equal(d2.selection.executor.model,'fixture-premium-executor');
  const costLimited=await h.select({constraints:{maxCostRank:2}});assert.equal(costLimited.status,'ask_owner');
});

test('unclassified new models, unknown cost preferences and impossible role sizes ask owner',async t=>{
  const h=await fixture(t);assert.equal((await h.select()).status,'ask_owner');
  const policy=structuredClone(h.policy);policy.unknownCost='ask-owner';await h.configure(policy);
  assert.ok((await h.select()).issues.some(i=>i.code==='COST_UNKNOWN'));
  policy.unknownCost='allow-ranked-last';policy.classifications[2].sizeRank=1;await h.configure(policy);
  assert.ok((await h.select()).issues.some(i=>i.code==='ROLE_CONFLICT'));
  await h.configure();h.models[1].models.push({id:'fixture-new-model',options:[]});await h.refresh();
  const d=await h.select();assert.equal(d.status,'ask_owner');assert.equal(d.candidates.length,4);assert.ok(d.issues.some(i=>i.code==='UNCLASSIFIED'));
});

test('unadvertised options and missing supervision/capability/auth return actionable setup',async t=>{
  const h=await fixture(t);const p=structuredClone(h.policy);p.classifications[0].options=[{id:'invented',value:'high'}];await h.configure(p);
  assert.equal((await h.select()).status,'needs_setup');
  await h.configure();h.models[1].runtimeModes=[];await h.refresh();assert.ok((await h.select()).issues.some(i=>i.code==='CAPABILITY_REQUIRED'));
  h.models[1].runtimeModes=['approval-required'];await h.refresh();
  await h.store.transaction(s=>{s.connections.find(c=>c.id===h.c1.id).lastCheck.authentication='unknown';});
  assert.ok((await h.select()).issues.some(i=>i.code==='AUTH_REQUIRED'));assert.equal(h.turns,0);
});

test('catalog expiration, failed refresh and account generation invalidate dispatch decisions',async t=>{
  const h=await fixture(t);let l=await h.loop();h.tick(300000);
  await assert.rejects(h.advance(l),{code:'STALE_DECISION'});assert.equal((await h.select()).status,'needs_setup');
  await h.refresh();const d=await h.select();assert.equal(d.status,'selected');
  h.control.catalogError=true;await h.refresh();const failed=await h.select();assert.equal(failed.status,'needs_setup');assert.equal(failed.candidates.length,3);
  h.control.catalogError=false;await h.refresh();
  await h.store.transaction(s=>{s.connections.find(c=>c.id===h.c2.id).config.generation++;});
  assert.equal((await h.select()).status,'needs_setup');assert.equal(h.turns,0);
});

test('policy provenance, duplicate role entries, constraints and operation conflicts are validated',async t=>{
  const h=await fixture(t),bad=structuredClone(h.policy);bad.classifications.push(bad.classifications[0]);
  await assert.rejects(h.configure(bad),{code:'ROLE_CONFLICT'});
  bad.classifications.pop();delete bad.classifications[0].provenance;await assert.rejects(h.configure(bad),{code:'VALIDATION'});
  await h.configure();await assert.rejects(h.select({constraints:{guessQuality:true}}),{code:'VALIDATION'});
  const input=h.input({taskId:h.task.id});const a=await h.service.select(input),b=await h.service.select(input);assert.deepEqual(a,b);
  await assert.rejects(h.service.select({...input,constraints:{minExecutorQuality:5}}),{code:'OPERATION_REUSE'});
  await assert.rejects(h.service.configure(h.input({policy:h.policy})),{code:'REVISION_CONFLICT'});
  assert.ok(provenance.source);
});

test('incomplete catalogs and unqualified task capabilities cannot masquerade as all-model selection',async t=>{
  const h=await fixture(t);await h.configure();h.models[0].omittedModels=1;await h.refresh();
  assert.ok((await h.select()).issues.some(i=>i.code==='CATALOG_INCOMPLETE'));
  h.models[0].omittedModels=0;await h.refresh();
  assert.ok((await h.select({constraints:{requiredCapabilities:['native.desktop']}})).issues.some(i=>i.code==='CAPABILITY_REQUIRED'));
});
