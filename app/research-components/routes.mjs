import {digest,fail} from '../research/contracts.mjs';
export function routePin(state,projectId,clock=Date.now){
  const p=state.projects.find(p=>p.id===projectId),selection=p?.profile?.provider;
  const matches=state.connections.filter(c=>c.projectId===projectId&&c.kind==='provider'&&c.enabled!==false&&c.providerInstanceId===selection?.instanceId&&(!selection.connectionId||c.id===selection.connectionId));
  if(matches.length!==1)fail('RESEARCH_COMPONENT_ROUTE','One explicit enabled provider/account connection required',409);
  const c=matches[0],catalog=c.providerCatalog,check=c.lastCheck;
  if(!catalog||catalog.stale===true||catalog.catalogComplete===false||catalog.omittedModels!==0||catalog.canRunChildTask!==true||!catalog.runtimeModes?.includes('approval-required')||c.catalogError||catalog.providerInstanceId!==c.providerInstanceId||!Number.isFinite(catalog.observedAt)||catalog.observedAt>clock()||clock()-catalog.observedAt>=300000||check?.providerInstanceId!==c.providerInstanceId||check.installed!==true||check.enabled!==true||check.authentication!=='authenticated'||check.status!=='ready'||!Number.isFinite(check.checkedAt)||check.checkedAt>clock()||clock()-check.checkedAt>=300000)fail('RESEARCH_COMPONENT_ROUTE','Fresh exact catalog, authentication and supervised orchestration capability required',409);
  const model=catalog.models?.find(m=>m.id===selection.model),options=selection.options??[];
  if(!model||!Array.isArray(options)||new Set(options.map(o=>o.id)).size!==options.length||options.some(o=>!model.options?.some(d=>d.id===o.id&&d.values?.includes(o.value)))||(model.options??[]).some(d=>d.default!==undefined&&!options.some(o=>o.id===d.id)))fail('RESEARCH_COMPONENT_ROUTE','Exact advertised model/options required; make catalog defaults explicit',409);
  return {connectionId:c.id,signature:digest({id:c.id,enabled:c.enabled,config:c.config,catalog,check}),selection:{instanceId:c.providerInstanceId,model:selection.model,options}};
}
export function validateRoutePin(state,projectId,pin,clock=Date.now){const current=routePin(state,projectId,clock);if(digest(current)!==digest(pin))fail('RESEARCH_COMPONENT_ROUTE','Pinned provider catalog/account/options changed',409);return current;}
