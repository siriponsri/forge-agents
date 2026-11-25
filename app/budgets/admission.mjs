import {append,records,find,fail,money,digest,binding,owned,policy,policyFence,periodStart,reservation,accounting,compare,sum,remainder,integer} from './contracts.mjs';

// Read-only projection. Old unresolved holds carry into later windows. Reported
// cumulative spend belongs to the attempt's admission window, never receipt time.
export function exposure(s,p,now=Date.now(),exceptRunId=null){
  const start=periodStart(p,now),rs=records(s,'reservation',p.projectId).filter(r=>(p.botId===null||r.binding.botId===p.botId)&&r.binding.runId!==exceptRunId&&(r.admittedAt>=start||r.held));
  const costs=[],holds=[],mismatches=[],unknown=[],tokens=[];
  for(const r of rs){if(r.notDispatched)continue;const a=accounting(s,r),inPeriod=r.admittedAt>=start;
    if(inPeriod&&a.cost){if(a.cost.currency===p.limit.currency)costs.push(a.cost);else mismatches.push(r.binding.runId);}
    if(a.usage&&inPeriod)tokens.push(a.usage.totalTokens);
    if((inPeriod||r.held)&&a.pricingStatus==='unknown')unknown.push(r.binding.runId);
    if(r.held){
      // A new policy never reprices an old hold. Missing holds remain unknown.
      const h=r.holds.find(h=>h.botId===p.botId)?.amount;
      if(h){if(h.currency!==p.limit.currency||a.cost&&a.cost.currency!==h.currency)mismatches.push(r.binding.runId);else holds.push(remainder(h,inPeriod?a.cost:null));}
      else if(!unknown.includes(r.binding.runId))unknown.push(r.binding.runId);
    }
  }
  // Legacy/unintegrated canonical attempts have no trusted immutable billing
  // receipt. Unknown policy must see them even before the native feed migrates.
  for(const run of s.runs.filter(r=>r.projectId===p.projectId&&(p.botId===null||(r.botId??null)===p.botId)&&r.id!==exceptRunId&&!reservation(s,r.id))){
    const at=Date.parse(run.createdAt??'');if(!Number.isFinite(at)||at>=start||!['completed','failed','cancelled','interrupted','rolled_back','stopped'].includes(run.status))unknown.push(run.id);
  }
  const knownSpend=sum(costs,p.limit.currency,p.limit.scale),held=sum(holds,p.limit.currency,p.limit.scale),total=sum([knownSpend,held],p.limit.currency,p.limit.scale);
  const tokenSubtotal=tokens.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(tokenSubtotal))fail('BUDGET_OVERFLOW','Token total exceeds safe integer storage',409);
  return {periodStart:start,period:p.period,knownSpend,held,exposure:total,unknownCount:new Set(unknown).size,unknownRunIds:[...new Set(unknown)],currencyMismatch:[...new Set(mismatches)],knownTokens:tokenSubtotal,pricingStatus:unknown.length?'unknown':'reported'};
}
function policies(s,b){return [policy(s,b.projectId,null),...(b.botId?[policy(s,b.projectId,b.botId)]:[])].filter(p=>p?.enabled);}
function check(p,e,{candidate=null}={}){
  if(e.currencyMismatch.length)fail('BUDGET_CURRENCY','Reported or held currency differs from the policy',409,{policyId:p.id});
  if(p.unknown==='block'&&e.unknownCount)fail('BUDGET_UNKNOWN','Unpriced attempts require reconciliation under this policy',409,{policyId:p.id,runIds:e.unknownRunIds});
  if(compare(e.knownSpend,p.limit)>=0)fail('BUDGET_LIMIT','Reported spending reached the stop threshold',409,{policyId:p.id});
  const total=candidate?sum([e.exposure,candidate],p.limit.currency):e.exposure;
  if(compare(total,p.limit)>0||(!candidate||candidate.minorUnits===0)&&compare(total,p.limit)>=0)fail('BUDGET_HELD','Available budget is held by unfinished attempts',409,{policyId:p.id});
}
/** Mutates only the candidate transaction state. No IO, turn or price lookup. */
export function reserveBudget(s,{run,input,now=Date.now()}){
  const b=binding(run);owned(s,b);find(s,'projects',b.projectId);integer(now,'now');
  const existing=reservation(s,b.runId);if(existing){if(digest(existing.binding)!==digest(b))fail('BUDGET_OWNERSHIP','Reservation belongs to another attempt',409);return existing;}
  // input is deliberately not a source of prices, grants, reserve overrides or
  // caller-asserted finality. The canonical run and Owner policies are authority.
  const ps=policies(s,b),holds=ps.map(p=>({botId:p.botId,amount:money(p.reserve)}));
  for(const p of ps)check(p,exposure(s,p,now,b.runId),{candidate:p.reserve});
  return append(s,'reservation',{binding:b,admittedAt:now,policyFence:policyFence(s,b),holds,held:true,status:'held',restored:false},b.projectId);
}
/** Read-only final dispatch fence. This is not permission to dispatch twice. */
export function validateBudgetAdmission(s,{run,input,now=Date.now()}){
  const b=binding(run);owned(s,b);const r=reservation(s,b.runId);
  if(!r||digest(r.binding)!==digest(b)||!r.held||r.restored||r.accountingOnly)fail('BUDGET_RESERVATION','A current held budget reservation is required',409);
  if(digest(r.policyFence)!==digest(policyFence(s,b)))fail('BUDGET_POLICY_CHANGED','Budget policy changed during admission; review a new attempt',409);
  for(const p of policies(s,b)){
    // Its own unpriced reservation is expected; other unknown work follows policy.
    const e=exposure(s,p,now,b.runId),hold=r.holds.find(h=>h.botId===p.botId)?.amount;
    if(!hold)fail('BUDGET_POLICY_CHANGED','This attempt has no hold for the current policy',409);
    check(p,e,{candidate:hold});
  }
  return true;
}
