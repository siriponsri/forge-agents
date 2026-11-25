import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {entity} from '../app/server/domain.mjs';
import {reserveBudget,validateBudgetAdmission,dispatchBudgetRequest,legacyCostToMoney,legacyObservation,mergeBudgetSafety} from '../app/budgets/index.mjs';
import {fixture,usd,code} from './budgets-fixture.test.mjs';

test('absent policy permits supervised work, persisted unpriced holds are never reported as free',async t=>{
  const f=await fixture(t),r=await f.start();assert.equal(validateBudgetAdmission(f.store.read(),{run:r}),true);
  let s=await f.state();assert.equal(s.pricingStatus,'unknown');assert.equal(s.attempts[0].cost,null);assert.equal(s.attempts[0].held,true);
  await f.finish(r,'unknown');await f.reopen();await f.service.reconcile();s=await f.state();assert.equal(s.attempts[0].held,true);assert.equal(s.attempts[0].status,'unknown');assert.equal(f.stops.length,0);
});

test('Owner authority is opaque, internal native hooks and prototype methods are not HTTP routes',async t=>{
  const f=await fixture(t);
  for(const caller of [undefined,{}, {kind:'human',role:'owner'}])await assert.rejects(f.service.state({projectId:f.projectId},caller),code('OWNER_REQUIRED'));
  for(const method of ['observe','confirmNotDispatched','reconcile','constructor','__proto__'])await assert.rejects(dispatchBudgetRequest(f.service,method,{},f.owner),code('NOT_FOUND'));
  await assert.rejects(f.configure({actor:{kind:'human'}}),code('VALIDATION'));
  await assert.rejects(f.configure({botId:f.store.read().bots[2].id}),code('NOT_FOUND'));
});

test('competing SQLite admissions reserve one finite capacity; exact own hold passes dispatch fence',async t=>{
  const f=await fixture(t);await f.configure();
  const results=await Promise.allSettled([f.start(),f.start()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUDGET_HELD');
  const run=results.find(r=>r.status==='fulfilled').value;assert.equal(validateBudgetAdmission(f.store.read(),{run}),true);assert.equal(f.store.read().runs.length,1);
  assert.equal((await f.state()).policies[0].exposure.held.minorUnits,60);
});

test('independent processes contend for actual SQLite budget capacity atomically',async t=>{
  const f=await fixture(t);await f.configure();
  const script=`import {openStore} from ${JSON.stringify(new URL('../app/server/store.mjs',import.meta.url).href)};
    import {entity} from ${JSON.stringify(new URL('../app/server/domain.mjs',import.meta.url).href)};
    import {reserveBudget} from ${JSON.stringify(new URL('../app/budgets/index.mjs',import.meta.url).href)};
    const s=await openStore(process.argv[1]);try{await s.transaction(state=>{const r=entity({attemptId:crypto.randomUUID(),botId:process.argv[3],providerInstanceId:'fixture-provider',selection:{model:'fixture-observed-model'},status:'running'},process.argv[2]);state.runs.push(r);reserveBudget(state,{run:r});});process.stdout.write('admitted');}catch(e){process.stdout.write(e.code);}finally{await s.close();}`;
  const child=()=>promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dir,f.projectId,f.botId],{timeout:10000});
  const rs=await Promise.all([child(),child()]);assert.deepEqual(rs.map(r=>r.stdout).sort(),['BUDGET_HELD','admitted']);assert.equal(f.store.read().runs.length,1);
});

test('immutable cumulative receipts dedupe concurrent duplicates and reject altered IDs or sequences',async t=>{
  const f=await fixture(t);await f.configure();const r=await f.start(),o=f.observation(r);
  const results=await Promise.all([f.service.observe(o),f.service.observe(o),f.service.observe(o)]);assert.equal(new Set(results.map(r=>r.id)).size,1);
  let s=await f.state();assert.equal(s.observations.length,1);assert.equal(s.policies[0].exposure.knownSpend.minorUnits,30);assert.equal(s.policies[0].exposure.held.minorUnits,30);assert.equal(s.policies[0].exposure.exposure.minorUnits,60);
  await assert.rejects(f.service.observe({...o,cost:usd(40)}),code('BUDGET_RECEIPT_REUSE'));
  await assert.rejects(f.service.observe({...o,sourceReceiptId:'another-id'}),code('BUDGET_SEQUENCE_REUSE'));
  await f.service.observe({...o,sourceReceiptId:'later-cumulative',sequence:3,cost:usd(40),usage:{totalTokens:12}});
  await f.service.observe({...o,sourceReceiptId:'late-old-snapshot',sequence:2,cost:usd(35),usage:{totalTokens:11}});
  s=await f.state();assert.equal(s.policies[0].exposure.knownSpend.minorUnits,40);assert.equal(s.policies[0].exposure.knownTokens,12);assert.equal(s.observations.at(-1).stale,true);
  await assert.rejects(f.service.observe({...o,sourceReceiptId:'regress',sequence:4,cost:usd(39)}),code('BUDGET_REGRESSION'));
  await assert.rejects(f.service.observe({...o,sourceReceiptId:'source-switch',sequence:4,source:'different'}),code('BUDGET_SOURCE'));
});

