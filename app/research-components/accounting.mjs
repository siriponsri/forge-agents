import {binding,digest as budgetDigest} from '../budgets/contracts.mjs';
import {allocationsFor,runFor,intact,fail,records} from './contracts.mjs';

// Read actual cumulative owner observations, never agent-written usage fields.
export function componentUsage(state,composition){
  const runs=allocationsFor(state,composition).map(a=>({a,r:runFor(state,a)}));
  const details=runs.map(({a,r})=>{
    if(!r)return {allocationId:a.id,runId:null,tokens:null,cost:null,currency:null,final:null,observationIds:[]};
    const expected=binding(r),obs=state.events.filter(e=>e.type==='budget.observation'&&e.projectId===composition.projectId&&e.binding?.runId===r.id&&!e.stale).sort((a,b)=>b.sequence-a.sequence);
    for(const o of obs){
      const data={binding:o.binding,source:o.source,sourceReceiptId:o.sourceReceiptId,sequence:o.sequence,cost:o.cost,usage:o.usage,final:o.final,occurredAt:o.occurredAt};
      if(budgetDigest(o.binding)!==budgetDigest(expected)||budgetDigest(data)!==o.fingerprint)fail('RESEARCH_COMPONENT_USAGE','Canonical Budget observation is stale, foreign or changed',409);
    }
    const cost=obs.find(o=>o.cost!==null),usage=obs.find(o=>o.usage!==null);
    const tokens=usage?.usage?.totalTokens??null,amount=cost?cost.cost.minorUnits/10**cost.cost.scale:null;
    if(tokens!==null&&(!Number.isSafeInteger(tokens)||tokens<0)||amount!==null&&(!Number.isFinite(amount)||amount<0))fail('RESEARCH_COMPONENT_USAGE','Invalid actual owner usage',409);
    return {allocationId:a.id,runId:r.id,attemptId:r.attemptId,tokens,cost:amount,currency:cost?.cost.currency??null,final:obs[0]?.final??null,observationIds:obs.map(o=>o.id)};
  });
  const currencies=[...new Set(details.filter(d=>d.cost!==null).map(d=>d.currency))],knownTokens=details.reduce((n,d)=>n+(d.tokens??0),0),knownCostByCurrency=Object.fromEntries(currencies.map(currency=>[currency,details.filter(d=>d.currency===currency).reduce((n,d)=>n+(d.cost??0),0)])),knownCost=currencies.length>1?null:details.reduce((n,d)=>n+(d.cost??0),0);
  const unknown=details.some(d=>d.tokens===null||d.cost===null||d.final!==true);
  const overhead=records(state,'controller-overhead',composition.projectId).filter(e=>e.compositionId===composition.id).map(intact);
  return {tokens:details.some(d=>d.tokens===null)?null:knownTokens,cost:details.some(d=>d.cost===null)||currencies.length>1?null:knownCost,currency:currencies.length===1?currencies[0]:null,knownTokens,knownCost,knownCostByCurrency,currencies,unknown,details,controller:{elapsedMs:overhead.reduce((n,e)=>n+e.elapsedMs,0),tokens:null,cost:null,currency:null,source:'local-controller-wall-clock; monetary overhead unmeasured',receiptIds:overhead.map(e=>e.id)}};
}
export function assertContinuation(state,c,limits){
  const u=componentUsage(state,c);
  if(u.currencies.length>1)fail('RESEARCH_COMPONENT_CURRENCY','Different currencies cannot share a scalar trial cost cap',409);
  if(u.unknown&&(limits.unknownAccounting!=='allow'||limits.maxTokens!==null||limits.maxCost!==null))fail('RESEARCH_ACCOUNTING_UNKNOWN','Unknown cohort usage/finality blocks continuation under the pinned accounting or hard-cap policy',409);
  if(limits.maxTokens!==null&&u.knownTokens>=limits.maxTokens||limits.maxCost!==null&&u.knownCost>=limits.maxCost)fail('RESEARCH_BUDGET','Global cohort budget reached',409);
  return u;
}
