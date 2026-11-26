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

// An approved cohort pins all slots while the catalog/authentication observation
// is fresh. Once its first allocation is claimed, those SAME bytes remain the
// admission identity for its fixed absolute trial envelope. They do not become
// a fresh catalog for another cohort. Account/config/catalog changes still deny;
// native image/current-account/Stop/deadline checks remain separate and current.
export function validateCohortRoute(state,composition,clock=Date.now){
  const c=state.events.find(e=>e.type==='research.composition'&&e.id===composition.id&&e.projectId===composition.projectId);
  if(!c||digest(c)!==digest(composition)||c.digest!==digest({...c,digest:undefined}))fail('RESEARCH_COMPONENT_ROUTE','Exact immutable approved cohort required',409);
  const allocations=state.events.filter(e=>e.type==='research.allocation'&&e.compositionId===c.id),first=allocations[0];
  if(!first)return validateRoutePin(state,c.projectId,c.routePin,clock);
  const acceptedAt=Date.parse(c.createdAt),claimedAt=Date.parse(first.createdAt),now=clock(),t=state.events.find(e=>e.type==='research.trial'&&e.id===c.trialId&&e.projectId===c.projectId);
  if(!Number.isSafeInteger(acceptedAt)||!Number.isSafeInteger(claimedAt)||claimedAt<acceptedAt||claimedAt-acceptedAt>=300000||now<claimedAt||!t||t.manifestDigest!==c.manifestDigest||!Number.isSafeInteger(t.startedAt)||t.deadlineAt!==t.startedAt+c.limits.maxMs)fail('RESEARCH_COMPONENT_ROUTE','Cohort freshness claim or absolute envelope changed',409);
  // Recompute and compare the full original pin, including authentication and
  // catalog bytes. Only its age is evaluated at its recorded approval instant.
  return validateRoutePin(state,c.projectId,c.routePin,()=>acceptedAt);
}
