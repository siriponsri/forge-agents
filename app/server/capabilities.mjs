import {createPluginService,createBuiltinPlugins} from '../plugins/index.mjs';
import {find,fail} from './domain.mjs';

// Trusted builtins wrap existing owners; no package path or discovered plugin
// becomes executable. A native dispatch keeps its separate stable operation ID.
export function createCapabilities({store,t3,providers,adaptive,desktop,getCompute}){
  const project=ctx=>find(store.read(),'projects',ctx.scope.projectId);
  const connection=(ctx,id,kind)=>{const c=find(store.read(),'connections',id,ctx.scope.projectId);if(kind&&c.kind!==kind)fail('SCOPE','Native connection kind does not match capability',403);return c;};
  const unavailable=code=>({status:'unavailable',code});
  const adapters={
    models:{async health(ctx){const p=project(ctx),c=p.profile?.provider?.connectionId;return c&&connection(ctx,c,'provider').providerCatalog?{status:'ready'}:unavailable('MODEL_SETUP_REQUIRED');},async invoke(method,args,ctx){const p=project(ctx),c=p.profile?.provider?.connectionId;if(!c)fail('MODEL_REQUIRED','Select a provider connection',409);return providers.catalog({projectId:p.id,connectionId:c});}},
    provider:{async health(ctx){const p=project(ctx),c=p.profile?.provider?.connectionId;if(!c)return unavailable('MODEL_SETUP_REQUIRED');const check=connection(ctx,c,'provider').lastCheck;return check?.status==='ready'&&check.authentication==='authenticated'?{status:'ready'}:unavailable('PROVIDER_SETUP_REQUIRED');},async invoke(method,args,ctx){return method==='dispatch'?t3.startRun({projectId:ctx.scope.projectId,taskId:args.taskId,conversationId:ctx.scope.sessionId,operationId:ctx.operationId}):t3.stop(args.runId);}},
    mcp:{async health(ctx){const c=ctx.config.connectionId&&connection(ctx,ctx.config.connectionId,'mcp');return c?.lastCheck?.status==='ready'&&!c.discoveryStale?{status:'ready'}:unavailable('MCP_DISCOVERY_REQUIRED');},async invoke(method,args,ctx){connection(ctx,args.connectionId,'mcp');return providers.mcp[method]({...args,projectId:ctx.scope.projectId,operationId:ctx.operationId});}},
    skills:{async health(ctx){project(ctx);return {status:'ready'};},async invoke(method,args,ctx){return adaptive.select({projectId:ctx.scope.projectId,taskId:args.taskId,operationId:ctx.operationId,constraints:{skillIds:args.skillIds}});}},
    environment:{async health(ctx){const c=ctx.config.connectionId;if(!c||!getCompute?.())return unavailable('COMPUTE_SETUP_REQUIRED');return (await getCompute().health({projectId:ctx.scope.projectId,targetId:c})).execution?{status:'ready'}:unavailable('COMPUTE_SETUP_REQUIRED');},async invoke(method,args,ctx){connection(ctx,args.connectionId,'compute');const compute=getCompute?.();if(!compute)fail('ADAPTER_MISSING','Compute service is unavailable',409);return compute.health({projectId:ctx.scope.projectId,targetId:args.connectionId});}},
    desktop:{async health(ctx){if(!ctx.config.targetId)return unavailable('TARGET_SETUP_REQUIRED');return (await desktop.health({projectId:ctx.scope.projectId,targetId:ctx.config.targetId})).ready?{status:'ready'}:unavailable('TARGET_SETUP_REQUIRED');},async invoke(method,args,ctx){return method==='inspect'?desktop.health({projectId:ctx.scope.projectId,targetId:args.targetId}):desktop.stop({projectId:ctx.scope.projectId,...args});}},
    browser:{async health(ctx){if(!ctx.config.targetId)return unavailable('TARGET_SETUP_REQUIRED');const h=await desktop.health({projectId:ctx.scope.projectId,targetId:ctx.config.targetId});return h.ready&&h.kind==='browser'?{status:'ready'}:unavailable('BROWSER_SETUP_REQUIRED');},async invoke(method,args,ctx){const h=await desktop.health({projectId:ctx.scope.projectId,targetId:args.targetId});if(h.kind!=='browser')fail('SCOPE','Select an owned browser target',403);return h;}},
  };
  const builtins=createBuiltinPlugins(adapters).map(p=>({...p,consumes:['forge.provider','forge.skills'].includes(p.id)?[{capability:'models',version:'^1.0.0'}]:p.consumes}));
  const service=createPluginService({store,adapters,builtins,authorize({context,capability,method,arguments:args}){
    // This is an internal-only invocation seam. Native owners still perform
    // plan approval, exact MCP policy, controller lease and revision checks.
    find(store.read(),'projects',context.projectId);
    if(capability==='provider'&&method==='dispatch')find(store.read(),'tasks',args.taskId,context.projectId);
    if(args.connectionId)find(store.read(),'connections',args.connectionId,context.projectId);
    if(args.runId)find(store.read(),'runs',args.runId,context.projectId);
    if(args.targetId)find(store.read(),'desktopTargets',args.targetId,context.projectId);
    return true;
  }});
  async function defaults(projectId){
    // Only precompiled first-party modules receive initial defaults. Existing
    // explicit Off bindings survive startup and can never be re-enabled here.
    for(const capability of ['models','provider','mcp','skills','environment','desktop','browser']){
      const pluginId='forge.'+capability;
      if(store.read().events.some(e=>e.type==='plugin.binding'&&e.projectId===projectId&&e.pluginId===pluginId&&e.scope.kind==='project'))continue;
      await service.enable({projectId,pluginId,expectedRevision:0,operationId:`builtin-default:${projectId}:${pluginId}`});
    }
  }
  function check(state,input,capabilities=['provider']){
    const selection=service.check({projectId:input.projectId,...(input.taskId?{taskId:input.taskId}:{}),...(input.botId?{agentId:input.botId}:{}),...(input.conversationId?{sessionId:input.conversationId}:{}),requires:capabilities.map(capability=>({capability,version:'^1.0.0'}))},state);
    const providerConfig=selection.plugins.find(p=>p.pluginId==='forge.provider')?.config;
    const selected=input.assistanceContext?.selection??find(state,'projects',input.projectId).profile?.provider;
    if(providerConfig?.providerInstanceId&&selected?.instanceId!==providerConfig.providerInstanceId)fail('SCOPE','Selected provider is outside the scoped capability configuration',403);
    return selection;
  }
  return {service,defaults,check};
}
