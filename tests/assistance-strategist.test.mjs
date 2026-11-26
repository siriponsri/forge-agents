// Real disposable SQLite, provider validation and Assistance/T3 owners.
// All native catalog/turn/stop effects are INJECTED. No accounts or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,provenance} from './assistance-fixture.test.mjs';
import {assistancePrompt} from '../app/assistance/index.mjs';
import {createT3Service} from '../app/server/t3.mjs';

export function strategistPolicy(h){
  const p=structuredClone(h.policy);
  Object.assign(p.classifications[1],{roles:['strategist'],sizeRank:0,qualityRank:4,costRank:2});
  return p;
}
async function setup(t,pattern='strategist-executor',limits){
  const h=await fixture(t);await h.configure(strategistPolicy(h));
  const d=await h.select({constraints:{rolePattern:pattern}});
  assert.equal(d.status,'selected');
  return {h,d,l:await h.service.createLoop(h.input({taskId:h.task.id,decisionId:d.id,limits}))};
}
const handoff={action:'return',feedback:'Reviewed options, risk boundary and acceptance checks; execute approved scope only.',provenance};

test('explicit patterns select only classified distinct roles, without a Strategist size-superiority rule',async t=>{
  const h=await fixture(t);await h.configure(strategistPolicy(h));
  for(const [rolePattern,roles]of [['executor-only',['executor']],['executor-asst',['executor','asst']],['strategist-executor',['executor','strategist']],['strategist-executor-asst',['executor','asst','strategist']]]){
    const d=await h.select({constraints:{rolePattern}});assert.equal(d.status,'selected');assert.deepEqual(Object.keys(d.selection).sort(),roles.sort());
    assert.equal(new Set(Object.values(d.selection).map(c=>JSON.stringify([c.connectionId,c.model]))).size,roles.length);
    if(d.selection.strategist){assert.equal(d.selection.strategist.classification.sizeRank,0);assert.equal(d.selection.strategist.classification.provenance.source,provenance.source);}
  }
  const legacy=await h.select();assert.equal(legacy.constraints.rolePattern,'executor-asst');assert.equal(legacy.selection.strategist,undefined);
  assert.equal(h.turns,0);assert.equal(h.store.read().projects[0].profile.provider.model,'unchanged');
});

test('missing/conflicting Strategist classification, quality/cost constraints and invalid patterns ask owner',async t=>{
  const h=await fixture(t);await h.configure();assert.equal((await h.select({constraints:{rolePattern:'strategist-executor'}})).status,'ask_owner');
  const p=strategistPolicy(h);p.classifications[1].roles=[];p.classifications[0].roles=['executor','strategist'];await h.configure(p);
  assert.equal((await h.select({constraints:{rolePattern:'strategist-executor'}})).status,'ask_owner');
  await h.configure(strategistPolicy(h));
  for(const constraints of [{minStrategistQuality:5},{maxCostRank:1}])assert.equal((await h.select({constraints:{rolePattern:'strategist-executor',...constraints}})).status,'ask_owner');
  for(const rolePattern of ['orchestrator',['executor-only'],'__proto__'])await assert.rejects(h.select({constraints:{rolePattern}}),{code:'ROLE_CONFLICT'});
  await assert.rejects(h.select({constraints:{minStrategistQuality:101}}),{code:'LIMIT'});
});

test('three-role selection considers the next feasible Asst instead of reusing its route for Strategist',async t=>{
  const h=await fixture(t),p=strategistPolicy(h);
  Object.assign(p.classifications[1],{roles:['asst'],sizeRank:4,qualityRank:4,costRank:3});
  Object.assign(p.classifications[2],{roles:['asst','strategist'],sizeRank:3,qualityRank:9,costRank:0});
  await h.configure(p);const d=await h.select({constraints:{rolePattern:'strategist-executor-asst'}});
  assert.equal(d.status,'selected');assert.equal(d.selection.strategist.model,'fixture-assistant');assert.equal(d.selection.asst.model,'fixture-premium-executor');
});

