import {fail,hash,redact,safeJson,text} from './contracts.mjs';
import {validateResearchComponentContext} from '../research-components/contracts.mjs';

// T3 admission owns route validation and the Assistance reservation. Context
// checks the durable snapshot it receives; it neither chooses nor escalates.
export function selectionForRun(run,configured,{state,preflight=false}={}){
  const assistance=run.assistanceContext;
  const selection=run.selection??(assistance?null:configured);
  if(!selection||typeof selection!=='object')fail('CONTEXT_SELECTION_MISMATCH','Run has no admitted provider selection',409);
  text(selection.instanceId,'selected provider');text(selection.model,'selected model');
  if(assistance){
    if(assistance.version!==1||!['executor','asst'].includes(assistance.role)||assistance.runtimeMode!=='approval-required'||hash(assistance.selection)!==hash(selection))fail('CONTEXT_SELECTION_MISMATCH','Durable Assistance role/model/options differ from its admitted selection',409);
  }else if(run.researchComponentContext){
    // Preflight chooses no route and performs no context read/write. The
    // Context owner repeats full canonical allocation validation before use.
    const component=state?validateResearchComponentContext(state,run):preflight?run.researchComponentContext:null;
    const route=v=>({instanceId:v?.instanceId,model:v?.model,options:v?.options??[]});
    if(!component||hash(component.selection)!==hash(selection)||hash(route(selection))!==hash(route(configured))||configured?.connectionId&&configured.connectionId!==selection.connectionId)fail('CONTEXT_SELECTION_MISMATCH','Research selection must match its canonical allocation and configured route',409);
  }else if(hash(selection)!==hash(configured))fail('CONTEXT_ROUTE_STALE','Ordinary run selection differs from current project profile',409);
  if(run.providerInstanceId!==undefined&&run.providerInstanceId!==selection.instanceId)fail('CONTEXT_SELECTION_MISMATCH','Durable provider instance differs from its admitted selection',409);
  return structuredClone(selection);
}

export function publicErrorText(error){
  if(typeof error==='string')return redact(error);
  const value=error?.publicError&&typeof error.publicError==='object'?error.publicError:error;
  // Diagnostics may contain stacks, credentials or provider internals. Retain
  // only classified public fields, and never stringify the arbitrary object.
  const result={};for(const key of ['code','message','category','name'])if(typeof value?.[key]==='string')result[key]=value[key];
  for(const key of ['status','statusCode'])if(Number.isSafeInteger(value?.[key]))result[key]=value[key];
  if(typeof value?.retryable==='boolean')result.retryable=value.retryable;
  if(!Object.keys(result).length)Object.assign(result,{code:'EXECUTION_ERROR',message:'Execution failed; inspect authorized run diagnostics.'});
  return JSON.stringify(safeJson(result));
}
