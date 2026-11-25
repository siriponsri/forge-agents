import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNativeUsage,collectNativeUsage,createNativeUsageBridge,assertNativeUsageObservation,NATIVE_USAGE_SOURCE} from '../app/budgets/native-usage.mjs';
import {createBudgetService,dispatchBudgetRequest} from '../app/budgets/service.mjs';
import {mergeBudgetSafety} from '../app/budgets/recovery.mjs';
import {fixture,usd,code} from './budgets-fixture.test.mjs';

// PINNED CONTRACT FIXTURES: T3 59651c1761f6c63e9b6056839067066968e6a406.
// Constructed protocol samples, NOT captures of live provider execution. Only
// fields used at this boundary are supplied; no auth/account/model turn occurs.
const nativeRef=id=>({driver:'codex',nativeId:id,strength:'strong'});
function projection(r){
  const providerInstanceId=r.providerInstanceId,model=r.selection.model;
  return {thread:{id:r.threadId,projectId:r.t3ProjectId,providerInstanceId},
    runs:[{id:r.providerRunId,threadId:r.threadId,providerInstanceId,modelSelection:{instanceId:providerInstanceId,model},activeAttemptId:'native-attempt-1'}],
    attempts:[{id:'native-attempt-1',runId:r.providerRunId,attemptOrdinal:1,rootNodeId:'root-1',providerInstanceId,providerThreadId:'provider-thread-1',providerTurnId:'turn-1',nativeThreadId:'session-1',status:'completed'}],
    providerThreads:[{id:'provider-thread-1',driver:'codex',providerInstanceId,appThreadId:r.threadId,nativeThreadRef:nativeRef('session-1'),contextUsage:{usedTokens:999999,cost:{amount:12345,currency:'USD'}}}],
    providerTurns:[{id:'turn-1',providerThreadId:'provider-thread-1',nodeId:'root-1',runAttemptId:'native-attempt-1',ordinal:1,status:'completed',nativeTurnRef:nativeRef('native-turn-1'),nativeThreadRef:nativeRef('session-1'),model,
      tokenUsage:{usedTokens:999999,inputTokens:9999,outputTokens:9999},
      turnTokenUsage:{usageScope:'main_agent',usageStatus:'complete',inputTokens:10,outputTokens:4,cachedInputTokens:6,cacheCreationTokens:2,reasoningTokens:3,hasSubagents:false,models:[model],otherUsage:{inputTokens:0,outputTokens:0}}}],
  };
}
const turn=p=>p.providerTurns[0];
const usage=p=>turn(p).turnTokenUsage;
async function setup(t){
  const f=await fixture(t),run=await f.start({threadId:'native-thread',providerRunId:'native-run',t3ProjectId:'native-project'});
  const p=projection(run);
  const make=()=>{
    // Emulate the mandatory lead-owned guard in production Budget.observe's
    // transaction. Actual Budget/store/ledger/Stop implementation is unmodified.
    // The guard runs before SQLite commit; any race rolls the whole tx back.
    const guardedStore={read:()=>f.store.read(),transaction:fn=>f.store.transaction(async s=>{
      const before=new Set(s.events.map(e=>e.id)),result=await fn(s);
      for(const e of s.events.filter(e=>!before.has(e.id)&&e.type==='budget.observation'&&e.source===NATIVE_USAGE_SOURCE)){
        assertNativeUsageObservation(s,{...e.binding,source:e.source,sourceReceiptId:e.sourceReceiptId,sequence:e.sequence,cost:e.cost,usage:e.usage,final:e.final,occurredAt:e.occurredAt});
      }
      return result;
    })};
    const budgets=createBudgetService({store:guardedStore,t3:f.t3,authorize:f.authorize});
    return {budgets,bridge:createNativeUsageBridge({store:f.store,budgets})};
  };
  return {f,run,p,make,...make()};
}
function addTurn(p,{id='turn-2',attempt=1,input=7,output=3}={}){
  const previous=p.providerTurns.at(-1),a=p.attempts[attempt-1],t=structuredClone(previous);
  Object.assign(t,{id,runAttemptId:a.id,nodeId:a.rootNodeId,providerThreadId:a.providerThreadId,ordinal:previous.ordinal+1,nativeTurnRef:nativeRef(`native-${id}`)});
  Object.assign(t.turnTokenUsage,{inputTokens:input,outputTokens:output,cachedInputTokens:0,cacheCreationTokens:0,reasoningTokens:0});
  p.providerTurns.push(t);a.providerTurnId=id;return t;
}

