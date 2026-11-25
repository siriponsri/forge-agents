import {randomUUID} from 'node:crypto';
import {digest,fail} from './contracts.mjs';

// Headless API drives exactly the same service and opaque Owner authority as GUI.
// It never launches a provider directly or treats a fixture as a live route.
export async function runResearchComposition({service,caller,projectId,trialId,slots,compositionId=null,onProgress=()=>{},maxCommands=24}){
  if(!service||!Number.isSafeInteger(maxCommands)||maxCommands<1||maxCommands>64)fail('RESEARCH_COMPONENT_RUNNER','Bounded existing service driver required',409);
  if(!compositionId){const c=await service.prepare({projectId,trialId,operationId:randomUUID(),slots},caller);compositionId=c.id;}
  if(!compositionId)fail('RESEARCH_COMPONENT_RUNNER','Prepared composition identity required',409);
  // Commands append their own overhead after producing a result. Read the final
  // canonical snapshot so the export includes that last command's accounting.
  async function finish(state){return exportResult({...await service.state({projectId,trialId},caller),status:state.status});}
  for(let n=0;n<maxCommands;n++){
    let state=await service.state({projectId,trialId},caller);if(state.composition.id!==compositionId)fail('RESEARCH_COMPONENT_RUNNER','Pinned composition changed',409);
    if(state.status==='awaiting-validation'){
      for(const x of state.attempts.filter(x=>x.run?.status==='completed'&&!x.evidence))await service.validate({projectId,trialId,allocationId:x.allocation.id,operationId:randomUUID()},caller);
    }else if(['prepared','ready'].includes(state.status)){
      state=await service.advance({projectId,trialId,operationId:randomUUID()},caller);
      await onProgress(state);if(['PASSED','FAILED'].includes(state.status))return finish(state);
    }else if(state.status==='running'){
      await onProgress(state);return finish(state); // Caller resumes after native observation; no polling/redispatch.
    }else{return finish(state);}
  }
  return exportResult({...await service.state({projectId,trialId},caller),status:'command-limit'});
}
function exportResult(state){const data={version:1,compositionId:state.composition.id,manifestDigest:state.composition.manifestDigest,status:state.status,attempts:state.attempts,usage:state.usage,qualification:state.qualification};return {format:'forge-research-components-json/1',data,sha256:digest(data)};}