test('Strategist -> human-reviewed Executor handoff persists exact role/route/options on the same task/bot',async t=>{
  const {h,d,l:initial}=await setup(t);let l=await h.advance(initial);
  assert.equal(l.attempts[0].role,'strategist');assert.equal(l.status,'running');
  assert.deepEqual(l.attempts[0].context.selection,d.selection.strategist.selection);
  assert.match(assistancePrompt(l.attempts[0].context),/options, risks, acceptance checks/);
  assert.match(assistancePrompt(l.attempts[0].context),/does not approve or expand/);
  await assert.rejects(h.transition(l,handoff),{code:'RECONCILE_REQUIRED'});
  l=await h.complete(l);assert.equal(l.status,'awaiting_return');
  await assert.rejects(h.transition(l,{action:'approve',reviewer:'owner',evidence:'Strategy only'}),{code:'REVIEW_REQUIRED'});
  await assert.rejects(h.transition(l,{...handoff,feedback:''}),{code:'VALIDATION'});
  l=await h.transition(l,handoff);assert.equal(l.escalations,0);assert.equal(l.pendingRole,'executor');
  assert.equal(l.reason.runId,l.attempts[0].runId);assert.deepEqual(l.reason.provenance,provenance);
  l=await h.advance(l);l=await h.complete(l);
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'stuck',reason:'Needs help',provenance}),{code:'ROLE_CONFLICT'});
  l=await h.transition(l,{action:'approve',reviewer:'fixture owner',evidence:'Verified scoped output'});assert.equal(l.status,'completed');
  for(const r of h.store.read().runs){assert.equal(r.taskId,h.task.id);assert.equal(r.botId,h.bot.id);assert.equal(r.assistanceContext.runtimeMode,'approval-required');assert.equal(r.selection.instanceId,r.providerInstanceId);}
  assert.equal(h.store.read().tasks[0].status,'ready');
});

test('optional Asst retains explicit stuck trigger and escalation limit after Strategist',async t=>{
  const {h,l:initial}=await setup(t,'strategist-executor-asst');let l=await h.advance(initial);l=await h.complete(l);l=await h.transition(l,handoff);l=await h.advance(l);l=await h.complete(l);
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'routine'}),{code:'TRIGGER_REQUIRED'});
  l=await h.transition(l,{action:'escalate',trigger:'stuck',reason:'Observed failed acceptance check',provenance});l=await h.advance(l);l=await h.complete(l);l=await h.transition(l,handoff);l=await h.advance(l);l=await h.complete(l);
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'stuck',reason:'again',provenance}),{code:'ESCALATION_LIMIT'});
  assert.deepEqual(l.attempts.map(a=>a.role),['strategist','executor','asst','executor']);
});

test('failed Strategist cannot hand off, approve, escalate or retry automatically',async t=>{
  const {h,l:initial}=await setup(t);let l=await h.advance(initial);l=await h.complete(l,'failed');assert.equal(l.status,'awaiting_owner');
  await assert.rejects(h.transition(l,handoff),{code:'ROLE_CONFLICT'});
  await assert.rejects(h.transition(l,{action:'escalate',trigger:'stuck',reason:'failure',provenance}),{code:'ROLE_CONFLICT'});
  await assert.rejects(h.advance(l),{code:'RECONCILE_REQUIRED'});assert.equal(h.turns,1);
});

test('accepted lost Strategist response and SQLite restart do not replay native effects or role transitions',async t=>{
  const {h,l:initial}=await setup(t);h.control.loseAfter=true;
  const input=h.input({loopId:initial.id,expectedRevision:initial.revision});let l=await h.service.advance(input);assert.equal(l.status,'unknown');
  await h.restart();await h.service.advance(input);assert.equal(h.turns,1);l=await h.reconcile(l);l=await h.complete(l);
  const change=h.input({loopId:l.id,expectedRevision:l.revision,...handoff});l=await h.service.transition(change);const revision=l.revision;
  await h.restart();l=await h.service.transition(change);assert.equal(l.revision,revision);assert.equal(l.pendingRole,'executor');assert.equal(h.turns,1);
  h.control.loseAfter=false;l=await h.advance(l);assert.equal(h.turns,2);
});

test('Strategist Stop and unknown Stop remain once-only across restart with no handoff',async t=>{
  const {h,l:initial}=await setup(t);let l=await h.advance(initial);h.control.stopUnknown=true;l=await h.service.stop(h.input({loopId:l.id}));assert.equal(l.status,'stopping');
  await h.restart();l=await h.reconcile(l);assert.equal(l.status,'stopping');assert.equal(h.stops,1);assert.equal(h.turns,1);
  await h.store.transaction(s=>{s.runs[0].status='interrupted';});l=await h.reconcile(l);assert.equal(l.status,'stopped');
  await assert.rejects(h.transition(l,handoff),{code:'LOOP_STOPPED'});
});

