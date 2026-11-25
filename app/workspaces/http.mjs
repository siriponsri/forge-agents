import {exact,fail} from './contracts.mjs';
export const WORKSPACE_HTTP_METHODS=Object.freeze(['state','configure','create','start','reconcile','stop','check','review','enqueue','prepareIntegration','checkIntegration','approveIntegration','integrate','reconcileIntegration']);
const base=['projectId','operationId','expectedRevision'];
const fields={state:['projectId'],configure:['maxConcurrent','providerLimit','checks'],create:['taskId','expectedTaskRevision'],start:['workspaceId'],reconcile:['workspaceId'],stop:['workspaceId'],check:['workspaceId'],review:['workspaceId','head'],enqueue:['workspaceId','head'],prepareIntegration:['integrationId','targetHead'],checkIntegration:['integrationId'],approveIntegration:['integrationId','targetHead','head'],integrate:['integrationId','targetHead','head'],reconcileIntegration:['integrationId']};
// Host authenticates a private browser session; mutations also require its CSRF
// token. No model-facing MCP/tool route is exported. Never service[rawPath].
export async function dispatchWorkspaceRequest(service,method,input,caller,{httpMethod='POST'}={}){
  if(!WORKSPACE_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Parallel Workspace action',404);
  if(httpMethod!==(method==='state'?'GET':'POST'))fail('METHOD','Unsupported HTTP method',405);
  exact(input,method==='state'?fields.state:method==='create'?['projectId','operationId',...fields.create]:[...base,...fields[method]]);
  return service[method](input,caller);
}
