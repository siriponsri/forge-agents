import {exact,fail} from './contracts.mjs';
export const RESEARCH_HTTP_METHODS=Object.freeze(['state','create','reserve','execute','reconcile','validate','stop','compare','export']);
const fields={state:['projectId'],create:['projectId','operationId','config'],reserve:['projectId','operationId','experimentId','repetition','policyIndex','ablationIndex','taskId','workspaceId'],execute:['projectId','operationId','trialId','expectedRevision'],reconcile:['projectId','operationId','trialId','expectedRevision'],validate:['projectId','operationId','trialId','expectedRevision'],stop:['projectId','operationId','trialId','expectedRevision'],compare:['projectId','experimentIds'],export:['projectId','experimentId']};
// Existing host owns body limits, local origin, session and CSRF. An opaque
// owner handle is mandatory even for private evidence reads; no MCP endpoint.
export async function dispatchResearchRequest(service,method,input,opaqueCaller){
  if(!RESEARCH_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Research Lab action',404);
  exact(input,fields[method]);if(Buffer.byteLength(JSON.stringify(input))>65536)fail('RESEARCH_LIMIT','Research request exceeds 64 KB',413);
  return service[method](input,opaqueCaller);
}
