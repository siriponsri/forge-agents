import test from 'node:test';
import assert from 'node:assert/strict';
import {entity,changed} from '../app/server/domain.mjs';
import {createProactiveService,dispatchProactiveRequest,PROACTIVE_HTTP_METHODS,validateProactiveContext,validateProactiveAction,proactivePrompt} from '../app/proactive/index.mjs';
import {nextSchedule,validateTrigger} from '../app/proactive/schedule.mjs';
import {fixture,code,eventTrigger} from './proactive-fixture.test.mjs';

test('daily trigger executes one canonical task, observes real local bytes and delivers one durable receipt',async t=>{
  const f=await fixture(t);f.control.guardEffect=true;const r=await f.enable({scope:{paths:['.'],capabilities:['read','propose','workspace.write']}});assert.equal(f.starts,0);
  let o=await f.due();assert.equal(f.starts,1);assert.equal(o.status,'dispatched');assert.ok(o.held);assert.notEqual(o.runId,'untrusted-response-id');
  assert.match(await f.bytes(o),/INJECTED_T3_OWNER proactive:/);
  assert.match(proactivePrompt(o.context),/Mutable or outward effects still require existing governance/);
  o=await f.finish(o,{tokens:12,cost:{amount:0.01,currency:'USD',source:'fixture-reported'}});
  assert.equal(o.status,'delivered');assert.equal(o.held,false);assert.equal(f.state().deliveries.length,1);
  await Promise.all([f.service.tick(),f.service.tick()]);assert.equal(f.starts,1);assert.equal(f.state().deliveries.length,1);
  assert.equal(f.recipe(r).usage.tokens.reportedTotal,12);assert.equal(f.store.read().tasks[0].status,'running','delivery never marks acceptance or task done');
  const before=f.reconciles;await f.call('reconcile',r,{occurrenceId:o.id});assert.equal(f.reconciles,before,'established terminal delivery does not reacquire a claim or poll effects');
});

test('approval is opaque human session authority; request booleans, actors and inherited property methods fail closed',async t=>{
  const f=await fixture(t),r=await f.create();
  await assert.rejects(f.call('enable',r),code('APPROVAL_REQUIRED'));
  await assert.rejects(f.call('approve',r,{},Object.freeze({privateSession:'fixture-owner'})),code('OWNER_REQUIRED'));
  await assert.rejects(f.call('approve',r,{approved:true}),code('VALIDATION'));
  await assert.rejects(f.call('approve',r,{actor:{kind:'human'}}),code('VALIDATION'));
  for(const method of ['__proto__','constructor','tick','ingestEvent','close'])await assert.rejects(dispatchProactiveRequest(f.service,method,{},f.owner),code('NOT_FOUND'));
  assert.deepEqual(PROACTIVE_HTTP_METHODS,['state','create','revise','approve','enable','pause','revoke','reconcile','resolve']);
  await assert.rejects(dispatchProactiveRequest(f.service,'state',[],f.owner),code('VALIDATION'));
});

