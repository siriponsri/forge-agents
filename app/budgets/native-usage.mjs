import {binding, owned, digest, exact, text, integer, fail} from './contracts.mjs';

// Source semantics, not an executable attestation. See docs/worker-native-usage.md.
export const NATIVE_USAGE_SOURCE='t3.native.turn-usage/1';
export const NATIVE_USAGE_REVISION='59651c1761f6c63e9b6056839067066968e6a406';
const RECEIPT_TYPE='budget.native-usage';
const BILLING_GAP='No immutable per-attempt billing receipt in the pinned native projection; monetary cost and billing finality remain unknown.';
const DONE=new Set(['completed','failed','interrupted','cancelled','superseded']);
const reject=(code,message)=>fail(`NATIVE_USAGE_${code}`,message,409);
const object=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
const requireThat=(ok,code,message)=>{if(!ok)reject(code,message);};
const count=v=>Number.isSafeInteger(v)&&v>=0;
function add(a,b){const n=a+b;requireThat(count(n),'OVERFLOW','Measured tokens exceed safe integer storage');return n;}
function indexed(rows,label){
  requireThat(Array.isArray(rows)&&rows.length<=100000,'PROJECTION',`Full native ${label} array required`);
  const result=new Map();
  for(const row of rows){requireThat(object(row),'PROJECTION',`Malformed ${label} row`);text(row.id,`${label} id`);requireThat(!result.has(row.id),'DUPLICATE',`Duplicate ${label} id`);result.set(row.id,row);}
  return result;
}
function sourceIdentity(state,runId){
  const run=state.runs.find(r=>r.id===runId);requireThat(run,'IDENTITY','Canonical run is missing');
  const b=binding(run);owned(state,b);
  return {binding:b,threadId:text(run.threadId,'threadId'),providerRunId:text(run.providerRunId,'providerRunId'),t3ProjectId:text(run.t3ProjectId,'t3ProjectId')};
}
function ref(value,label){
  requireThat(object(value)&&typeof value.driver==='string'&&value.driver.length>0&&value.strength==='strong','SESSION',`Strong ${label} required`);
  return {driver:value.driver,nativeId:text(value.nativeId,label)};
}
function normalizeUsage(u,model,turnModel){
  if(u===undefined){requireThat(turnModel===model,'MODEL','Missing exact executed turn model');return null;}
  exact(u,['usageScope','usageStatus','inputTokens','outputTokens','cachedInputTokens','cacheCreationTokens','reasoningTokens','hasSubagents','models','localCommand','otherUsage'],'turnTokenUsage');
  requireThat(u.usageScope==='main_agent'&&['complete','partial','unavailable'].includes(u.usageStatus)&&typeof u.hasSubagents==='boolean','COUNTERS','Malformed native usage scope or status');
  requireThat(u.localCommand===undefined||typeof u.localCommand==='boolean','COUNTERS','Malformed local-command flag');
  if(u.models!==undefined)requireThat(Array.isArray(u.models)&&u.models.length>0&&u.models.every(m=>m===model),'MODEL','Native main-agent model set differs from the canonical model');
  if(turnModel!==undefined)requireThat(turnModel===model,'MODEL','Native executed turn model differs from the canonical model');
  requireThat(turnModel===model||u.models?.includes(model),'MODEL','Native executed main-agent model is unknown');
  const out={usageScope:u.usageScope,usageStatus:u.usageStatus,hasSubagents:u.hasSubagents};
  for(const key of ['inputTokens','outputTokens','cachedInputTokens','cacheCreationTokens','reasoningTokens']){
    if(u[key]!==undefined){requireThat(count(u[key]),'COUNTERS',`Invalid native ${key}`);out[key]=u[key];}
  }
  if(u.usageStatus==='complete')requireThat(count(u.inputTokens)&&count(u.outputTokens),'COUNTERS','Complete usage requires both measured counts');
  for(const key of ['cachedInputTokens','cacheCreationTokens'])if(u[key]!==undefined&&u.inputTokens!==undefined)requireThat(u[key]<=u.inputTokens,'COUNTERS','Cache subset exceeds input');
  if(u.reasoningTokens!==undefined&&u.outputTokens!==undefined)requireThat(u.reasoningTokens<=u.outputTokens,'COUNTERS','Reasoning subset exceeds output');
  if(u.models!==undefined)out.models=[model];
  if(u.localCommand!==undefined)out.localCommand=u.localCommand;
  if(u.otherUsage!==undefined){exact(u.otherUsage,['inputTokens','outputTokens'],'otherUsage');requireThat(count(u.otherUsage.inputTokens)&&count(u.otherUsage.outputTokens),'COUNTERS','Invalid other-usage counts');out.otherUsage={...u.otherUsage};}
  return out;
}