test('scope/model/attempt/provider/receipt identity cannot be borrowed by another run',async t=>{
  const f=await fixture(t),r=await f.start(),o=f.observation(r);
  for(const patch of [{botId:null},{attemptId:'foreign'},{providerInstanceId:'other'},{model:'other'}])await assert.rejects(f.service.observe({...o,...patch}),code('BUDGET_OWNERSHIP'));
  await assert.rejects(f.service.observe({...o,projectId:f.store.read().projects[1].id}),code('NOT_FOUND'));
  await f.service.observe(o);const r2=await f.start();await assert.rejects(f.service.observe({...f.observation(r2),sourceReceiptId:o.sourceReceiptId}),code('BUDGET_RECEIPT_REUSE'));
});

test('unknown policy blocks existing unpriced work, final unknown remains held until explicit late accounting',async t=>{
  const f=await fixture(t);await f.configure({unknown:'block',reserve:usd(10)});const r=await f.start();
  await assert.rejects(f.start(),code('BUDGET_UNKNOWN'));
  await f.service.observe(f.observation(r,{cost:null,usage:null,final:true}));await f.finish(r);await f.reopen();await f.service.reconcile();
  assert.equal((await f.state()).attempts[0].held,true);await assert.rejects(f.start(),code('BUDGET_UNKNOWN'));
  await f.service.observe(f.observation(r,{sequence:2,sourceReceiptId:'late-trusted-bill',cost:usd(20),final:true}));
  assert.equal((await f.state()).attempts[0].held,false);await f.start();
});

test('reported subtotal survives later unknown cost; missing usage is not zero tokens',async t=>{
  const f=await fixture(t);await f.configure({reserve:usd(10)});const r=await f.start();
  await f.service.observe(f.observation(r,{cost:usd(5),usage:null}));await f.service.observe(f.observation(r,{sequence:2,cost:null,usage:null,final:true}));await f.finish(r);
  const s=await f.state();assert.deepEqual(s.attempts[0].cost,usd(5));assert.equal(s.attempts[0].usage,null);assert.equal(s.attempts[0].pricingStatus,'unknown');assert.equal(s.attempts[0].held,true);assert.equal(s.policies[0].exposure.knownSpend.minorUnits,5);
});

test('only terminal AND trusted final reported accounting releases; status alone never proves absence',async t=>{
  const f=await fixture(t),r=await f.start();await f.service.observe(f.observation(r,{final:true}));assert.equal((await f.state()).attempts[0].held,true);
  await f.finish(r);assert.equal((await f.state()).attempts[0].held,false);
  const second=await f.start();await f.finish(second,'failed');assert.equal((await f.state()).attempts[1].held,true);
  await f.service.confirmNotDispatched({projectId:f.projectId,runId:second.id,attemptId:second.attemptId,sourceReceiptId:'dispatch-owner-proof-before-launch'});assert.equal((await f.state()).attempts[1].held,false);
  await assert.rejects(f.service.confirmNotDispatched({projectId:f.projectId,runId:r.id,attemptId:r.attemptId,sourceReceiptId:'fake-absence'}),code('BUDGET_RECONCILE'));
});

test('policy revisions/disable fence pending dispatch and retain old spend and holds',async t=>{
  const f=await fixture(t);let p=await f.configure();const r=await f.start();
  const input={operationId:'owner-edit',projectId:f.projectId,botId:null,expectedRevision:p.policyRevision,enabled:false,unknown:'allow',period:'lifetime',limit:usd(200),reserve:usd(10)};
  p=await f.service.configure(input,f.owner);assert.equal((await f.service.configure(input,f.owner)).id,p.id);
  await assert.rejects(f.service.configure({...input,enabled:true},f.owner),code('OPERATION_REUSE'));
  assert.throws(()=>validateBudgetAdmission(f.store.read(),{run:r}),code('BUDGET_POLICY_CHANGED'));
  assert.equal((await f.state()).attempts[0].held,true);await f.start();
  await assert.rejects(f.service.configure({...input,operationId:'stale-editor'},f.owner),code('REVISION_CONFLICT'));
});

