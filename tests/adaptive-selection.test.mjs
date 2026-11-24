import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './adaptive-fixture.test.mjs';
import { entity, changed } from '../app/server/domain.mjs';

test('selection preserves configured route, exact skills and reviewable evidence after restart',async t => {
  const f=await fixture(t),input=f.input({taskId:f.task.id,constraints:{skillIds:[f.skill.id],requiredCapabilities:['t3.run']}});
  const d=await f.service.select(input);assert.equal(d.status,'selected');assert.equal(d.harness.model,'fixture-model');assert.equal(d.skills[0].version,'1.0');assert.equal(d.skills[0].sha256.length,64);
  assert.equal(d.qualifications.liveProvider,'NOT_RUN');assert.match(d.method,/not learned/);
  await f.restart();assert.deepEqual(await f.service.select(input),d);assert.equal(f.service.status({projectId:f.p.id}).decisions.length,1);
  await assert.rejects(f.service.select({...input,taskId:'different'}),{code:'OPERATION_REUSE'});assert.equal(f.turns,0);
});

test('missing configured model, unsupported option, explicit route mismatch fail without fallback',async t => {
  const f=await fixture(t);
  const mismatch=await f.selected({constraints:{model:'other-model'}});assert.equal(mismatch.status,'needs_setup');assert.equal(mismatch.harness,null);
  await f.store.transaction(s=>{s.projects[0].profile.provider.options=[{id:'effort',value:'imaginary'}];});
  assert.equal((await f.selected()).status,'needs_setup');
  f.t3.catalog=async()=>({providers:[]});const d=await f.selected();assert.equal(d.status,'needs_setup');assert.ok(d.rejections.some(x=>x.kind==='harness'));
});

test('capabilities use enabled, scoped, fresh observations; unavailable skill is recorded',async t => {
  const f=await fixture(t);
  const conn=entity({kind:'mcp',enabled:true,lastCheck:{status:'ready',checkedAt:new Date().toISOString(),capabilities:[{name:'inspect'}]}},f.p.id);
  const cap=`mcp:${conn.id}:inspect`;
  await f.store.transaction(s=>{s.connections.push(conn);s.skills[0].requires=[cap];s.connections.push(entity({kind:'mcp',enabled:true,lastCheck:{status:'ready',checkedAt:new Date().toISOString(),capabilities:[{name:'foreign'}]}},f.other.id));});
  const ready=await f.selected({constraints:{skillIds:[f.skill.id],requiredCapabilities:[cap]}});assert.equal(ready.status,'selected');assert.ok(ready.availableCapabilities.includes(cap));assert.ok(!ready.availableCapabilities.some(x=>x.endsWith(':foreign')));
  await f.store.transaction(s=>{s.connections[0].enabled=false;changed(s.connections[0]);});
  const blocked=await f.selected({constraints:{skillIds:[f.skill.id]}});assert.equal(blocked.status,'needs_setup');assert.deepEqual(blocked.rejections.find(x=>x.kind==='skill').missing,[cap]);
  await f.store.transaction(s=>{s.connections[0].enabled=true;s.connections[0].lastCheck.checkedAt='2000-01-01T00:00:00Z';});
  assert.equal((await f.selected({constraints:{requiredCapabilities:[cap]}})).status,'needs_setup');
});

test('cross-project skill and capability claims never qualify selection',async t => {
  const f=await fixture(t);const otherSkill=entity({...f.skill,id:undefined,name:'Foreign skill'},f.other.id);
  await f.store.transaction(s=>s.skills.push(otherSkill));
  const d=await f.selected({constraints:{skillIds:[otherSkill.id]}});assert.equal(d.status,'needs_setup');assert.equal(d.skills.length,1);assert.equal(d.skills[0].id,f.skill.id);
  assert.equal((await f.selected({constraints:{requiredCapabilities:['native.windows.click']}})).status,'needs_setup');
});
