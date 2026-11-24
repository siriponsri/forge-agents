import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {createContextService} from '../app/context/index.mjs';
import {createT3ContextSeam} from '../app/context/pre-dispatch.mjs';
import {hash} from '../app/context/contracts.mjs';
import {fixture as assistanceFixture,provenance} from './assistance-fixture.test.mjs';

const route={providerId:'fixture-provider',modelId:'fixture-model'},source={kind:'fixture',reference:'local follow-up integration; no live provider',observedAt:'2026-11-24T00:00:00Z'},caller={};
const scope={projectId:'p',kind:'project',id:'p'},caps={contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source};
const cmd=(extra={})=>({projectId:'p',operationId:crypto.randomUUID(),...extra});
const scopes=['project','task','agent','session'].map(kind=>({projectId:'p',kind,id:kind==='project'?'p':`${kind}-1`}));
const reject=code=>e=>e.code===code;
async function fixture(t,options={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-context-followup-'));let store=await openStore(dir),service;
  await store.transaction(s=>{s.projects.push({id:'p',revision:1,profile:{provider:{instanceId:route.providerId,model:route.modelId,options:[{id:'effort',value:'low'}]}}});s.tasks.push({id:'task',projectId:'p',planId:'plan',revision:1,title:'Preserve Owner acceptance',status:'ready'});s.plans.push({id:'plan',projectId:'p',revision:1,approved:true,name:'Bounded plan'});s.runs.push({id:'run',projectId:'p',taskId:'task',revision:1});});
  const create=()=>createContextService({store,dataDir:dir,authorize:({callerContext})=>callerContext===caller,capabilities:async()=>caps,...options});
  service=await create();t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,get store(){return store;},get service(){return service;},policy:(budget={},extra={})=>service.policy(cmd({route,budget:{contextWindow:20000,outputReserve:500,safetyReserve:100,...budget},source,...extra}),caller),
    prepare:(extra={},trustedOptions)=>service.preDispatch(cmd({taskId:'task',runId:'run',route,baseMessage:'Current Owner: no public service; keep all approval constraints.',...extra}),caller,trustedOptions),
    async restart(){await store.close();store=await openStore(dir);service=await create();},
  };
}

test('confirmed Assistance Executor/Asst route switching uses durable exact options without changing project profile',async t=>{
  const h=await assistanceFixture(t),bound={},context=await createContextService({store:h.store,dataDir:h.dir,authorize:({callerContext})=>callerContext===bound,capabilities:async()=>caps});
  for(const selected of [{providerId:h.c1.providerInstanceId,modelId:'fixture-economy'},{providerId:h.c2.providerInstanceId,modelId:'fixture-assistant'}])await context.policy({projectId:h.p.id,operationId:crypto.randomUUID(),route:selected,budget:{contextWindow:20000,outputReserve:500,safetyReserve:100},source},bound);
  const prepare=createT3ContextSeam({service:context,callerContextForRun:async()=>bound}),prepared=[];
  h.control.afterStart=async run=>{prepared.push(await prepare({run,project:h.store.read().projects[0],baseMessage:`Owner-approved ${run.assistanceContext.role} attempt; no extra approval.`}));};
  let loop=await h.loop();loop=await h.advance(loop);loop=await h.complete(loop);loop=await h.transition(loop,{action:'escalate',trigger:'stuck',reason:'Verified blocked Executor',provenance});loop=await h.advance(loop);
  assert.deepEqual(prepared.map(r=>r.route),[{providerId:h.c1.providerInstanceId,modelId:'fixture-economy'},{providerId:h.c2.providerInstanceId,modelId:'fixture-assistant'}]);
  assert.deepEqual(prepared[0].selection.options,[{id:'effort',value:'high'}]);assert.deepEqual(prepared[1].selection.options,[{id:'thinking',value:true}]);
  const snapshot=h.store.read();assert.equal(snapshot.projects[0].profile.provider.model,'unchanged');
  for(const r of prepared)assert.deepEqual(snapshot.events.find(e=>e.id===r.id).selection,snapshot.runs.find(run=>run.id===r.runId).selection);
  const current=snapshot.runs.at(-1),forged=structuredClone(current);forged.selection.options=[{id:'thinking',value:false}];
  await assert.rejects(prepare({run:forged,project:snapshot.projects[0],baseMessage:'same work'}),reject('CONTEXT_SELECTION_MISMATCH'));
  await h.store.transaction(s=>s.runs.at(-1).providerInstanceId='wrong-provider');
  await assert.rejects(prepare({run:current,project:snapshot.projects[0],baseMessage:'same work'}),reject('CONTEXT_SELECTION_MISMATCH'));
});