test('exact measured cumulative scope ignores context/cost and never double counts cache/reasoning',async t=>{
  const {f,run,p}=await setup(t),before=f.store.read(),o=selectNativeUsage(before,{runId:run.id,projection:p});
  assert.equal(o.status,'measured');assert.equal(o.scope,'model_bound_run');assert.deepEqual(o.usage,{totalTokens:14});
  assert.deepEqual(o.mainAgent,{inputTokens:10,outputTokens:4,knownTokens:14,basis:'complete_main_agent'});
  assert.equal(o.cost,null);assert.equal(o.final,false);assert.match(o.limitations.join(' '),/billing receipt/);assert.deepEqual(f.store.read(),before);
});

test('zero is measured; missing/partial counters and local command results never become zero model usage',async t=>{
  const {f,run,p}=await setup(t),s=f.store.read();
  for(const key of ['inputTokens','outputTokens','cachedInputTokens','cacheCreationTokens','reasoningTokens'])usage(p)[key]=0;
  assert.deepEqual(selectNativeUsage(s,{runId:run.id,projection:p}).usage,{totalTokens:0});
  delete turn(p).turnTokenUsage;
  let o=selectNativeUsage(s,{runId:run.id,projection:p});assert.equal(o.status,'unavailable');assert.equal(o.mainAgent.knownTokens,null);assert.equal(o.usage,null);
  turn(p).turnTokenUsage={usageScope:'main_agent',usageStatus:'partial',hasSubagents:false,inputTokens:0};
  o=selectNativeUsage(s,{runId:run.id,projection:p});assert.equal(o.status,'partial');assert.equal(o.mainAgent.knownTokens,0);assert.equal(o.mainAgent.outputTokens,null);assert.equal(o.usage,null);
  usage(p).inputTokens=20;usage(p).localCommand=true;
  o=selectNativeUsage(s,{runId:run.id,projection:p});assert.equal(o.mainAgent.knownTokens,null);assert.equal(o.usage,null);
});

test('complete main-agent scope cannot prove whole-run coverage without explicit zero other usage',async t=>{
  const {f,run,p}=await setup(t);
  for(const patch of [{otherUsage:undefined},{hasSubagents:true},{otherUsage:{inputTokens:8,outputTokens:2}},{usageStatus:'partial'}]){
    const q=structuredClone(p);Object.assign(usage(q),patch);if(patch.otherUsage===undefined&&'otherUsage'in patch)delete usage(q).otherUsage;
    const o=selectNativeUsage(f.store.read(),{runId:run.id,projection:q});assert.equal(o.status,'partial');assert.equal(o.mainAgent.knownTokens,14);assert.equal(o.usage,null);assert.equal(o.cost,null);assert.equal(o.final,false);
  }
});

test('every exact turn and retry contributes, while foreign run turns are excluded',async t=>{
  const {f,run,p}=await setup(t);addTurn(p);
  p.attempts.push({...p.attempts[0],id:'native-attempt-2',attemptOrdinal:2,rootNodeId:'root-2',reason:'retry',providerTurnId:null});p.runs[0].activeAttemptId='native-attempt-2';
  addTurn(p,{id:'turn-3',attempt:2,input:11,output:5});
  const foreign=structuredClone(p.providerTurns[0]);Object.assign(foreign,{id:'foreign-turn',runAttemptId:'foreign-attempt',nodeId:'foreign-root',ordinal:10,nativeTurnRef:nativeRef('foreign-turn')});
  p.attempts.push({...p.attempts[0],id:'foreign-attempt',runId:'foreign-run',rootNodeId:'foreign-root'});p.providerTurns.push(foreign);
  const o=selectNativeUsage(f.store.read(),{runId:run.id,projection:p});assert.equal(o.status,'measured');assert.equal(o.usage.totalTokens,40);assert.equal(o.attempts.length,2);assert.deepEqual(o.attempts.map(a=>a.turns.length),[2,1]);
});