test('project and bot policies both apply without double charging cumulative spend',async t=>{
  const f=await fixture(t);await f.configure({reserve:usd(20),limit:usd(200)});await f.configure({botId:f.botId,reserve:usd(60),limit:usd(100)});
  const r=await f.start();await assert.rejects(f.start(),code('BUDGET_HELD'));
  await f.service.observe(f.observation(r,{cost:usd(10)}));const s=await f.state();assert.deepEqual(s.policies.filter(p=>p.enabled).map(p=>p.exposure.knownSpend.minorUnits),[10,10]);
  await f.start({botId:f.store.read().bots[1].id});
});

test('currency mismatch blocks; different exact scales compare without floating rounding',async t=>{
  const f=await fixture(t);await f.configure({limit:usd(1,0),reserve:usd(1,1)});const r=await f.start();
  await f.service.observe(f.observation(r,{cost:{minorUnits:15,scale:2,currency:'THB'}}));
  assert.equal(f.stops.length,1);await assert.rejects(f.start(),code('BUDGET_CURRENCY'));assert.equal((await f.state()).policies[0].exposure.currencyMismatch.length,1);
  const g=await fixture(t);await g.configure({limit:usd(1,0),reserve:usd(6,1)});const rr=await g.start();await g.service.observe(g.observation(rr,{cost:usd(21,2)}));const e=(await g.state()).policies[0].exposure;assert.deepEqual(e.exposure,usd(60));assert.deepEqual(e.held,usd(39));
});

test('Stop at known threshold targets exact attempt once, retains uncertainty across restart and late observations',async t=>{
  const f=await fixture(t);f.control.stopUnknown=true;await f.configure({reserve:usd(10)});const r=await f.start(),other=await f.start();
  await f.service.observe(f.observation(r,{cost:usd(100)}));assert.deepEqual(f.stops.sort(),[r.id,other.id].sort());
  await f.service.reconcile();await f.reopen();await f.service.reconcile();assert.equal(f.stops.length,2);
  const s=await f.state();assert.equal(s.stops.every(s=>s.status==='unknown'),true);assert.equal(s.attempts.every(a=>a.held),true);assert.equal(f.store.read().runs.length,2);
});

test('monthly reset carries unresolved holds; late cumulative receipts stay in attempt admission period',async t=>{
  const f=await fixture(t);await f.configure({period:'month',reserve:usd(60)});
  const lastMonth=Date.UTC(2026,9,31,23,59),now=Date.UTC(2026,10,1),r=await f.start({},lastMonth);
  await assert.rejects(f.start({},now),code('BUDGET_HELD'));
  await f.service.observe(f.observation(r,{cost:usd(20),final:true}));await f.finish(r);
  const next=await f.start({},now);assert.equal(validateBudgetAdmission(f.store.read(),{run:next,now}),true);
});

test('restoring older metadata preserves acknowledged ledger/Stop tombstones and prevents stale dispatch grants',async t=>{
  const f=await fixture(t);f.control.stopUnknown=true;await f.configure({reserve:usd(10)});const backup=f.store.read(),r=await f.start();
  const o=f.observation(r,{cost:usd(100)});await f.service.observe(o);
  await f.store.transaction(s=>Object.assign(s,mergeBudgetSafety(structuredClone(backup),s)));await f.reopen();await f.service.reconcile();
  let s=await f.state();assert.equal(s.observations.length,1);assert.equal(s.stops.length,1);assert.equal(f.stops.length,1);assert.equal(s.attempts[0].held,true);assert.equal(f.store.read().runs[0].id,r.id);
  assert.throws(()=>validateBudgetAdmission(f.store.read(),{run:r}),code('BUDGET_RESERVATION'));
  await f.service.observe(o);assert.equal((await f.state()).attempts[0].held,true);
  await f.finish(r);assert.equal((await f.state()).attempts[0].held,true,'restore requires fresh native accounting');
  await f.service.observe(f.observation(r,{sequence:2,cost:usd(100),final:true}));s=await f.state();assert.equal(s.attempts[0].held,false);assert.equal(f.stops.length,1);
});

test('untracked legacy runs remain unknown and cannot bypass a new unknown-block policy',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>s.runs.push(entity({botId:f.botId,status:'completed',reportedCost:{amount:0.5,currency:'USD',source:'legacy-reported'}},f.projectId)));
  await f.configure({unknown:'block'});await assert.rejects(f.start(),code('BUDGET_UNKNOWN'));const s=await f.state();assert.equal(s.untrackedRuns.length,1);assert.equal(s.untrackedRuns[0].cost,null);
});