test('ordinary selected options and provided Assistance snapshots cannot drift from durable admission',async t=>{
  const f=await fixture(t);await f.policy();const selection=structuredClone(f.store.read().projects[0].profile.provider);
  await f.store.transaction(s=>{s.runs[0].selection=selection;s.runs[0].providerInstanceId=selection.instanceId;});
  await assert.rejects(f.prepare({selection:{...selection,options:[{id:'effort',value:'high'}]}}),reject('CONTEXT_SELECTION_MISMATCH'));
  await assert.rejects(f.prepare({assistanceContext:{version:1,role:'asst',selection}}),reject('CONTEXT_SELECTION_MISMATCH'));
  await f.store.transaction(s=>s.projects[0].profile.provider.options=[{id:'effort',value:'high'}]);
  await assert.rejects(f.prepare(),reject('CONTEXT_ROUTE_STALE'));
});

test('classified object errors retain public code/message, redact credentials and omit private diagnostics',async t=>{
  const f=await fixture(t);await f.policy();await f.store.transaction(s=>s.runs[0].error={code:'PROVIDER_REJECTED',message:'Approval rejected; password=secret-value',retryable:false,statusCode:409,stack:'PRIVATE_STACK',details:{nativeDump:'PRIVATE_DIAGNOSTIC'}});
  const r=await f.prepare();assert.match(r.message,/PROVIDER_REJECTED/);assert.match(r.message,/Approval rejected/);assert.ok(!r.message.includes('secret-value'));assert.ok(!r.message.includes('PRIVATE_'));assert.ok(!r.message.includes('[object Object]'));
  assert.equal(r.pressure,'within-budget');
});

test('multi-scope memory groups preserve exact original scopes with collision-safe IDs and no plaintext cache',async t=>{
  const records=scopes.map((scope,i)=>({id:'same-memory-id',scope,revision:1,content:`UNIQUE_SCOPE_CONTENT_${i}`,sourceRefs:[],verification:{status:'unverified'}}));
  const current=()=>records.map(r=>({...r,sha256:hash(r.content)})),calls=[];
  const f=await fixture(t,{memoryContext:async({scope:s})=>({items:current().filter(r=>hash(r.scope)===hash(s))}),memoryResolveRefs:async input=>{calls.push(input);return {items:current()};}});await f.policy();
  const r=await f.service.compose(cmd({route,items:[],memory:scopes.map(scope=>({scope,query:'fixture'}))}),caller);
  assert.equal(r.memoryAvailable,4);assert.equal(r.memoryGroups.length,4);assert.deepEqual(r.memoryRefs,[]);assert.equal(new Set(f.store.read().events.find(e=>e.id===r.id).active.map(i=>i.id)).size,4);
  const event=f.store.read().events.find(e=>e.id===r.id);assert.equal(event.memoryRequest,undefined);assert.equal(event.memoryRefs,undefined);assert.ok(!JSON.stringify(f.store.read()).includes('UNIQUE_SCOPE_CONTENT_'));
  for(const group of event.memoryGroups){assert.equal(group.refs.length,1);assert.ok(calls.some(c=>hash(c.scope)===hash(group.request.scope)));}
  // Forged resolver returns every record: IDs alone still cannot cross scopes.
  records.splice(1,1);records[1].revision++;records[2].scope={projectId:'p',kind:'session',id:'moved-session'};
  await f.restart();const resolved=await f.service.resolve({projectId:'p',contextId:r.id},caller);assert.equal(resolved.memoryAvailable,1);assert.match(resolved.message,/UNIQUE_SCOPE_CONTENT_0/);assert.ok(!resolved.message.includes('UNIQUE_SCOPE_CONTENT_1'));assert.ok(!resolved.message.includes('UNIQUE_SCOPE_CONTENT_2'));assert.ok(!resolved.message.includes('UNIQUE_SCOPE_CONTENT_3'));
  const compacted=await f.service.compact(cmd({contextId:r.id}),caller);assert.equal(compacted.memoryGroups.length,4);assert.equal(compacted.memoryAvailable,1);
  // Even an identical ID, revision and content hash in a different scope cannot
  // satisfy the original scope's ref; deduplicate only within that exact group.
  records.splice(0,records.length,...scopes.slice(0,2).map(scope=>({id:'collision',revision:1,scope,content:'IDENTICAL_CROSS_SCOPE_CONTENT',sourceRefs:[]})));
  const collision=await f.service.compose(cmd({route,items:[],memory:scopes.slice(0,2).map(scope=>({scope}))}),caller);assert.equal(collision.memoryAvailable,2);
  records[1].scope=scopes[0];const moved=await f.service.resolve({projectId:'p',contextId:collision.id},caller);assert.equal(moved.memoryAvailable,1);assert.equal(moved.memoryGroups.length,2);
});

