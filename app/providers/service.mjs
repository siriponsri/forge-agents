import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { changed, digest, entity, fail, find, required, safeError, source, busy } from './common.mjs';
import { routes, routeById, envName } from './routes.mjs';
import { createProviderCatalog } from './catalog.mjs';
import { createConversationService } from './conversations.mjs';
import { createMcpService } from './mcp.mjs';
import {compileKobApiConfig,discoverKobModels} from './kob-api.mjs';

export function createProviderService({dataDir,store,t3,clock=Date.now,catalogTimeoutMs=1500,authorizeTool,validateAdmission,mcpTransportOptions,resolveEnv,mcpCredentialVersion,checkCapabilities,prepareCapabilities,onNotDispatched}){
  if(!dataDir||!store||!t3)throw new Error('dataDir, store and the owned T3 service are required');
  const catalogs=createProviderCatalog({store,t3,clock,timeoutMs:catalogTimeoutMs});
  const scoped=({projectId,connectionId},s=store.read())=>{find(s,'projects',required(projectId,'projectId'));const c=find(s,'connections',connectionId,projectId);if(c.kind!=='provider')fail('SCOPE','Expected provider connection',409);return c;};
  async function rpc(tag,payload){if(!t3.providers?.rpc)fail('SETUP_UNAVAILABLE','Provider management channel unavailable; integrate the pinned T3 setup shim',409);return t3.providers.rpc(tag,payload);}
  const api={
    routes:()=>structuredClone(routes.map(r=>({...r,implementation:r.implemented===false?'UNSUPPORTED_CONTRACT':'T3-owned setup and turns',live:'NOT_RUN'}))),
    health:()=>({...source,turnOwner:'T3',externalAccounts:'NOT_RUN',setupAvailable:!!t3.providers?.rpc}),
    async configure(input){
      const operationId=required(input.operationId,'operationId'),route=routeById(input.routeId);find(store.read(),'projects',required(input.projectId,'projectId'));
      const allowed=['operationId','projectId','routeId','name','executable','args','envRefs','apiKeyEnv','baseURL','apiFamily','models'];
      if(Object.keys(input).some(k=>!allowed.includes(k)))fail('SETUP_INPUT','Only executable and machine environment references are accepted; never send credential values');
      if(input.envRefs!==undefined&&(!Array.isArray(input.envRefs)||input.envRefs.some(n=>!envName(n))))fail('SECRET_REFERENCE','Use machine environment variable names only');
      if(input.args!==undefined&&(route.id!=='custom-acp'||!Array.isArray(input.args)||input.args.length>32||input.args.some(a=>typeof a!=='string'||a.length>1024||/[\r\n\0]/.test(a))))fail('SETUP_INPUT','Only custom ACP permits literal argument rows');
      if(input.args?.some(a=>/(?:api[-_]?key|token|password|authorization|bearer|credential)(?:=|\b)/i.test(a)))fail('SECRET_REFERENCE','Pass credentials through machine environment references, never command arguments');
      const executable=input.executable===undefined?undefined:required(input.executable,'executable');
      if(executable&&(/[\r\n\0]/.test(executable)||executable.length>1024))fail('SETUP_INPUT','Invalid executable');
      if(route.id==='custom-acp'&&!executable)fail('SETUP_INPUT','Select an installed ACP executable');
      let apiConfig;
      if(route.id==='kob')apiConfig=compileKobApiConfig({baseURL:input.baseURL??route.baseURL,apiKeyEnv:input.apiKeyEnv,models:input.models}).opencodeConfig;
      else if(route.mode==='opencode-api'){
        if(!envName(input.apiKeyEnv))fail('SECRET_REFERENCE','Choose a machine environment variable for this API key');
        const base=new URL(required(input.baseURL??route.baseURL,'exact API base URL'));
        if(base.username||base.password||base.search||base.hash||base.protocol!=='https:'&&!(['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&base.protocol==='http:'))fail('API_URL','Use HTTPS or a local test endpoint, without credentials/query/fragment');
        const family=route.apiFamily??input.apiFamily;
        const packages={'chat-completions':'@opencode/ai/providers/openai-compatible',responses:'@opencode/ai/providers/openai-compatible/responses','anthropic-messages':'@opencode/ai/providers/anthropic-compatible',openrouter:'@opencode/ai/providers/openrouter'};
        if(!packages[family]||route.apiFamily&&input.apiFamily&&route.apiFamily!==input.apiFamily)fail('API_PROTOCOL','Select the documented API family for this endpoint');
        if(input.models!==undefined&&(!Array.isArray(input.models)||input.models.length>100||input.models.some(m=>typeof m!=='string'||!m.trim()||m.length>256||/[\r\n\0{}]/.test(m))))fail('MODEL_INPUT','Use literal upstream model IDs');
        if(route.id!=='openrouter'&&!input.models?.length)fail('MODEL_INPUT','Enter explicit upstream model IDs; discovery must subsequently confirm the T3 catalog');
        apiConfig={update:'disable',providers:{[route.id==='openrouter'?'openrouter':'forge']:{name:route.brand,env:[input.apiKeyEnv],package:packages[family],settings:{baseURL:base.href,apiKey:`{env:${input.apiKeyEnv}}`},...(input.models?.length?{models:Object.fromEntries(input.models.map(m=>[m,{modelID:m,name:m}]))}:{})}}};
      }else if(['apiKeyEnv','baseURL','apiFamily','models'].some(k=>input[k]!==undefined))fail('SETUP_INPUT','API fields apply only to an OpenCode API route');
      const fingerprint=digest(input);let replay;
      const c=await store.transaction(s=>{const prior=s.receipts.find(r=>r.operationId===operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Setup operation belongs to another configuration',409);replay=true;return find(s,'connections',prior.connectionId,input.projectId);}
        if(s.runs.some(r=>r.operationId===operationId)||s.events.some(r=>r.operationId===operationId))fail('OPERATION_REUSE','Operation belongs to other work',409);
        const c=entity({name:input.name??route.brand,kind:'provider',enabled:true,route:'t3',config:{routeId:route.id,accountRoute:route.authRoute,generation:1,envRefs:input.envRefs??(input.apiKeyEnv?[input.apiKeyEnv]:[]),...(apiConfig?{baseURL:apiConfig.providers.forge?.settings.baseURL??input.baseURL??route.baseURL,apiKeyEnv:input.apiKeyEnv}:{}),setupStatus:'submitting'},providerInstanceId:`forge_${digest(operationId).slice(0,32)}`},input.projectId);
        s.connections.push(c);s.receipts.push({operationId,fingerprint,type:'provider.configure',connectionId:c.id,status:'submitting',projectId:input.projectId});return c;});
      if(replay)return c;
      const root=path.join(dataDir,'providers',c.providerInstanceId);
      try{
      await mkdir(root,{recursive:true});
      // Fresh account homes, no migration/shadow of development credentials.
      const environment=Object.entries({XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache'),HOME:root,USERPROFILE:root}).map(([name,value])=>({name,value,sensitive:false}));
      let config={enabled:true};
      if(route.driver==='codex')config={...config,setupMode:route.id==='codex-managed'?'managed':'existing',homePath:path.join(root,'codex'),...(executable?{binaryPath:executable}:{})};
      else if(route.driver==='claudeAgent')config={...config,homePath:path.join(root,'claude'),...(executable?{binaryPath:executable}:{})};
      else if(route.driver==='opencode')config={...config,...(executable?{binaryPath:executable}:{})};
      else config={...config,source:'local',commandPath:executable??route.command,commandArgs:input.args??route.args??[],agentId:''};
      // Never let a native adapter fall back to an owner's existing account home.
      await mkdir(config.homePath??root,{recursive:true});
      if(apiConfig){const configDir=path.join(root,'.config','opencode');await mkdir(configDir,{recursive:true});await writeFile(path.join(configDir,'opencode.json'),JSON.stringify(apiConfig,null,2),{flag:'wx',mode:0o600});const xdgDir=path.join(root,'config','opencode');await mkdir(xdgDir,{recursive:true});await writeFile(path.join(xdgDir,'opencode.json'),JSON.stringify(apiConfig,null,2),{flag:'wx',mode:0o600});}
        await t3.providers?.assertEnvironment?.(c);
        await rpc('server.updateSettings',{patch:{},providerInstanceMutation:{operation:'create',instanceId:c.providerInstanceId,instance:{driver:route.driver,displayName:c.name,enabled:true,config,environment}}});
        await store.transaction(s=>{const x=scoped({projectId:c.projectId,connectionId:c.id},s);x.config.setupStatus='configured';changed(x);s.receipts.find(r=>r.operationId===operationId).status='completed';});
      }catch(error){await store.transaction(s=>{const x=scoped({projectId:c.projectId,connectionId:c.id},s);x.config.setupStatus='unknown';x.setupError=safeError(error);changed(x);s.receipts.find(r=>r.operationId===operationId).status='unknown';});}
      return scoped({projectId:c.projectId,connectionId:c.id});
    },
    async discoverModels(input){
      const c=scoped(input),key=digest([c.revision,c.config,c.providerInstanceId]);if(c.config?.routeId!=='kob')fail('ROUTE_UNAVAILABLE','Direct API discovery is available for KOB; use T3 catalog for other providers',409);
      const result=await discoverKobModels({baseURL:c.config.baseURL,apiKeyEnv:c.config.apiKeyEnv},{...(resolveEnv?{resolveEnv:name=>resolveEnv(name,c)}:{})});
      await store.transaction(s=>{const current=scoped(input,s);if(digest([current.revision,current.config,current.providerInstanceId])!==key)fail('CONNECTION_CHANGED','Provider changed during discovery; discard this result and retry explicitly',409);current.apiModelDiscovery=result;changed(current);});
      return {...result,selectionAuthority:'Refresh and select the actual T3 instance catalog; API discovery does not qualify a T3 run.'};
    },
    async previewModels(input){
      if(Object.keys(input).some(k=>!['projectId','baseURL','apiKeyEnv'].includes(k)))fail('SETUP_INPUT','Preview accepts project, endpoint and saved key name only');find(store.read(),'projects',input.projectId);
      const scope={projectId:input.projectId,kind:'provider'},key=resolveEnv?await resolveEnv(input.apiKeyEnv,scope):undefined;
      const result=await discoverKobModels({baseURL:input.baseURL,apiKeyEnv:input.apiKeyEnv},{...(resolveEnv?{resolveEnv:()=>key}:{})});
      if(resolveEnv&&await resolveEnv(input.apiKeyEnv,scope)!==key)fail('CREDENTIAL_CHANGED','Key changed during discovery. Discard this preview and request it again.',409);return result;
    },
    async check(input){
      const c=scoped(input);let result;
      try{await t3.providers?.assertEnvironment?.(c);const response=await rpc('server.refreshProviders',{instanceId:c.providerInstanceId,fresh:true});const p=response.providers?.find(p=>p.instanceId===c.providerInstanceId);if(!p)fail('ROUTE_UNAVAILABLE','Instance missing',409);
        result={checkedAt:clock(),providerInstanceId:p.instanceId,driver:p.driver,installed:p.installed,enabled:p.enabled,authentication:p.auth?.status??'unknown',status:p.status,version:p.version??null,canInstall:p.setup?.canInstall??false,canAuthenticate:p.setup?.canAuthenticate??false,live:'Dependency/auth status only; model execution NOT_RUN'};
        if(routes.find(r=>r.id===c.config.routeId)?.mode==='opencode-api'&&!/^2\./.test(p.version??'')){result.status='unsupported-version';result.error={code:'OPENCODE_VERSION',message:'This API configuration uses OpenCode 2.x. Select a 2.x executable; v1 is a different configuration contract.'};}
      }catch(error){result={checkedAt:clock(),providerInstanceId:c.providerInstanceId,status:'error',error:safeError(error)};}
      await store.transaction(s=>{const x=scoped(input,s);x.lastCheck=result;if(result.driver&&x.config.setupStatus==='unknown')x.config.setupStatus='configured';changed(x);});return result;
    },
    catalog:input=>catalogs.state(input),async refresh(input){const c=scoped(input);if(routes.find(r=>r.id===c.config.routeId)?.mode==='opencode-api'){const check=await api.check(input);if(check.status==='unsupported-version'||check.status==='error')return {...catalogs.state(input),error:check.error};}return catalogs.refresh(input);},validateSelection:input=>{const c=scoped(input);if(routes.find(r=>r.id===c.config.routeId)?.mode==='opencode-api'&&!/^2\./.test(c.lastCheck?.version??''))fail('OPENCODE_VERSION','Check an OpenCode 2.x runtime before selecting this API route',409);return catalogs.validate(input);},
    async select(input){
      const fingerprint=digest(input);required(input.operationId,'operationId');const existing=store.read().receipts.find(r=>r.operationId===input.operationId);if(existing){if(existing.fingerprint!==fingerprint)fail('OPERATION_REUSE','Selection operation reused',409);return existing.result;}const selection=api.validateSelection(input);
      return store.transaction(s=>{const prior=s.receipts.find(r=>r.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Selection operation reused',409);return prior.result;}
        const p=find(s,'projects',input.projectId);if(input.expectedRevision!==p.revision)fail('REVISION_CONFLICT','Reload project settings before selecting',409);
        p.profile={...p.profile,provider:selection};changed(p);s.receipts.push({operationId:input.operationId,fingerprint,type:'provider.select',projectId:p.id,result:selection});return selection;});
    },
    async setup(input){
      const c=scoped(input),actions={install:'provider.install.start','install-status':'provider.install.subscribe','install-cancel':'provider.install.cancel',signin:'provider.auth.start','signin-status':'provider.auth.subscribe','signin-cancel':'provider.auth.cancel',consent:'provider.auth.respond',callback:'provider.auth.complete'};
      const tag=actions[input.action];if(!tag)fail('SETUP_ACTION','Unsupported setup action');
      if(store.read().runs.some(r=>r.providerInstanceId===c.providerInstanceId&&busy(r)))fail('PROVIDER_BUSY','Stop and reconcile this provider’s runs before changing setup',409);
      let payload={instanceId:c.providerInstanceId};
      if(input.action==='signin'&&input.methodId)payload.methodId=required(input.methodId,'methodId');
      if(['signin-cancel','consent','callback'].includes(input.action))payload.flowId=required(input.flowId,'flowId');
      if(input.action==='install-cancel')payload.operationId=required(input.installOperationId,'installOperationId');
      if(input.action==='consent'){if(!['accept','decline'].includes(input.decision))fail('SETUP_INPUT','Use browser accept or decline');payload={...payload,interactionId:required(input.interactionId,'interactionId'),response:{type:'browser',action:input.decision}};}
      if(input.action==='callback')payload.callbackUrl=required(input.callbackUrl,'callbackUrl');
      const readOnly=input.action.endsWith('-status');let replay=false;const fingerprint=digest({...input,callbackUrl:input.callbackUrl?digest(input.callbackUrl):undefined});
      if(!readOnly)await store.transaction(s=>{required(input.operationId,'operationId');const prior=s.receipts.find(r=>r.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Setup operation reused',409);replay=true;return;}if(s.runs.some(r=>r.operationId===input.operationId)||s.events.some(r=>r.operationId===input.operationId))fail('OPERATION_REUSE','Operation belongs to other work',409);s.receipts.push({operationId:input.operationId,fingerprint,type:'provider.setup',projectId:c.projectId,connectionId:c.id,status:'submitting'});});
      if(replay)return {status:'already-submitted',nextAction:'Check setup status; never repeat uncertain sign-in/install actions.'};
      try{
        const v=await rpc(tag,payload);const interaction=v.interaction;let publicInteraction;
        if(interaction&&['browser','deviceCode'].includes(interaction.type)){
          const url=new URL(interaction.url);if(!['http:','https:'].includes(url.protocol))fail('SETUP_URL','Invalid provider sign-in URL',502);
          publicInteraction={type:interaction.type,id:interaction.id,url:url.href,requiresConsent:interaction.requiresConsent??false,acceptsCallback:interaction.acceptsCallback??false,...(interaction.userCode?{userCode:interaction.userCode}:{})};
        }else if(interaction)publicInteraction={type:interaction.type,requiresNativeUi:true};
        // Transient sign-in data is returned only; never store OAuth URLs/codes,
        // terminal output, method email or callback content in domain snapshots.
        const authUrl=v.authorizationUrl?new URL(v.authorizationUrl):null;if(authUrl&&!['http:','https:'].includes(authUrl.protocol))fail('SETUP_URL','Invalid authorization URL',502);
        const result={instanceId:c.providerInstanceId,phase:v.phase,flowId:v.flowId??null,installOperationId:v.operationId??null,methods:v.methods?.map(m=>({id:m.id,name:m.name,type:m.type})),interaction:publicInteraction,authorizationUrl:authUrl?.href??null,expiresAt:v.expiresAt??null};
        if(!readOnly)await store.transaction(s=>{const r=s.receipts.find(r=>r.operationId===input.operationId);r.status='accepted';});
        return result;
      }catch(error){const err=safeError(error);if(!readOnly)await store.transaction(s=>{const r=s.receipts.find(r=>r.operationId===input.operationId);r.status='unknown';r.error=err;});return {status:'unknown',error:err};}
    },
    settle:()=>catalogs.settle(),
  };
  api.conversations=createConversationService({store,t3,providers:api,checkCapabilities,prepareCapabilities,onNotDispatched});
  api.mcp=createMcpService({store,authorizeTool,validateAdmission,transportOptions:mcpTransportOptions,resolveCredential:resolveEnv,credentialVersion:mcpCredentialVersion,checkCapability:input=>checkCapabilities?.(store.read(),input,['mcp'])});
  api.close=async()=>{await api.settle();await api.conversations.close();await api.mcp.close();};
  return api;
}