test('deterministic timezone schedule handles weekday, DST gap and repeated wall time without double trigger',()=>{
  const base={kind:'schedule',timezone:'Asia/Bangkok',localTime:'09:00',weekdays:[1],maxLatenessMs:60000};
  assert.equal(new Date(nextSchedule(base,Date.parse('2026-11-25T01:59:00Z')).at).toISOString(),'2026-11-30T02:00:00.000Z');
  const dst={...base,timezone:'America/New_York',weekdays:[0,1,2,3,4,5,6],localTime:'02:30'};
  assert.equal(new Date(nextSchedule(dst,Date.parse('2026-03-08T05:00:00Z')).at).toISOString(),'2026-03-09T06:30:00.000Z');
  dst.localTime='01:30';const first=nextSchedule(dst,Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(new Date(first.at).toISOString(),'2026-11-01T05:30:00.000Z');
  assert.equal(new Date(nextSchedule(dst,first.at,first.key).at).toISOString(),'2026-11-02T06:30:00.000Z');
  assert.throws(()=>validateTrigger({...base,timezone:'not/a-zone'}),code('TIMEZONE'));
});

test('missed schedule becomes Inbox and advances without catch-up effects',async t=>{
  const f=await fixture(t),r=await f.enable();f.advance(180000);await f.service.tick();
  assert.equal(f.starts,0);assert.equal(f.state().inbox[0].code,'MISSED_SCHEDULE');assert.equal(f.state().occurrences[0].status,'inbox');
  assert.ok(f.recipe(r).nextDue.at>f.now);await f.service.tick();assert.equal(f.starts,0);
});

test('authenticated event contract dedupes concurrent deliveries, rejects forged identities and altered reuse',async t=>{
  const f=await fixture(t),r=await f.enable({trigger:eventTrigger});
  await assert.rejects(f.event(r,'bad',{},{}),code('EVENT_AUTH_REQUIRED'));
  const results=await Promise.all([f.event(r),f.event(r),f.event(r)]);
  assert.equal(new Set(results.map(r=>r.id)).size,1);assert.equal(f.starts,1);
  await assert.rejects(f.event(r,'event-1',{occurredAt:f.now-1}),code('EVENT_REUSE'));
  await f.finish(results[0]);f.control.eventIdentity={subject:'different-owner'};
  const outside=await f.event(r,'event-2');assert.equal(outside.status,'inbox');assert.equal(f.starts,1);
  assert.ok(f.state().inbox.some(x=>x.code==='EVENT_OUTSIDE_ENVELOPE'));
});

test('old and future events route to Inbox; event body cannot choose actions or assert approval',async t=>{
  const f=await fixture(t),r=await f.enable({trigger:eventTrigger});
  for(const occurredAt of [f.now-60001,f.now+5001])assert.equal((await f.event(r,`time-${occurredAt}`,{occurredAt})).status,'inbox');
  await assert.rejects(f.event(r,'override',{taskId:f.tasks[1].id}),code('VALIDATION'));
  assert.equal(f.starts,0);
});

test('two services sharing the canonical SQLite store cannot claim one event twice',async t=>{
  const f=await fixture(t),r=await f.enable({trigger:eventTrigger});
  const other=createProactiveService({store:f.store,t3:f.t3,clock:()=>f.now,authenticateEvent:async()=>({projectId:f.project.id,source:eventTrigger.source,subject:eventTrigger.subject,eventType:eventTrigger.eventType})});
  const input={projectId:f.project.id,recipeId:r.id,eventId:'concurrent-sqlite',occurredAt:f.now};
  const results=await Promise.all([f.service.ingestEvent(input,f.eventCaller),other.ingestEvent(input,{})]);
  assert.equal(results[0].id,results[1].id);assert.equal(f.starts,1);
  // One FORGE process owns the canonical store; competing controllers share its
  // serialized transactions. A second process is not a supported scheduler.
});

test('version edits, changed accounts, plan/bot/task changes, expiry and restart invalidate grants',async t=>{
  for(const kind of ['connection','profile','plan','bot','task','expiry']){
    await t.test(kind,async t=>{
      const f=await fixture(t),r=await f.enable();
      await f.store.transaction(s=>{const item=kind==='connection'?s.connections[0]:kind==='profile'?s.projects[0]:kind==='plan'?s.plans[0]:kind==='bot'?s.bots[0]:kind==='task'?s.tasks[0]:null;if(item){if(kind==='profile')item.profile.provider.model='other';else item.name='changed';if(kind==='task')item.description='changed';changed(item);}});
      if(kind==='expiry')f.advance(8*86400000);else f.advance(60000);await f.service.tick();
      assert.equal(f.starts,0);assert.equal(f.recipe(r).status,'needs_approval');assert.equal(f.recipe(r).grant,null);assert.ok(f.state().inbox.length);
    });
  }
  const f=await fixture(t);let r=await f.enable();const v=r.versionId;
  r=await f.call('revise',r,f.definition({instructions:'Revised bounded instruction'}));assert.notEqual(r.versionId,v);assert.equal(r.status,'draft');assert.equal(r.grant,null);
  const after=await f.restart({crash:true});assert.equal(after.recipes[0].grant,null);assert.equal(f.starts,0);
});

test('unconditional validator rejects omitted, altered, stale and foreign contexts',async t=>{
  const f=await fixture(t),r=await f.enable();let saved;
  f.control.before=async input=>{
    saved=input;const s=f.store.read();assert.ok(validateProactiveContext(s,input,()=>f.now));
    assert.throws(()=>validateProactiveContext(s,{...input,proactiveContext:undefined},()=>f.now),code('PROACTIVE_CONTEXT_REQUIRED'));
    assert.throws(()=>validateProactiveContext(s,{...input,proactiveContext:{...input.proactiveContext,scope:{paths:['.'],capabilities:['external.write']}}},()=>f.now),code('PROACTIVE_CONTEXT'));
    assert.throws(()=>validateProactiveContext(s,{...input,taskId:f.tasks[1].id},()=>f.now),code('PROACTIVE_CONTEXT'));
    assert.throws(()=>validateProactiveContext(s,{...input,operationId:'other'},()=>f.now),code('PROACTIVE_CONTEXT'));
  };
  const o=await f.due();await f.finish(o);await f.call('pause',r);
  assert.throws(()=>validateProactiveContext(f.store.read(),saved,()=>f.now),code('GRANT_REQUIRED'));
});

test('revoke while T3 is pending prevents stale authority at the final reservation',async t=>{
  const f=await fixture(t),r=await f.enable({trigger:eventTrigger});let release,entered;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.control.before=async()=>{entered();await gate;};
  const dispatch=f.event(r);await ready;await f.call('revoke',r);release();await dispatch;
  assert.equal(f.store.read().runs.length,0);assert.equal(f.stops,0);assert.equal(f.state().occurrences[0].status,'unknown');assert.equal(f.state().occurrences[0].held,true);
  await f.service.tick();assert.equal(f.starts,1);
});

test('lost accepted response reconciles exact receipt; no automatic retry after possible effects',async t=>{
  const f=await fixture(t);await f.enable();f.control.failAfter=true;
  let o=await f.due();assert.equal(o.status,'dispatched');assert.equal(f.starts,1);assert.match(await f.bytes(o),/INJECTED_T3_OWNER/);
  const snapshot=await f.restart({crash:true});assert.equal(f.starts,1);assert.equal(f.stops,1);assert.equal(snapshot.occurrences[0].status,'delivered');assert.equal(snapshot.recipes[0].grant,null);
  await f.service.tick();assert.equal(f.starts,1);assert.equal(f.state().deliveries.length,1);
});

test('submission without durable receipt remains unknown across SQLite restart and cannot be resolved into retry',async t=>{
  const f=await fixture(t),r=await f.enable();f.control.failBefore=true;const o=await f.due();
  assert.equal(o.status,'unknown');assert.equal(f.starts,1);assert.equal(f.store.read().runs.length,0);
  await f.restart({crash:true});await f.service.tick();assert.equal(f.starts,1);assert.equal(f.stops,0);
  const item=f.state().inbox.find(i=>i.occurrenceId===o.id);
  await assert.rejects(f.call('resolve',r,{inboxId:item.id,note:'The unknown effect cannot be assumed absent'}),code('RECONCILE_REQUIRED'));
  await assert.rejects(f.call('approve',r),code('RECONCILE_REQUIRED'));
});

test('run context mismatch never stops a foreign owner, never delivers and keeps held claim',async t=>{
  for(const kind of ['ignoreContext','foreign'])await t.test(kind,async t=>{
    const f=await fixture(t),r=await f.enable();f.control[kind]=true;let o=await f.due();assert.equal(o.status,'unknown');
    await f.call('pause',r);assert.equal(f.stops,0);o=f.state().occurrences[0];assert.ok(o.held);assert.equal(f.state().deliveries.length,0);
  });
});

test('pause, elapsed deadline and close stop only the exact run; uncertain Stop is never repeated',async t=>{
  for(const action of ['pause','deadline','close'])await t.test(action,async t=>{
    const f=await fixture(t),r=await f.enable();const o=await f.due();
    await f.store.transaction(s=>s.runs.push(entity({operationId:'unrelated-terminal',taskId:f.tasks[3].id,status:'completed'},f.project.id)));
    if(action==='pause')await f.call('pause',r);if(action==='deadline'){f.advance(300001);await f.service.tick();}if(action==='close')await f.service.close();
    assert.equal(f.stops,1);assert.equal(f.store.read().runs.find(x=>x.id===o.runId).status,'interrupted');assert.equal(f.store.read().runs.at(-1).status,'completed');
    assert.equal(f.state().occurrences[0].held,false);
  });
  const f=await fixture(t),r=await f.enable();f.control.stopUnknown=true;await f.due();await f.call('pause',r);await f.service.tick();await f.service.tick();assert.equal(f.stops,1);assert.equal(f.state().occurrences[0].held,true);
});

test('unknown reported monetary or token use blocks caps; estimates/subscriptions are not charged as reported zero',async t=>{
  for(const kind of ['money','tokens'])await t.test(kind,async t=>{
    const f=await fixture(t),budget={maxRuns:4,maxRunMs:300000,maxTokens:kind==='tokens'?100:null,maxCost:kind==='money'?1:null,currency:kind==='money'?'USD':null};
    const r=await f.enable({trigger:eventTrigger,budget});let o=await f.event(r);await f.finish(o,{estimate:{amount:0.01,currency:'USD',source:'estimate'},subscription:{plan:'fixture-no-price'}});
    o=await f.event(r,'second');assert.equal(o.status,'inbox');assert.equal(f.starts,1);
    const u=f.recipe(r).usage;assert.equal(u.tokens.reportedTotal,null);assert.equal(u.cost.unknown,true);assert.equal(u.estimates.length,1);assert.equal(u.subscriptions.length,1);
    assert.ok(f.state().inbox.some(i=>i.code===(kind==='money'?'COST_UNKNOWN':'TOKENS_UNKNOWN')));
  });
});

test('reported cap, currency mismatch, maximum starts and tasks consumed across revisions bound future work',async t=>{
  for(const kind of ['tokens','money','currency','runs'])await t.test(kind,async t=>{
    const f=await fixture(t),budget={maxRuns:kind==='runs'?1:4,maxRunMs:300000,maxTokens:kind==='tokens'?10:null,maxCost:['money','currency'].includes(kind)?1:null,currency:['money','currency'].includes(kind)?'USD':null};
    const r=await f.enable({trigger:eventTrigger,budget}),o=await f.event(r);await f.finish(o,{tokens:10,cost:{amount:1,currency:kind==='currency'?'THB':'USD',source:'fixture-reported'}});
    assert.equal((await f.event(r,'second')).status,'inbox');assert.equal(f.starts,1);
  });
  const f=await fixture(t);let r=await f.enable({trigger:eventTrigger,taskIds:[f.tasks[0].id]}),o=await f.event(r);await f.finish(o);await f.call('pause',r);
  await f.store.transaction(s=>{s.tasks[0].status='ready';changed(s.tasks[0]);});
  r=await f.call('revise',r,f.definition({trigger:eventTrigger,taskIds:[f.tasks[0].id]}));r=await f.call('approve',r);r=await f.call('enable',r);
  o=await f.event(r,'new-version');assert.equal(o.status,'inbox');assert.equal(f.starts,1);assert.ok(f.state().inbox.some(i=>i.code==='NO_READY_TASK'));
});

test('mobile-linked tasks never bypass originating-channel approval and existing controllers retain ownership',async t=>{
  for(const kind of ['mobile','goal','goal-task','assistance','adaptive','run','dependency'])await t.test(kind,async t=>{
    const f=await fixture(t);
    if(kind==='dependency')await f.store.transaction(s=>{s.tasks[0].dependsOn=[f.tasks[1].id];});
    const r=await f.enable({trigger:eventTrigger,taskIds:[f.tasks[0].id]});
    await f.store.transaction(s=>{
      if(kind==='mobile')s.relay={inbox:[{projectId:f.project.id,taskId:f.tasks[0].id}]};
      if(kind==='goal')s.events.push(entity({type:'goal.claim',status:'held'},f.project.id));
      if(kind==='goal-task')s.events.push(entity({type:'goal.goal',status:'paused',taskIds:[f.tasks[0].id]},f.project.id));
      if(['assistance','adaptive'].includes(kind))s.events.push(entity({type:`${kind}.loop`,status:'active'},f.project.id));
      if(kind==='run')s.runs.push(entity({status:'unknown',taskId:f.tasks[2].id},f.project.id));
    });
    const o=await f.event(r);assert.equal(f.starts,0);assert.equal(o.status,'inbox');
  });
});

test('supplemental action guard narrows capabilities/paths, checks symlink ancestors and never bypasses revocation',async t=>{
  const {mkdir,symlink}=await import('node:fs/promises');const path=await import('node:path');
  const f=await fixture(t);await mkdir(path.join(f.project.workspace,'allowed'));await mkdir(path.join(f.project.workspace,'private'));
  // Windows junctions need no admin privilege and exercise realpath traversal.
  await symlink(path.join(f.project.workspace,'private'),path.join(f.project.workspace,'allowed','jump'),'junction');
  const r=await f.enable({scope:{paths:['allowed'],capabilities:['read','propose']}}),o=await f.due();
  const input={projectId:f.project.id,runId:o.runId,capability:'read',path:'allowed/new.txt'};
  assert.ok(validateProactiveAction(f.store.read(),input,()=>f.now));
  for(const p of ['../outside','private/secret.txt','allowed/jump/secret.txt'])assert.throws(()=>validateProactiveAction(f.store.read(),{...input,path:p},()=>f.now),code('PROACTIVE_PATH_DENIED'));
  assert.throws(()=>validateProactiveAction(f.store.read(),{...input,capability:'workspace.write'},()=>f.now),code('PROACTIVE_ACTION_DENIED'));
  assert.throws(()=>validateProactiveAction(f.store.read(),{...input,path:undefined},()=>f.now),code('PROACTIVE_PATH_REQUIRED'));
  assert.ok(validateProactiveAction(f.store.read(),{...input,capability:'propose',path:undefined},()=>f.now));
  const pending=f.store.read();pending.events.find(x=>x.id===o.id).runId=null;assert.ok(validateProactiveAction(pending,input,()=>f.now));
  await f.call('revoke',r);assert.throws(()=>validateProactiveAction(f.store.read(),input,()=>f.now),code('GRANT_REQUIRED'));
});

test('close during pending submission invalidates authority before awaiting its result',async t=>{
  const f=await fixture(t);const r=await f.enable({trigger:eventTrigger});let release,entered;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);f.control.before=async()=>{entered();await gate;};
  const dispatch=f.event(r);await ready;const closing=f.service.close();
  // Store's queue provides the deterministic boundary after close invalidation.
  await f.store.transaction(()=>null);assert.equal(f.recipe(r).grant,null);release();await dispatch;await closing;
  assert.equal(f.store.read().runs.length,0);assert.equal(f.starts,1);assert.equal(f.state().occurrences[0].held,true);
});