function select(state,{runId,projection:p}){
  const identity=sourceIdentity(state,runId),b=identity.binding;
  requireThat(object(p)&&!p.hasMoreHistory&&!p.historyCursor,'PROJECTION','An unbounded native projection is required');
  requireThat(p.thread?.id===identity.threadId&&p.thread.projectId===identity.t3ProjectId,'IDENTITY','Native projection belongs to another thread or project');
  const runs=indexed(p.runs,'runs'),attempts=indexed(p.attempts,'attempts'),threads=indexed(p.providerThreads,'providerThreads'),turns=indexed(p.providerTurns,'providerTurns');
  const native=runs.get(identity.providerRunId);
  requireThat(native?.threadId===identity.threadId&&native.providerInstanceId===b.providerInstanceId,'IDENTITY','Exact native run and provider are required');
  requireThat(native.modelSelection?.instanceId===b.providerInstanceId&&native.modelSelection.model===b.model,'MODEL','Native run model selection differs from canonical binding');
  const selected=[...attempts.values()].filter(a=>a.runId===native.id).sort((a,b)=>a.attemptOrdinal-b.attemptOrdinal);
  requireThat(selected.length>0,'COVERAGE','No exact native attempts');
  if(native.activeAttemptId!==null)requireThat(selected.some(a=>a.id===native.activeAttemptId),'COVERAGE','Active attempt is absent');
  const attemptIds=new Set(selected.map(a=>a.id)),roots=new Set(selected.map(a=>a.rootNodeId)),nativeKeys=new Set(),ordinals=new Set(),turnsByAttempt=new Map(),sourceRows=new Map();
  // Unattributed turns in a selected attempt's root cannot be safely ignored.
  const sourceKey=t=>digest([t.providerThreadId??null,t.nativeThreadRef?.nativeId??threads.get(t.providerThreadId)?.nativeThreadRef?.nativeId??null,t.nativeTurnRef?.nativeId??null]);
  for(const t of turns.values()){
    if(roots.has(t.nodeId))requireThat(attemptIds.has(t.runAttemptId),'COVERAGE','Unattributed or foreign turn on selected root');
    if(!turnsByAttempt.has(t.runAttemptId))turnsByAttempt.set(t.runAttemptId,[]);turnsByAttempt.get(t.runAttemptId).push(t);
    const key=sourceKey(t);sourceRows.set(key,(sourceRows.get(key)??0)+1);
  }
  let known=0,hasKnown=false,input=0,output=0,allInput=true,allOutput=true,qualified=true,completeMain=true;
  const limitations=new Set([BILLING_GAP]),normalized=[];
  for(let n=0;n<selected.length;n++){
    const a=selected[n];
    requireThat(a.attemptOrdinal===n+1,'COVERAGE','Native attempt ordinal coverage is incomplete');
    requireThat(a.providerInstanceId===b.providerInstanceId,'IDENTITY','Attempt provider differs');
    requireThat(['pending','running',...DONE].includes(a.status),'PROJECTION','Invalid attempt status');
    text(a.rootNodeId,'rootNodeId');
    const pt=threads.get(a.providerThreadId);
    requireThat(pt?.appThreadId===identity.threadId&&pt.providerInstanceId===b.providerInstanceId,'SESSION','Attempt provider thread differs');
    // A provider session row is mutable and reusable. Historical destination is
    // bound by the native turn reference + attempt.nativeThreadId when present.
    const currentRef=pt.nativeThreadRef==null?null:ref(pt.nativeThreadRef,'provider native thread');
    const at=(turnsByAttempt.get(a.id)??[]).sort((a,b)=>a.ordinal-b.ordinal);
    if(a.providerTurnId!==null)requireThat(at.some(t=>t.id===a.providerTurnId),'COVERAGE','Attempt provider turn is absent');
    if(!at.length){qualified=false;completeMain=false;allInput=false;allOutput=false;limitations.add('An exact native attempt has no measured turns.');}
    if(!DONE.has(a.status))qualified=false;
    const normalizedTurns=[];
    for(let i=0;i<at.length;i++){
      const t=at[i];
      requireThat(t.providerThreadId===a.providerThreadId&&t.nodeId===a.rootNodeId,'SESSION','Turn belongs to another provider thread or node');
      requireThat(Number.isSafeInteger(t.ordinal)&&t.ordinal>0&&!ordinals.has(`${t.providerThreadId}:${t.ordinal}`),'DUPLICATE','Repeated or malformed provider-turn ordinal');ordinals.add(`${t.providerThreadId}:${t.ordinal}`);
      if(i)requireThat(t.ordinal===at[i-1].ordinal+1,'COVERAGE','Gap in native turn ordinal coverage');
      requireThat(['pending','running','completed','failed','interrupted','cancelled'].includes(t.status),'PROJECTION','Invalid native turn status');
      const threadRef=t.nativeThreadRef===undefined?currentRef:ref(t.nativeThreadRef,'turn native thread');
      requireThat(threadRef&&threadRef.driver===pt.driver,'SESSION','Turn driver differs');
      if(a.nativeThreadId!==undefined)requireThat(a.nativeThreadId===threadRef.nativeId,'SESSION','Turn native session differs from exact attempt destination');
      else if(currentRef)requireThat(digest(threadRef)===digest(currentRef),'SESSION','Historical session cannot be attributed without native attempt destination');
      const turnRef=ref(t.nativeTurnRef,'native turn');requireThat(turnRef.driver===pt.driver,'SESSION','Native turn driver differs');
      const key=digest([b.providerInstanceId,threadRef,turnRef]);requireThat(!nativeKeys.has(key),'DUPLICATE','Native turn counted more than once');nativeKeys.add(key);
      requireThat(sourceRows.get(sourceKey(t))===1,'DUPLICATE','Native source turn is also attributed to another row');
      const u=normalizeUsage(t.turnTokenUsage,b.model,t.model);
      const usable=u&&u.usageStatus!=='unavailable'&&u.localCommand!==true;
      const mainComplete=!!usable&&u.usageStatus==='complete';
      completeMain&&=mainComplete;
      const exactTurn=mainComplete&&DONE.has(t.status)&&!u.hasSubagents&&u.otherUsage?.inputTokens===0&&u.otherUsage?.outputTokens===0;
      qualified&&=exactTurn;
      if(!mainComplete)limitations.add('Main-agent counters are missing, partial, unavailable or describe a local command.');
      if(u?.hasSubagents)limitations.add('Native subagent work is outside the model-bound main-agent scope.');
      if(u?.otherUsage===undefined)limitations.add('Other usage, including compaction, has no measured coverage.');
      else if(u.otherUsage.inputTokens||u.otherUsage.outputTokens)limitations.add('Other usage has no exact per-model attribution and is excluded.');
      if(usable&&count(u.inputTokens)){input=add(input,u.inputTokens);known=add(known,u.inputTokens);hasKnown=true;}else allInput=false;
      if(usable&&count(u.outputTokens)){output=add(output,u.outputTokens);known=add(known,u.outputTokens);hasKnown=true;}else allOutput=false;
      normalizedTurns.push({id:t.id,ordinal:t.ordinal,status:t.status,providerThreadId:t.providerThreadId,nodeId:t.nodeId,nativeThreadRef:threadRef,nativeTurnRef:turnRef,model:b.model,usage:u});
    }
    normalized.push({id:a.id,ordinal:a.attemptOrdinal,providerThreadId:a.providerThreadId,rootNodeId:a.rootNodeId,providerTurnId:a.providerTurnId,status:a.status,turns:normalizedTurns});
  }
  const snapshot={source:NATIVE_USAGE_SOURCE,sourceRevision:NATIVE_USAGE_REVISION,identity,attempts:normalized,
    scope:qualified?'model_bound_run':'main_agent',
    mainAgent:{inputTokens:allInput?input:null,outputTokens:allOutput?output:null,knownTokens:hasKnown?known:null,basis:completeMain?'complete_main_agent':'lower_bound'},
    usage:qualified?{totalTokens:known}:null,cost:null,final:false,limitations:[...limitations].sort()};
  return {status:qualified?'measured':hasKnown?'partial':'unavailable',reason:qualified?null:hasKnown?'WHOLE_RUN_COVERAGE_UNKNOWN':'NATIVE_COUNTERS_UNAVAILABLE',...snapshot};
}