test('shared memories resolve in granted source scope; sharing never silently grants source authority',async t=>{
  const original={projectId:'p',kind:'owner',id:'owner-p'},record={id:'shared',revision:1,scope:original,content:'SHARED_MEMORY_SOURCE_SCOPE',sourceRefs:[]};record.sha256=hash(record.content);
  let sourceGrant=true;const calls=[],f=await fixture(t,{authorize:({callerContext,scope:s})=>callerContext===caller&&(s.kind!=='owner'||sourceGrant),memoryContext:async()=>({items:[record]}),memoryResolveRefs:async input=>{calls.push(input.scope);return {items:hash(input.scope)===hash(original)?[record]:[]};}});await f.policy();
  const r=await f.service.compose(cmd({route,items:[],memory:{scope}}),caller);assert.equal(r.memoryAvailable,1);assert.ok(r.memoryGroups.some(g=>hash(g.request.scope)===hash(original)&&g.refs[0].id==='shared'));
  assert.ok(calls.every(s=>hash(s)===hash(original)));sourceGrant=false;
  await assert.rejects(f.service.resolve({projectId:'p',contextId:r.id},caller),reject('CONTEXT_FORBIDDEN'));
  await assert.rejects(f.service.compose(cmd({route,items:[],memory:{scope}}),caller),reject('CONTEXT_FORBIDDEN'));
});

test('single-scope legacy versions still resolve and compact without migrating or caching memory text',async t=>{
  const item={id:'legacy',revision:1,scope,content:'LEGACY_MEMORY_CONTENT',sourceRefs:[]};item.sha256=hash(item.content);
  const f=await fixture(t,{memoryContext:async()=>({items:[item]}),memoryResolveRefs:async()=>({items:[item]})});await f.policy();const r=await f.service.compose(cmd({route,items:[],memory:{scope}}),caller);
  await f.store.transaction(s=>{const e=s.events.find(e=>e.id===r.id);e.memoryRequest=e.memoryGroups[0].request;e.memoryRefs=e.memoryGroups[0].refs;delete e.memoryGroups;e.active[0].id='memory:legacy';});
  assert.equal((await f.service.resolve({projectId:'p',contextId:r.id},caller)).memoryAvailable,1);
  const compacted=await f.service.compact(cmd({contextId:r.id}),caller);assert.equal(compacted.memoryAvailable,1);assert.equal(compacted.memoryGroups.length,1);assert.ok(!JSON.stringify(f.store.read()).includes('LEGACY_MEMORY_CONTENT'));
});