test('fails closed for duplicate identities, malformed/overflow counts and incomplete attempt/turn coverage',async t=>{
  const {f,run,p}=await setup(t);
  const changes=[
    q=>q.providerTurns.push(structuredClone(turn(q))),
    q=>q.attempts.push({...q.attempts[0]}),
    q=>q.providerThreads.push({...q.providerThreads[0]}),
    q=>{const t=addTurn(q);t.nativeTurnRef=structuredClone(turn(q).nativeTurnRef);},
    q=>{usage(q).inputTokens=Number.MAX_SAFE_INTEGER;},
    q=>{usage(q).inputTokens=-1;},q=>{usage(q).reasoningTokens=5;},q=>{usage(q).cachedInputTokens=11;},
    q=>{delete usage(q).outputTokens;},q=>{usage(q).delta=true;},
    q=>{q.attempts[0].attemptOrdinal=2;},q=>{q.attempts[0].providerTurnId='missing';},
    q=>{const t=addTurn(q);t.ordinal=3;},q=>{turn(q).runAttemptId=null;},
    q=>{q.hasMoreHistory=true;},q=>{q.historyCursor='opaque-cursor';},q=>{delete q.attempts;},
  ];
  for(const mutate of changes){const q=structuredClone(p);mutate(q);const o=selectNativeUsage(f.store.read(),{runId:run.id,projection:q});assert.equal(o.status,'unavailable',mutate.toString());assert.equal(o.usage,null);assert.equal(o.identity,undefined);}
});

test('rejects borrowing run/project/provider/session/model evidence and unknown executed models',async t=>{
  const {f,run,p}=await setup(t);
  const changes=[q=>{q.thread.id='foreign';},q=>{q.thread.projectId='foreign';},q=>{q.runs[0].id='foreign';},q=>{q.runs[0].threadId='foreign';},q=>{q.runs[0].providerInstanceId='foreign';},q=>{q.runs[0].modelSelection.model='foreign';},q=>{q.attempts[0].providerInstanceId='foreign';},q=>{q.providerThreads[0].providerInstanceId='foreign';},q=>{q.providerThreads[0].appThreadId='foreign';},q=>{turn(q).providerThreadId='foreign';},q=>{turn(q).nativeThreadRef=nativeRef('foreign');},q=>{turn(q).model='foreign';},q=>{usage(q).models=['foreign'];},q=>{delete turn(q).model;delete usage(q).models;}];
  for(const mutate of changes){const q=structuredClone(p);mutate(q);const o=selectNativeUsage(f.store.read(),{runId:run.id,projection:q});assert.equal(o.status,'unavailable',mutate.toString());assert.equal(o.identity,undefined);}
});

test('reused provider-thread session retains exact historical attempt destination or rejects ambiguity',async t=>{
  const {f,run,p}=await setup(t);p.providerThreads[0].nativeThreadRef=nativeRef('later-session');
  assert.equal(selectNativeUsage(f.store.read(),{runId:run.id,projection:p}).status,'measured');
  delete p.attempts[0].nativeThreadId;
  assert.equal(selectNativeUsage(f.store.read(),{runId:run.id,projection:p}).reason,'NATIVE_USAGE_SESSION');
});

