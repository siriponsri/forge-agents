import {performance} from 'node:perf_hooks';
import {fail,integer,text,routeOf,sourceOf,hash} from './contracts.mjs';

export function budgetOf(budget){
  const contextWindow=integer(budget?.contextWindow,'contextWindow',256,100_000_000);
  const outputReserve=integer(budget.outputReserve??0,'outputReserve',0,contextWindow);
  const safetyReserve=integer(budget.safetyReserve??0,'safetyReserve',0,contextWindow);
  const available=contextWindow-outputReserve-safetyReserve;
  const maxInputTokens=integer(budget.maxInputTokens??available,'maxInputTokens',1,available);
  return {contextWindow,outputReserve,safetyReserve,maxInputTokens};
}
export async function measure(text,route,tokenizer){
  const start=performance.now(),bytes=Buffer.byteLength(text);
  const base={route:routeOf(route),bytes,requestHash:hash(text),surface:'forge-prefix-only',nativeHistoryTokens:{status:'unknown',value:null},cost:{status:'unknown',value:null}};
  if(!tokenizer)return {...base,status:'estimate',tokens:Math.ceil(bytes/3),upperBound:null,source:{kind:'heuristic',reference:'FORGE UTF-8 bytes / 3; not a tokenizer or guaranteed upper bound'},latencyMs:performance.now()-start};
  const result=await tokenizer({text,route:{...route},requestHash:base.requestHash});
  if(!result)return {...base,status:'unknown',tokens:null,upperBound:null,source:null,latencyMs:performance.now()-start};
  if(!['actual','estimate','upper-bound','unknown'].includes(result.status)||hash(routeOf(result.route))!==hash(base.route))fail('CONTEXT_ACCOUNTING','Tokenizer must identify exact matching provider and model');
  const source=sourceOf(result.source);
  const tokens=result.status==='unknown'?null:integer(result.tokens,'token count',0,1_000_000_000);
  return {...base,status:result.status,tokens,upperBound:result.status==='upper-bound'?tokens:null,source,latencyMs:performance.now()-start};
}
export function pressure(accounting,budget){return accounting.tokens===null?'unknown':accounting.tokens<=budget.maxInputTokens?'within-budget':'over-budget';}
export function validateUsage(value,route,requestHash){
  if(!value)return {status:'unknown',inputTokens:null,outputTokens:null,cost:{status:'unknown',value:null}};
  if(hash(routeOf(value.route))!==hash(route)||value.requestHash!==requestHash)fail('CONTEXT_USAGE','Provider usage does not match exact routed request',409);
  return {status:'actual',surface:'reported-provider-request',association:'FORGE prefix hash; native request envelope is unobserved',inputTokens:integer(value.inputTokens,'inputTokens',0,1_000_000_000),outputTokens:integer(value.outputTokens,'outputTokens',0,1_000_000_000),source:sourceOf(value.source),route,requestHash,
    // Provider input totals already include cached/reasoning buckets. Never sum
    // buckets with unspecified overlap, nor derive a price from model names.
    cost:value.cost?{status:'actual',value:typeof value.cost.value==='number'&&Number.isFinite(value.cost.value)&&value.cost.value>=0?value.cost.value:fail('CONTEXT_USAGE','Invalid provider cost'),currency:text(value.cost.currency,'provider cost currency',20),source:sourceOf(value.cost.source)}:{status:'unknown',value:null}};
}