/** Pure: no clock, I/O, effects, model pricing, or interpretation of context occupancy. */
export function selectNativeUsage(state,input){
  try{exact(input,['runId','projection']);return select(state,input);}
  catch(error){if(!error.code)throw error;return {status:'unavailable',reason:error.code,usage:null,cost:null,final:false,limitations:[error.message,BILLING_GAP]};}
}

function monotonic(previous,next){
  const nextAttempts=new Map(next.attempts.map(a=>[a.id,a]));
  for(const old of previous.attempts){
    const a=nextAttempts.get(old.id);
    requireThat(a&&a.ordinal===old.ordinal&&a.providerThreadId===old.providerThreadId&&a.rootNodeId===old.rootNodeId,'REGRESSION','Cumulative native attempt coverage changed');
    requireThat(!DONE.has(old.status)||DONE.has(a.status),'REGRESSION','Terminal native attempt regressed');
    const newTurns=new Map(a.turns.map(t=>[t.id,t]));
    for(const t of old.turns){
      const v=newTurns.get(t.id);
      requireThat(v&&digest([v.ordinal,v.providerThreadId,v.nodeId,v.nativeThreadRef,v.nativeTurnRef,v.model])===digest([t.ordinal,t.providerThreadId,t.nodeId,t.nativeThreadRef,t.nativeTurnRef,t.model]),'REGRESSION','Cumulative native turn coverage changed');
      requireThat(!DONE.has(t.status)||DONE.has(v.status),'REGRESSION','Terminal native turn regressed');
      const u=t.usage,w=v.usage;if(!u)continue;
      requireThat(w,'REGRESSION','Measured native turn disappeared');
      const rank={unavailable:0,partial:1,complete:2};requireThat(rank[w.usageStatus]>=rank[u.usageStatus],'REGRESSION','Native usage status regressed');
      requireThat(!u.hasSubagents||w.hasSubagents,'REGRESSION','Native subagent coverage regressed');
      requireThat((u.localCommand??false)===(w.localCommand??false),'REGRESSION','Local command attribution changed');
      for(const k of ['inputTokens','outputTokens','cachedInputTokens','cacheCreationTokens','reasoningTokens'])if(u[k]!==undefined)requireThat(count(w[k])&&w[k]>=u[k],'REGRESSION','Cumulative native count decreased or disappeared');
      if(u.otherUsage)requireThat(w.otherUsage&&w.otherUsage.inputTokens>=u.otherUsage.inputTokens&&w.otherUsage.outputTokens>=u.otherUsage.outputTokens,'REGRESSION','Other-usage coverage regressed');
    }
  }
}
const receipts=(s,runId)=>s.receipts.filter(r=>r.type===RECEIPT_TYPE&&(!runId||r.runId===runId)).sort((a,b)=>a.sequence-b.sequence);
function assertIdentity(s,snapshot){requireThat(digest(sourceIdentity(s,snapshot.identity.binding.runId))===digest(snapshot.identity),'IDENTITY','Canonical source identity changed; reconcile the exact run');}
function assertReceipt(s,r){
  requireThat(r&&r.fingerprint===digest(r.snapshot)&&r.sourceReceiptId===`${NATIVE_USAGE_SOURCE}:${r.sequence}:${r.fingerprint}`&&r.operationId===`budget:native:${r.fingerprint}`,'RECEIPT','Immutable native receipt is missing or changed');
  assertIdentity(s,r.snapshot);
  requireThat(r.runId===r.snapshot.identity.binding.runId&&r.projectId===r.snapshot.identity.binding.projectId,'RECEIPT','Native receipt scope changed');
  integer(r.sequence,'native receipt sequence',1);
}
function observation(r){return {...r.snapshot.identity.binding,source:NATIVE_USAGE_SOURCE,sourceReceiptId:r.sourceReceiptId,sequence:r.sequence,cost:null,usage:r.snapshot.usage,final:false,occurredAt:null};}