test('immutable receipts survive actual SQLite restart, reorder/replay, cumulative turns and sourceReceipt forgery',async t=>{
  const {f,run,p,bridge,make}=await setup(t);
  const results=await Promise.all([bridge.collect({runId:run.id,projection:p}),bridge.collect({runId:run.id,projection:p})]);
  assert.equal(results[0].receipt.sourceReceiptId,results[1].receipt.sourceReceiptId);assert.equal(results[1].status,'replayed');
  await bridge.feed({runId:run.id});await f.reopen();const restarted=make();
  assert.equal((await restarted.bridge.feed({runId:run.id})).delivered,0);
  addTurn(p);const next=await restarted.bridge.collect({runId:run.id,projection:p});assert.equal(next.receipt.sequence,2);await restarted.bridge.feed({runId:run.id});
  const reordered=structuredClone(p);reordered.providerTurns.reverse();assert.equal((await restarted.bridge.collect({runId:run.id,projection:reordered})).status,'replayed');
  const o=f.store.read().events.filter(e=>e.type==='budget.observation');assert.equal(o.length,2);assert.deepEqual(o.map(e=>e.usage.totalTokens),[14,24]);assert.equal(o.every(e=>e.cost===null&&!e.final),true);
  const r=next.receipt,input={...r.snapshot.identity.binding,source:NATIVE_USAGE_SOURCE,sourceReceiptId:r.sourceReceiptId,sequence:r.sequence,cost:null,usage:{totalTokens:500},final:false,occurredAt:null};
  assert.throws(()=>assertNativeUsageObservation(f.store.read(),input),code('NATIVE_USAGE_RECEIPT'));
  const altered=f.store.read();altered.receipts.find(r=>r.sourceReceiptId===next.receipt.sourceReceiptId).snapshot.usage.totalTokens=800;
  assert.throws(()=>assertNativeUsageObservation(altered,{...input,usage:{totalTokens:24}}),code('NATIVE_USAGE_RECEIPT'));
  assert.equal(f.stops.length,0);assert.equal(f.store.read().runs.length,1);
});

test('previous exact snapshot replays at original sequence; unseen stale or regressed cumulative evidence is rejected',async t=>{
  const {f,run,p,bridge}=await setup(t),original=structuredClone(p);
  await bridge.collect({runId:run.id,projection:p});addTurn(p);await bridge.collect({runId:run.id,projection:p});
  assert.equal((await bridge.collect({runId:run.id,projection:original})).receipt.sequence,1);
  const missing=structuredClone(p);missing.providerTurns.shift();
  await assert.rejects(bridge.collect({runId:run.id,projection:missing}),code('NATIVE_USAGE_REGRESSION'));
  const regressed=structuredClone(p);usage(regressed).inputTokens=9;
  await assert.rejects(bridge.collect({runId:run.id,projection:regressed}),code('NATIVE_USAGE_REGRESSION'));
  const partial=structuredClone(p);usage(partial).usageStatus='partial';
  await assert.rejects(bridge.collect({runId:run.id,projection:partial}),code('NATIVE_USAGE_REGRESSION'));
  assert.equal(f.store.read().receipts.filter(r=>r.type==='budget.native-usage').length,2);
});

test('collector can run inside canonical transaction; partial snapshots feed unknown without releasing holds',async t=>{
  const {f,run,p,bridge}=await setup(t);delete usage(p).otherUsage;
  const result=await f.store.transaction(s=>collectNativeUsage(s,{runId:run.id,projection:p}));assert.equal(result.status,'collected');
  await bridge.feed({runId:run.id});await f.finish(run);await f.reopen();
  const state=await f.state();assert.equal(state.attempts[0].held,true);assert.equal(state.attempts[0].usage,null);assert.equal(state.attempts[0].pricingStatus,'unknown');
  await f.configure({unknown:'block'});await assert.rejects(f.start(),code('BUDGET_UNKNOWN'));
});

test('measured tokens still preserve unknown monetary accounting and reservation after completed/restart/restore',async t=>{
  const {f,run,p,bridge,make}=await setup(t);await f.configure({reserve:usd(20)});
  const backup=f.store.read();await bridge.collect({runId:run.id,projection:p});await bridge.feed({runId:run.id});await f.finish(run);
  const before=await f.state();assert.deepEqual(before.attempts[0].usage,{totalTokens:14});assert.equal(before.attempts[0].held,true);assert.equal(before.attempts[0].cost,null);
  await f.store.transaction(s=>Object.assign(s,mergeBudgetSafety(structuredClone(backup),s)));await f.reopen();
  const reopened=make();assert.equal((await reopened.bridge.drain())[0].delivered,0);
  assert.equal(f.store.read().receipts.filter(r=>r.type==='budget.native-usage').length,1);assert.equal((await f.state()).attempts[0].held,true);
});

test('source identity rechecked after await: queued canonical rebind rolls Budget transaction back',async t=>{
  const {f,run,p,bridge}=await setup(t);await bridge.collect({runId:run.id,projection:p});
  let resume,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>resume=r);
  const rebind=f.store.transaction(async s=>{entered();await gate;s.runs[0].providerRunId='foreign-native-run';});await ready;
  const pending=bridge.feed({runId:run.id});resume();await rebind;
  await assert.rejects(pending,code('NATIVE_USAGE_IDENTITY'));
  assert.equal(f.store.read().events.filter(e=>e.type==='budget.observation').length,0);assert.equal(f.stops.length,0);
});

