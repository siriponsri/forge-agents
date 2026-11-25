import path from 'node:path';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {find,fail} from './domain.mjs';
import {digest,bytesDigest} from '../guarded-runtime/profile.mjs';
import {fileDigest} from '../guarded-runtime/file-digest.mjs';
import {routeById} from '../providers/routes.mjs';
import {proactiveEnforcementRequest} from '../proactive/enforcement.mjs';
import {checkEnvelope,record} from '../proactive/contracts.mjs';

// Root-only policy/credential adapter. It cannot mint a native enforcement proof.
export function guardedRequest(s,input){
  const request=proactiveEnforcementRequest(s,input);if(!request)return null;
  const version=record(s,'version',input.proactiveContext.versionId,input.projectId),b=version.definition.budget;
  return {...request,limits:{maxRunMs:b.maxRunMs,maxTokens:b.maxTokens,maxCost:b.maxCost}};
}
export function assertGuardedOwner(s,{input,run}){
  if(!input?.proactiveContext)fail('GUARDED_RECIPE_REQUIRED','Approve a bounded Proactive recipe before using this route',409);
  const c=input.proactiveContext,recipe=record(s,'recipe',c.recipeId,input.projectId),version=checkEnvelope(s,recipe,Date.now),o=record(s,'occurrence',c.occurrenceId,input.projectId);
  if(c.versionId!==version.id||c.grantId!==recipe.grant.id||o.operationId!==input.operationId||o.taskId!==input.taskId||!o.held||o.stopRequested||!['dispatching','dispatched','unknown'].includes(o.status)||Date.now()>=o.deadlineAt||digest(o.context)!==digest(c)||run&&(run.operationId!==o.operationId||o.runId!==null&&o.runId!==run.id))fail('GUARDED_GRANT_CHANGED','The exact recipe grant no longer owns this attempt',409);
  return true;
}
const appRoot=fileURLToPath(new URL('../',import.meta.url));
function moduleGeneration(){
  const files=[];
  function walk(directory){for(const name of readdirSync(directory).sort()){
    const target=path.join(directory,name),stat=lstatSync(target);
    if(stat.isSymbolicLink())fail('GUARDED_MODULE_LINK','Private enforcement source must not follow links',409);
    if(stat.isDirectory())walk(target);
    else if(/\.(mjs|ts|json|cs)$/.test(name)){if(!stat.isFile()||stat.nlink!==1)fail('GUARDED_MODULE_LINK');files.push({name:path.relative(appRoot,target).replaceAll('\\','/'),sha256:fileDigest(target)});}
  }}
  for(const directory of ['guarded-runtime','research-native','research-components','frontend-tools','server'])walk(path.join(appRoot,directory));
  return digest(files);
}
function regular(file){
  for(let p=file;;p=path.dirname(p)){const st=lstatSync(p);if(st.isSymbolicLink())fail('GUARDED_CONFIG_LINK','Guarded configuration must not follow links',409);if(p===path.dirname(p))break;}
  const st=lstatSync(file);if(!st.isFile()||st.nlink!==1||st.size>131072)fail('GUARDED_CONFIG_INVALID','Use the provider configuration created by FORGE',409);
  return readFileSync(file);
}
export function createGuardedPolicy({store,dataDir,secrets,providers,artifacts}){
  const cache=new Map(),generation=moduleGeneration();
  const assertGeneration=()=>{if(moduleGeneration()!==generation)fail('GUARDED_MODULE_CHANGED','Restart with the verified private enforcement generation',409);return generation;};
  function selected(s,projectId){
    const p=find(s,'projects',projectId),selection=p.profile?.provider;
    if(!selection?.connectionId)fail('GUARDED_PROVIDER_REQUIRED','Select a connected API model in Settings first',409);
    const c=find(s,'connections',selection.connectionId,projectId),route=routeById(c.config?.routeId);
    if(route.mode!=='opencode-api'||c.enabled===false||c.config?.setupStatus!=='configured')fail('GUARDED_ROUTE_UNSUPPORTED','The initial Guarded route requires a configured compatible chat API',409);
    providers.validateSelection({projectId,connectionId:c.id,selection});
    return {p,c,selection};
  }
  function observe(s,{projectId}){
    const {p,c,selection}=selected(s,projectId),cached=cache.get(projectId);
    if(!cached||cached.connection!==digest(c)||cached.selection!==digest(selection)||cached.stamp!==secrets.bindingStamp()||cached.envName&&process.env[cached.envName]!==cached.envValue||bytesDigest(regular(cached.configPath))!==cached.configHash)fail('GUARDED_ROUTE_CHECK_REQUIRED','Check the exact selected route again after credential or configuration changes',409);
    const policyGeneration=digest({profile:p.profile,policies:s.events.filter(e=>e.projectId===projectId&&['governance.policy','plugin.binding'].includes(e.type))});
    return {route:{providerInstanceId:c.providerInstanceId,apiProviderId:cached.apiProviderId,providerImplementation:'opencode2-api',accountGeneration:cached.accountGeneration,modelId:selection.model,options:selection.options??[],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:cached.t3Hash,opencodeBinarySha256:cached.opencodeHash},policyGeneration,toolGeneration:digest({modules:assertGeneration(),broker:cached.brokerHash})};
  }
  return {
    async refresh({projectId}){
      assertGeneration();
      const before=store.read(),{c,selection}=selected(before,projectId),connection=digest(c),stamp=secrets.bindingStamp();
      if(!/^[A-Za-z0-9_-]+$/.test(c.providerInstanceId))fail('GUARDED_PROVIDER_ID','Invalid configured provider identity',409);
      const configPath=path.join(dataDir,'providers',c.providerInstanceId,'config','opencode','opencode.json'),raw=regular(configPath),config=JSON.parse(raw);
      const apiProviderId=selection.model.slice(0,selection.model.indexOf('/')),model=selection.model.slice(selection.model.indexOf('/')+1),definition=config.providers?.[apiProviderId];
      if(apiProviderId!=='forge'||!model||definition?.package!=='@opencode/ai/providers/openai-compatible'||definition.models?.[model]?.modelID!==model||definition.settings?.apiKey!==`{env:${c.config.apiKeyEnv}}`)fail('GUARDED_TRANSPORT_UNSUPPORTED','This bounded route supports explicitly configured OpenAI-compatible chat models only',409);
      const url=new URL(definition.settings.baseURL);if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))fail('GUARDED_ENDPOINT_INVALID','Use a documented HTTPS or loopback chat endpoint',409);
      const metadata=(await secrets.list({projectId,purpose:'provider'})).secrets.find(r=>r.envName===c.config.apiKeyEnv),image=await artifacts();
      if(!image)fail('GUARDED_SETUP_REQUIRED','Install the private bounded runtime in Settings first',409);
      if(stamp!==secrets.bindingStamp()||digest(find(store.read(),'connections',c.id,projectId))!==connection)fail('GUARDED_CREDENTIAL_CHANGED','Credential changed during setup',409);
      const accountGeneration=digest({connection:c.config.generation,reference:metadata?.reference??`env:${c.config.apiKeyEnv}`,revision:metadata?.revision??null,generation:metadata?.generation??null,stamp});
      cache.set(projectId,{connection,selection:digest(selection),stamp,configPath,configHash:bytesDigest(raw),apiProviderId,model,baseURL:url.href,metadata,accountGeneration,...(!metadata?{envName:c.config.apiKeyEnv,envValue:process.env[c.config.apiKeyEnv]}:{}),t3Hash:digest(image.t3.files.map(f=>({name:f.name,sha256:fileDigest(f.path)})).sort((a,b)=>a.name.localeCompare(b.name))),opencodeHash:fileDigest(image.opencode.path),brokerHash:fileDigest(image.fileBroker.path)});
      return observe(store.read(),{projectId});
    },
    observe,
    async resolve(input,{selected:choice}){
      const {c}=selected(store.read(),input.projectId),entry=cache.get(input.projectId);
      if(digest(choice)!==digest(observe(store.read(),input)))fail('GUARDED_ROUTE_CHANGED','Selected route changed',409);
      const apiKey=await secrets.resolveEnv({projectId:input.projectId,purpose:'provider',name:c.config.apiKeyEnv,...(entry.metadata?{expectedRevision:entry.metadata.revision,generation:entry.metadata.generation}:{})});
      if(digest(choice)!==digest(observe(store.read(),input)))fail('GUARDED_CREDENTIAL_CHANGED','Credential changed during preparation',409);
      return {provider:{id:entry.apiProviderId,model:entry.model,compatibility:{streamUsage:true},settings:{baseURL:entry.baseURL,apiKey,transport:'http'}},credentialRef:entry.metadata?.reference??`env:${c.config.apiKeyEnv}`,accountGeneration:entry.accountGeneration};
    },
    invalidate(projectId){if(projectId)cache.delete(projectId);else cache.clear();},
  };
}