test('scheduled start waiting on a response does not block the independent deadline watchdog',async t=>{
  const f=await fixture(t);await f.enable();let release,entered;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.control.after=async()=>{entered();await gate;};
  const initial=f.due();await ready;f.advance(300001);
  try{
    await Promise.race([f.service.tick(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Watchdog blocked by start response')),1500);timer.unref();})]);
    assert.equal(f.stops,1);assert.equal(f.store.read().runs[0].status,'interrupted');
  }finally{release();await initial;}
});

test('strict version validation rejects unsafe paths, missing caps, bad schedules and operation reuse',async t=>{
  const f=await fixture(t);
  for(const scope of [{paths:['../outside'],capabilities:['read']},{paths:['C:/outside'],capabilities:['read']},{paths:['.'],capabilities:['arbitrary.mcp']},{paths:['a//b'],capabilities:['read']}])await assert.rejects(f.create({scope}),code('SCOPE'));
  await assert.rejects(f.create({budget:{maxRuns:1,maxRunMs:1000}}));
  await assert.rejects(f.create({trigger:{...eventTrigger,approved:true}}),code('VALIDATION'));
  const input=f.input(f.definition());const first=await f.service.create(input,f.owner),again=await f.service.create(input,f.owner);assert.equal(first.id,again.id);
  await assert.rejects(f.service.create({...input,name:'other'},f.owner),code('OPERATION_REUSE'));
  let r=await f.call('approve',first);await assert.rejects(f.service.enable(f.input({recipeId:r.id,expectedRevision:1}),f.owner),code('REVISION_CONFLICT'));
});

test('unproven native enforcement fails closed before any automatic start, even for read/propose',async t=>{
  for(const kind of ['missing','unqualified','unrestricted-native','mutable-read-only-proof'])await t.test(kind,async t=>{
    const f=await fixture(t);
    if(kind==='missing')delete f.t3.proactiveEnforcementVersion;
    if(kind==='unqualified')f.control.unqualified=true;
    if(kind==='unrestricted-native')f.control.nativeActions='unverified';
    if(kind==='mutable-read-only-proof')f.control.enforcementMode='read-propose-only';
    await f.enable(kind==='mutable-read-only-proof'?{scope:{paths:['.'],capabilities:['workspace.write']}}:{});
    const o=await f.due();assert.equal(f.starts,0);assert.equal(o.status,'inbox');assert.equal(o.error,'NATIVE_ENFORCEMENT_UNQUALIFIED');
  });
  const f=await fixture(t);await f.enable();f.control.before=async()=>{f.control.unqualified=true;};
  const o=await f.due();assert.equal(f.store.read().runs.length,0);assert.equal(o.status,'unknown');assert.equal(f.starts,1,'final T3 private qualifier is independently rechecked');
  const active=await fixture(t),recipe=await active.enable();await active.due();active.control.unqualified=true;await active.service.tick();
  assert.equal(active.stops,1);assert.equal(active.recipe(recipe).grant,null);assert.equal(active.state().occurrences[0].held,false);
});

test('private internal scheduler runs and closes without an HTTP listener or starting after close',async t=>{
  const f=await fixture(t);await f.service.start({intervalMs:50});await f.service.start({intervalMs:50});
  await f.enable();f.advance(60000);
  await new Promise(resolve=>setTimeout(resolve,180));assert.equal(f.starts,1);
  await f.service.close();assert.equal(f.stops,1);await assert.rejects(f.service.tick(),code('CLOSED'));assert.equal(f.starts,1);
});