/** Call synchronously inside the canonical observation transaction, after applying
 * its native projection. Persists only identifiers and bounded counter evidence. */
export function collectNativeUsage(state,input){
  const snapshot=selectNativeUsage(state,input);
  if(!snapshot.identity)return snapshot;
  const fingerprint=digest(snapshot);
  const prior=state.receipts.find(r=>r.operationId===`budget:native:${fingerprint}`&&r.type===RECEIPT_TYPE);
  if(prior){assertReceipt(state,prior);return {status:'replayed',receipt:structuredClone(prior)};}
  const history=receipts(state,input.runId),latest=history.at(-1);
  if(latest){assertReceipt(state,latest);monotonic(latest.snapshot,snapshot);}
  const existing=state.events.filter(e=>e.type==='budget.observation'&&e.binding.runId===input.runId);
  requireThat(existing.every(e=>e.source===NATIVE_USAGE_SOURCE),'SOURCE','An authoritative cumulative Budget source already exists');
  const sequence=add([...history,...existing].reduce((n,r)=>Math.max(n,r.sequence),0),1),sourceReceiptId=`${NATIVE_USAGE_SOURCE}:${sequence}:${fingerprint}`;
  const receipt={operationId:`budget:native:${fingerprint}`,type:RECEIPT_TYPE,projectId:snapshot.identity.binding.projectId,runId:input.runId,sourceReceiptId,sequence,fingerprint,snapshot};
  state.receipts.push(receipt);
  return {status:'collected',receipt:structuredClone(receipt)};
}