test('trusted historical observations reconcile real cost without retrospectively authorizing dispatch',async t=>{
  const f=await fixture(t);let run;await f.store.transaction(s=>{run=entity({botId:f.botId,attemptId:'old-attempt',providerInstanceId:'fixture-provider',selection:{model:'fixture-observed-model'},status:'completed'},f.projectId);s.runs.push(run);});
  await f.configure({unknown:'block'});await assert.rejects(f.start(),code('BUDGET_UNKNOWN'));
  await f.service.observe(f.observation(run,{cost:usd(20),final:true}));const s=await f.state();assert.equal(s.untrackedRuns.length,0);assert.equal(s.attempts[0].accountingOnly,true);assert.equal(s.attempts[0].held,false);
  assert.throws(()=>validateBudgetAdmission(f.store.read(),{run}),code('BUDGET_RESERVATION'));await f.start();
});

test('lowering policy threshold stops an owned attempt once and never stops a changed foreign attempt',async t=>{
  const f=await fixture(t);await f.configure({limit:usd(200),reserve:usd(10)});const r=await f.start();await f.service.observe(f.observation(r,{cost:usd(120)}));assert.equal(f.stops.length,0);
  await f.configure({limit:usd(100),reserve:usd(10)});assert.deepEqual(f.stops,[r.id]);await f.service.reconcile();assert.equal(f.stops.length,1);
  const g=await fixture(t);await g.configure({limit:usd(200),reserve:usd(10)});const other=await g.start();await g.service.observe(g.observation(other,{cost:usd(120)}));
  await g.store.transaction(s=>{s.runs[0].attemptId='different-native-attempt';});await g.configure({limit:usd(100),reserve:usd(10)});assert.equal(g.stops.length,0);assert.equal((await g.state()).attempts[0].held,true);
});

test('schema rejects monetary floats, deltas, implicit finality, unsafe integers and source estimates',async t=>{
  const f=await fixture(t),r=await f.start(),o=f.observation(r);
  for(const patch of [{cost:{amount:0.1,currency:'USD'}},{cost:usd(0.1)},{cost:usd(Number.MAX_SAFE_INTEGER+1)},{cost:usd(1,10)},{cost:{...usd(1),currency:'usd'}},{delta:true},{final:undefined},{usage:{totalTokens:-1}},{sourceReceiptId:' invalid '}])await assert.rejects(f.service.observe({...o,...patch}),code('VALIDATION'));
  assert.equal((await f.state()).observations.length,0);
});

test('a second metadata restore requires fresh native accounting again while preserving every source receipt',async t=>{
  const f=await fixture(t),r=await f.start(),base=f.store.read();await f.finish(r,'unknown');
  await f.store.transaction(s=>Object.assign(s,mergeBudgetSafety(structuredClone(base),s)));
  const first=f.observation(r,{final:true,cost:usd(20)});await f.service.observe(first);assert.equal((await f.state()).attempts[0].held,true);
  await f.store.transaction(s=>Object.assign(s,mergeBudgetSafety(structuredClone(base),s)));await f.finish(r);
  await f.service.observe(first);assert.equal((await f.state()).attempts[0].held,true,'a prior restore reconciliation is not proof after another restore');
  await f.service.observe(f.observation(r,{sequence:2,final:true,cost:usd(20)}));assert.equal((await f.state()).attempts[0].held,false);assert.equal((await f.state()).observations.length,2);
});

test('legacy decimal boundary uses only explicit reported data, never prices/subscriptions/token conversion',()=>{
  const c={amount:0.1,currency:'USD',source:'injected-native'};assert.deepEqual(legacyCostToMoney(c),usd(1,1));assert.deepEqual(legacyCostToMoney({...c,amount:'0.0100'}),usd(1,2));
  for(const patch of [{basis:'estimated'},{basis:'subscription'},{source:''},{currency:'usd'},{amount:NaN},{amount:-1},{amount:0.0000000001},{amount:9007199254740992},{amount:0.1+0.2}])assert.equal(legacyCostToMoney({...c,...patch}),null);
  const r={id:'run',projectId:'project',botId:null,attemptId:'attempt',providerInstanceId:'provider',selection:{model:'model'},status:'completed',reportedUsage:{totalTokens:5,source:'injected-native'}};
  assert.equal(legacyObservation(r,{source:'native',sourceReceiptId:'immutable',sequence:1,final:false}).cost,null);assert.equal(legacyObservation(r,{source:'native',sourceReceiptId:'immutable',sequence:1,final:false}).final,false);
});