test('Strategist consumes the same attempts, steps, deadline and reported-cost budget as Executor',async t=>{
  for(const limits of [{maxAttempts:1},{maxSteps:1},{reportedCost:{mode:'require-reported',maxAmount:1,currency:'USD'}}]){
    const {h,l:initial}=await setup(t,'strategist-executor',limits);let l=await h.advance(initial);l=await h.complete(l);l=await h.transition(l,handoff);
    if(limits.maxSteps){assert.equal(l.status,'exhausted');continue;}
    if(limits.reportedCost){await assert.rejects(h.advance(l),{code:'COST_UNKNOWN'});await h.store.transaction(s=>{s.runs[0].reportedCost={amount:1,currency:'USD',source:'INJECTED_REPORT'};});}
    l=await h.advance(l);assert.equal(l.status,'exhausted');assert.equal(h.turns,1);
  }
});

test('catalog/account/plan/task changes cannot authorize a saved Strategist handoff',async t=>{
  for(const kind of ['catalog','account','plan','task','policy']){
    const {h,l:initial}=await setup(t);let l=await h.advance(initial);l=await h.complete(l);
    await h.store.transaction(s=>{if(kind==='catalog')s.connections[0].providerCatalog.models.pop();if(kind==='account')s.connections[0].config.generation++;if(kind==='plan')s.plans[0].description='Changed scope';if(kind==='task')s.tasks[0].description='Changed work';});
    if(kind==='policy')await h.configure(strategistPolicy(h));
    await assert.rejects(h.transition(l,handoff),{code:'STALE_DECISION'});assert.equal(h.turns,1);
  }
});

test('legacy persisted decisions without rolePattern continue Executor/Asst, never add Strategist',async t=>{
  const h=await fixture(t);await h.configure();const d=await h.select();
  await h.store.transaction(s=>{const saved=s.events.find(e=>e.id===d.id);delete saved.constraints.rolePattern;delete saved.constraints.minStrategistQuality;});
  const l=await h.service.createLoop(h.input({taskId:h.task.id,decisionId:d.id}));assert.equal(l.pendingRole,'executor');assert.equal((await h.advance(l)).attempts[0].role,'executor');
});

test('canonical T3 owner persists Strategist selection and sends the exact supervised model without a second runtime',async t=>{
  const {h,d,l:initial}=await setup(t);const projects=[],calls=[];
  const owner=createT3Service({store:h.store,dataDir:h.dir,validateProviderSelection:i=>h.providers.validateSelection(i),nativeTransport:{
    cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},
    call:async(name,args)=>{if(name==='t3_project_list')return {projects};calls.push({name,args});return {threadId:crypto.randomUUID(),runId:crypto.randomUUID(),status:'running'};},
    openFeed:async()=>{throw Error('INJECTED absent native feed; preserve unknown');},
  }});
  const original=h.t3.startRun;h.t3.startRun=i=>owner.startRun(i);
  try{
    const l=await h.advance(initial),r=h.store.read().runs[0];assert.equal(l.status,'unknown');assert.equal(calls.length,1);
    assert.equal(r.assistanceContext.role,'strategist');assert.deepEqual(r.selection,d.selection.strategist.selection);
    const sent=calls[0].args;assert.equal(sent.runtimeMode,'approval-required');assert.equal(sent.modelSelection.model,d.selection.strategist.model);assert.match(sent.message,/role strategist/);assert.match(sent.message,/Strategy does not approve or expand/);
    await assert.rejects(h.advance(l),{code:'RECONCILE_REQUIRED'});assert.equal(calls.length,1);
  }finally{h.t3.startRun=original;await owner.shutdown();}
});

test('canonical Strategist final admission rejects Stop, revoked approval and changed catalog during setup',async t=>{
  for(const mutation of ['stop','plan','catalog']){
    const {h,l:initial}=await setup(t);let turns=0;const projects=[];
    const owner=createT3Service({store:h.store,dataDir:h.dir,prepareContext:async({baseMessage})=>{
      await h.store.transaction(s=>{if(mutation==='stop')s.events.find(e=>e.id===initial.id).stopRequested=true;if(mutation==='plan')s.plans[0].approved=false;if(mutation==='catalog')s.connections[0].providerCatalog.models.pop();});
      return {message:baseMessage,contextId:'INJECTED_CONTEXT',receipt:{qualification:'INJECTED_SETUP'}};
    },nativeTransport:{cli:async args=>{projects.push({id:crypto.randomUUID(),workspaceRoot:args[2]});return '';},call:async name=>{if(name==='t3_project_list')return {projects};turns++;throw Error('Must not launch');},openFeed:async()=>{throw Error('Must not observe an unlaunched turn');}}});
    const original=h.t3.startRun;h.t3.startRun=i=>owner.startRun(i);
    try{await h.advance(initial);assert.equal(turns,0,mutation);assert.equal(h.store.read().runs[0].status,'failed');}
    finally{h.t3.startRun=original;await owner.shutdown();}
  }
});