test('post-await source change fails closed before feeding another receipt',async t=>{
  const {f,run,p}=await setup(t);let calls=0;
  const bridge=createNativeUsageBridge({store:f.store,budgets:{async observe(){calls++;await f.store.transaction(s=>{s.runs[0].threadId='foreign';});}}});
  await bridge.collect({runId:run.id,projection:p});addTurn(p);await bridge.collect({runId:run.id,projection:p});
  await assert.rejects(bridge.feed({runId:run.id}),code('NATIVE_USAGE_IDENTITY'));assert.equal(calls,1);
});

test('Budget owns Stop: nested feed returns immediately, duplicate/restart produce no additional Stop',async t=>{
  const {f,run,p,bridge,make}=await setup(t);await f.configure({unknown:'block',reserve:usd(10)});
  f.t3.stop=async id=>{f.stops.push(id);addTurn(p);await bridge.collect({runId:id,projection:p});assert.equal((await bridge.feed({runId:id})).status,'in-flight');};
  await bridge.collect({runId:run.id,projection:p});
  const fed=await Promise.race([bridge.feed({runId:run.id}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Stop/feed deadlock')),3000);timer.unref();})]);assert.equal(fed.delivered,2);
  assert.equal(f.stops.length,1);await bridge.feed({runId:run.id});await f.reopen();await make().bridge.drain();assert.equal(f.stops.length,1);
  assert.equal((await f.state()).attempts[0].held,true);assert.equal(f.store.read().runs.length,1);
});

test('competing bridge instances deliver the same immutable receipt only once',async t=>{
  const {f,run,p,bridge,make}=await setup(t);await bridge.collect({runId:run.id,projection:p});
  await Promise.all([bridge.feed({runId:run.id}),make().bridge.feed({runId:run.id})]);
  const observations=f.store.read().events.filter(e=>e.type==='budget.observation');assert.equal(observations.length,1);assert.equal(observations[0].usage.totalTokens,14);assert.equal(f.stops.length,0);
});

test('absent parent counters keep valid subset evidence without inventing totals, and terminal status cannot regress',async t=>{
  const {f,run,p,bridge}=await setup(t);
  const q=structuredClone(p);usage(q).usageStatus='partial';delete usage(q).inputTokens;delete usage(q).outputTokens;
  const partial=selectNativeUsage(f.store.read(),{runId:run.id,projection:q});assert.equal(partial.reason,'NATIVE_COUNTERS_UNAVAILABLE');assert.equal(partial.attempts[0].turns[0].usage.cachedInputTokens,6);assert.equal(partial.usage,null);
  await bridge.collect({runId:run.id,projection:p});const running=structuredClone(p);turn(running).status='running';
  await assert.rejects(bridge.collect({runId:run.id,projection:running}),code('NATIVE_USAGE_REGRESSION'));
});

test('no generic HTTP ingestion method, competing Budget sources and cross-run receipt reuse fail closed',async t=>{
  const {f,run,p,bridge,budgets}=await setup(t);
  for(const method of ['collect','feed','drain','observe'])await assert.rejects(dispatchBudgetRequest(budgets,method,{},f.owner),code('NOT_FOUND'));
  const collected=await bridge.collect({runId:run.id,projection:p});const other=await f.start({threadId:'native-thread',providerRunId:'native-run',t3ProjectId:'native-project'});
  const r=collected.receipt,input={...r.snapshot.identity.binding,runId:other.id,attemptId:other.attemptId,source:NATIVE_USAGE_SOURCE,sourceReceiptId:r.sourceReceiptId,sequence:1,cost:null,usage:{totalTokens:14},final:false,occurredAt:null};
  assert.throws(()=>assertNativeUsageObservation(f.store.read(),input),code('NATIVE_USAGE_RECEIPT'));
  await f.service.observe(f.observation(run));
  addTurn(p);await assert.rejects(bridge.collect({runId:run.id,projection:p}),code('NATIVE_USAGE_SOURCE'));
});
