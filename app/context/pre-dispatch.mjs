import {fail} from './contracts.mjs';

/** Bind this closure inside createT3Service. Call it immediately before the
 * native launch, after run reservation/plan/adaptive checks. A browser can never
 * choose callerContext, internal capabilities or baseMessage through this API. */
export function createT3ContextSeam({service,callerContextForRun,memoryForRun}={}){
  if(!service?.preDispatch||typeof callerContextForRun!=='function')throw new TypeError('Context service and trusted run caller resolver required');
  return async function prepare({run,project,baseMessage}){
    const caller=await callerContextForRun(run);
    if(!caller)fail('CONTEXT_FORBIDDEN','Run has no trusted context caller',403);
    const memory=await memoryForRun?.(run);
    return service.preDispatch({projectId:run.projectId,taskId:run.taskId,runId:run.id,operationId:`context:${run.id}`,route:{providerId:project.profile?.provider?.instanceId,modelId:project.profile?.provider?.model},baseMessage,...(memory?{memory}:{})},caller);
  };
}