/** Required private guard in budgets.observe's commit transaction for this source.
 * It binds the immutable observation to current canonical native authority. */
export function assertNativeUsageObservation(state,input){
  requireThat(input.source===NATIVE_USAGE_SOURCE,'SOURCE','Not a native usage observation');
  const matches=state.receipts.filter(r=>r.type===RECEIPT_TYPE&&r.sourceReceiptId===input.sourceReceiptId);
  requireThat(matches.length===1,'RECEIPT','One immutable native source receipt required');
  const receipt=matches[0];assertReceipt(state,receipt);
  const expected=observation(receipt);
  requireThat(digest({...input,occurredAt:input.occurredAt??null})===digest(expected),'RECEIPT','Observation differs from immutable source snapshot');
  return true;
}

/** Host-only. Never expose collect/feed/drain through HTTP or model tools.
 * collect may run under the protocol queue. feed/drain MUST run after release:
 * Budget observe alone owns ledger, reconciliation, and any Stop call. */
export function createNativeUsageBridge({store,budgets}){
  if(!store?.read||!store?.transaction||!budgets?.observe)throw new TypeError('Canonical store and private Budget observer required');
  const inFlight=new Set();
  const api={
    collect(input){const captured=structuredClone(input);return store.transaction(s=>collectNativeUsage(s,captured));},
    async feed({runId}){
      text(runId,'runId');
      // Return immediately on reentry; returning the active promise deadlocks
      // when Stop reconciles and its post-queue callback feeds this run again.
      if(inFlight.has(runId))return {status:'in-flight',delivered:0};
      inFlight.add(runId);let delivered=0;
      try{
        // A Stop reconciliation can collect another receipt while this feed is
        // active. Re-read pending receipts so that reentry never loses it.
        for(;;){
          const current=store.read(),batch=receipts(current,runId).filter(r=>!current.events.some(e=>e.type==='budget.observation'&&e.source===NATIVE_USAGE_SOURCE&&e.sourceReceiptId===r.sourceReceiptId));
          if(!batch.length)break;
          for(const r of batch){
            const s=store.read();assertReceipt(s,r);
            const input=observation(r);assertNativeUsageObservation(s,input);
            if(s.events.some(e=>e.type==='budget.observation'&&e.source===NATIVE_USAGE_SOURCE&&e.sourceReceiptId===r.sourceReceiptId))continue;
            await budgets.observe(input);
            // Never mark acknowledged, release a hold, or continue feeding after
            // an awaited Budget/Stop changed the canonical source identity.
            const after=store.read();assertIdentity(after,r.snapshot);
            requireThat(after.events.some(e=>e.type==='budget.observation'&&e.source===NATIVE_USAGE_SOURCE&&e.sourceReceiptId===r.sourceReceiptId),'RECEIPT','Budget did not acknowledge the immutable source receipt');delivered++;
          }
        }
        return {status:'drained',delivered};
      }finally{inFlight.delete(runId);}
    },
    async drain(){
      const ids=[...new Set(receipts(store.read()).map(r=>r.runId))],results=[];
      for(const runId of ids){try{results.push({runId,...await api.feed({runId})});}catch(error){results.push({runId,status:'unavailable',reason:error.code??'NATIVE_USAGE_FEED_FAILED'});}}
      return results;
    },
  };return api;
}
