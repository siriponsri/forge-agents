import { changed, fail, find, digest, safeError, source } from './common.mjs';

export function createProviderCatalog({store,t3,clock=Date.now,timeoutMs=1500,ttlMs=300000}) {
  const flights=new Map();
  const connection=(s,projectId,id)=>{find(s,'projects',projectId);const c=find(s,'connections',id,projectId);if(c.kind!=='provider')fail('SCOPE','Expected a provider connection',409);return c;};
  const identity=c=>digest([c.providerInstanceId,c.config?.generation,c.config?.routeId,c.config?.accountRoute,source]);
  function state({projectId,connectionId}) {
    const c=connection(store.read(),projectId,connectionId),catalog=c.providerCatalog??null;
    return {catalog,identity:{projectId,connectionId,providerInstanceId:c.providerInstanceId,accountRoute:c.config?.accountRoute,generation:c.config?.generation,...source},refreshing:flights.has(connectionId),stale:!catalog||!!c.catalogError||catalog.identityKey!==identity(c)||clock()-catalog.observedAt>ttlMs,error:c.catalogError??null,
      freshness:'Time observed by FORGE; upstream cache age is not exposed by orchestrator_capabilities.'};
  }
  async function refresh(input) {
    const c=connection(store.read(),input.projectId,input.connectionId),key=identity(c);
    let flight=flights.get(c.id);
    if(!flight||flight.key!==key){
      const promise=(async()=>{
        try {
          // Explicit rediscovery only. Never run a billable chat probe or infer auth
          // from catalog membership. The narrow RPC hook may be absent.
          if(t3.providers?.rpc)await t3.providers.rpc('server.refreshProviders',{instanceId:c.providerInstanceId,fresh:true,refreshModels:true});
          const value=await t3.catalog();
          const p=value.providers?.find(p=>p.providerInstanceId===c.providerInstanceId);
          if(!p)fail('ROUTE_UNAVAILABLE','Provider instance absent from runtime catalog',409);
          if(!Array.isArray(p.models))fail('CATALOG_INVALID','Runtime returned no model list',502);
          const models=p.models.map(m=>({id:m.id,...(m.name?{name:m.name}:{}),options:(m.options??[]).map(o=>({id:o.id,values:o.values,...(o.default!==undefined?{default:o.default}:{})}))}));
          if(models.some(m=>typeof m.id!=='string'||!m.id)||new Set(models.map(m=>m.id)).size!==models.length)fail('CATALOG_INVALID','Invalid model identities',502);
          await store.transaction(s=>{const current=connection(s,input.projectId,c.id);if(identity(current)!==key)return;
            current.providerCatalog={identityKey:key,providerInstanceId:p.providerInstanceId,driverKind:p.driverKind,models,omittedModels:p.omittedModels??0,canRunChildTask:p.canRunChildTask,runtimeModes:p.runtimeModes??[],observedAt:clock(),source:'orchestrator_capabilities',upstreamFreshness:'unknown',...source};delete current.catalogError;changed(current);});
        }catch(error){await store.transaction(s=>{const current=connection(s,input.projectId,c.id);if(identity(current)!==key)return;current.catalogError={...safeError(error),at:clock()};changed(current);});}
      })();
      flight={key,promise};flights.set(c.id,flight);promise.finally(()=>{if(flights.get(c.id)===flight)flights.delete(c.id);});
    }
    let timer;await Promise.race([flight.promise,new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);clearTimeout(timer);
    return state(input);
  }
  function validate({projectId,connectionId,selection}) {
    const c=connection(store.read(),projectId,connectionId);
    if(c.enabled===false)fail('DISABLED','Enable this provider connection',409);
    if(selection?.instanceId!==c.providerInstanceId)fail('PROVIDER_IDENTITY','Selection belongs to another provider instance',409);
    const catalog=c.providerCatalog;
    if(!catalog||catalog.providerInstanceId!==c.providerInstanceId||catalog.identityKey!==identity(c))fail('DISCOVER_FIRST','Refresh this instance and account generation before selecting a model',409);
    const model=catalog.models.find(m=>m.id===selection.model);
    // T3 custom models become selectable only after T3 accepts the custom entry
    // and advertises its actual option values. No invented universal options.
    if(!model)fail('MODEL_UNVERIFIED','Model not observed in this instance; configure a custom entry in T3 and refresh. Absence is not proof of nonexistence.',409);
    const options=selection.options??[];
    if(!Array.isArray(options)||options.length>32||new Set(options.map(o=>o.id)).size!==options.length)fail('MODEL_OPTIONS','Use distinct option selections');
    for(const option of options){const descriptor=model.options.find(o=>o.id===option.id);if(!descriptor?.values.some(v=>v===option.value))fail('MODEL_OPTIONS','Option or value not advertised for this exact model',409);}
    return {instanceId:c.providerInstanceId,model:model.id,options:options.map(o=>({id:o.id,value:o.value})),connectionId:c.id,connectionGeneration:c.config?.generation,catalogObservedAt:catalog.observedAt,selectionVerified:'catalog-only',executionVerified:false};
  }
  return {state,refresh,validate,async settle(){await Promise.all([...flights.values()].map(f=>f.promise));}};
}