test('no-policy native passthrough is trusted opt-in, durable metadata only, with no memory or fabricated budget',async t=>{
  let recalled=0;const f=await fixture(t,{capabilities:async()=>({...caps,acceptsForgePrefix:false}),memoryContext:async()=>{recalled++;return {items:[]};},memoryResolveRefs:async()=>({items:[]})});
  const project=f.store.read().projects[0],run=f.store.read().runs[0],baseMessage='NATIVE_ORIGINAL Owner requires exact approvals ไทย';
  const prepare=createT3ContextSeam({service:f.service,callerContextForRun:async()=>caller,memoryForRun:async()=>scopes.map(scope=>({scope})),allowNativePassthrough:true});
  const r=await prepare({run,project,baseMessage});assert.equal(r.message,baseMessage);assert.equal(r.mode,'native-managed');assert.equal(r.reason,'NO_FORGE_CONTEXT_POLICY');assert.equal(r.passthrough,true);assert.equal(r.budget,null);assert.equal(r.budgetGuarantee,false);assert.equal(r.compacted,false);assert.equal(r.accounting.status,'unknown');assert.equal(r.accounting.tokens,null);assert.equal(r.accounting.bytes,Buffer.byteLength(baseMessage));assert.equal(r.memoryStatus,'not-appended-without-forge-policy');assert.equal(recalled,0);
  assert.equal((await prepare({run,project,baseMessage})).id,r.id);assert.ok(!JSON.stringify(f.store.read()).includes('NATIVE_ORIGINAL'));
  assert.equal((await f.service.status({projectId:'p'},caller)).passthroughs.length,1);
  await f.restart();const metadata=await f.service.resolve({projectId:'p',contextId:r.id},caller);assert.equal(metadata.message,null);assert.equal(metadata.receipt.type,'context.passthrough');assert.equal(metadata.mode,'native-managed');
  await assert.rejects(f.service.compact(cmd({contextId:r.id}),caller),reject('CONTEXT_NATIVE_MANAGED'));assert.equal((await f.service.usage({projectId:'p',contextId:r.id},caller)).accounting.status,'unknown');
});

test('no-policy mode cannot be requested by body or used for forge-owned contexts and configured failures',async t=>{
  const f=await fixture(t);await assert.rejects(f.prepare({allowNativePassthrough:true}),reject('CONTEXT_POLICY_REQUIRED'));
  const forge=await fixture(t,{capabilities:async()=>({...caps,contextOwner:'forge'})});await assert.rejects(forge.prepare({},{allowNativePassthrough:true}),reject('CONTEXT_POLICY_REQUIRED'));
  await f.policy({maxInputTokens:100});await assert.rejects(f.prepare({},{allowNativePassthrough:true}),reject('CONTEXT_CRITICAL_OVERFLOW'));
  assert.equal(f.store.read().events.filter(e=>e.type==='context.passthrough').length,0);
  const unknown=await fixture(t,{tokenizer:async()=>null});await unknown.policy();await assert.rejects(unknown.prepare({},{allowNativePassthrough:true}),reject('CONTEXT_ACCOUNTING_UNKNOWN'));
});

test('native passthrough replay rejects changed policy, selection, approval and forged callers',async t=>{
  const f=await fixture(t),input=cmd({taskId:'task',runId:'run',route,baseMessage:'Native critical Owner constraints'});
  await f.service.preDispatch(input,caller,{allowNativePassthrough:true});
  await assert.rejects(f.service.preDispatch(input,{}, {allowNativePassthrough:true}),reject('CONTEXT_FORBIDDEN'));
  await f.policy();await assert.rejects(f.service.preDispatch(input,caller,{allowNativePassthrough:true}),reject('CONTEXT_STATE_CHANGED'));
  await f.store.transaction(s=>s.plans[0].approved=false);await assert.rejects(f.service.preDispatch(input,caller,{allowNativePassthrough:true}),reject('CONTEXT_PLAN_REQUIRED'));
});
