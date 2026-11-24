import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { auth, discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, extractWWWAuthenticateParams, exchangeAuthorization, refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientInformationSchema, OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { createWindowsVault } from '../storage/auth.mjs';
import { changed, digest, fail, find, required } from './common.mjs';
import { boundedResponse, callbackBase, checkNetwork, endpoint, oauthFailure, safeOAuthError, urlValue } from './mcp-oauth-policy.mjs';

const TTL = 10 * 60 * 1000;
const LIVE = 'NOT_RUN';
const sessionHash = value => digest(required(value,'server-owned sessionId'));
const sameIssuer = (a,b) => new URL(a).href === new URL(b).href;

/** Machine-local OAuth owner only. It never creates an MCP client or invokes tools.
 * The HTTP host supplies a server-owned sessionId at begin/callback/disconnect.
 * authProviderFor is an SDK OAuthClientProvider; use transportOptions to also
 * install the mandatory discovery/token network guard on the SDK transport.
 */
export function createMcpOAuthService({ dataDir, store, callbackOrigin, vault } = {}) {
  const redirectUrl = callbackBase(callbackOrigin);
  const installation = digest(path.resolve(required(dataDir,'dataDir')));
  const directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'FORGE','secrets','mcp');
  const relative = path.relative(path.resolve(dataDir),directory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('OAUTH_STORAGE','MCP vault must be outside portable application state');
  vault ??= process.platform === 'win32' ? createWindowsVault({directory}) : null;
  const pending=new Map(), runtimes=new Map(), locks=new Map(), controllers=new Set();
  let closed=false;

  function scoped(input, state=store.read(), enabled=true) {
    if(closed)fail('CLOSED','MCP OAuth service is closed',409);
    find(state,'projects',required(input.projectId,'projectId'));
    const c=find(state,'connections',required(input.connectionId??input.id,'connectionId'),input.projectId);
    if(c.kind!=='mcp'||c.route!=='http')fail('SCOPE','OAuth applies to an HTTP MCP connection',409);
    if(enabled && c.enabled===false)fail('DISABLED','Enable this MCP connection',409);
    const resource=urlValue(c.url); endpoint(resource,resource);
    return c;
  }
  const context=c=>({projectId:c.projectId,connectionId:c.id});
  const binding=c=>({installation,projectId:c.projectId,connectionId:c.id,resource:urlValue(c.url).href,redirectUrl,reference:c.config?.auth?.reference});
  function current(runtime, enabled=true) {
    if(runtime.revoked)fail('CONNECTION_CHANGED','OAuth credentials have been disconnected',409);
    const c=scoped(runtime.context,store.read(),enabled);
    if(digest(binding(c))!==runtime.key || c.config?.auth?.kind!=='oauth') fail('CONNECTION_CHANGED','Connection changed during sign-in',409);
    return c;
  }
  function exclusive(key,fn) {
    const task=(locks.get(key)??Promise.resolve()).catch(()=>{}).then(fn);
    locks.set(key,task);
    task.finally(()=>{if(locks.get(key)===task)locks.delete(key);}).catch(()=>{});
    return task;
  }
  function requireVault() { if(!vault?.get || !vault?.set)fail('OAUTH_STORAGE','An OS credential vault is required',409); }
  async function readRecord(r) {
    current(r); requireVault();
    if(!r.loaded) {
      r.loaded=(async()=>{
        let raw; try { raw=await vault.get(r.name); } catch { fail('OAUTH_STORAGE','Machine credential vault unavailable',409); }
        if(!raw)return {binding:r.binding};
        let value; try{value=JSON.parse(raw);}catch{fail('OAUTH_STORAGE','Machine OAuth record is invalid',409);}
        if(!value || digest(value.binding)!==digest(r.binding))fail('CONNECTION_CHANGED','OAuth record belongs to another connection or machine',409);
        return value;
      })();
    }
    return r.loaded;
  }
  async function persist(r,patch) {
    // All writes for a record are serialized, including refresh/SDK invalidation.
    return exclusive(`vault:${r.key}`,async()=>{
      const before=await readRecord(r),next={...before,...patch}; current(r);
      try { await vault.set(r.name,JSON.stringify(next)); } catch { fail('OAUTH_STORAGE','Machine credential vault unavailable',409); }
      r.loaded=Promise.resolve(next); current(r); return next;
    });
  }
  function expire(r) {
    for(const [state,p] of pending) if(p.runtime===r && p.expiresAt<=Date.now()) {pending.delete(state);p.verifier=undefined;p.authorizationUrl=undefined;}
  }
  async function mark(r,status) {
    await store.transaction(s=>{
      const c=scoped(r.context,s,false); if(digest(binding(c))!==r.key)fail('CONNECTION_CHANGED','Connection changed during sign-in',409);
      c.config={...c.config,auth:{kind:'oauth',status,reference:r.binding.reference}};
      c.discoveryStale=true; changed(c);
    });
  }
  async function fetchFor(r,input,init={},oauthOnly=false) {
    current(r);
    const target=endpoint(input instanceof Request?input.url:input,r.resource,{query:true});
    const isResource=target.href===r.resource.href && !oauthOnly;
    if(!isResource && target.search)fail('OAUTH_URL','OAuth network endpoints cannot contain query credentials',409);
    await checkNetwork(target,r.resource); current(r);
    const headers=new Headers(init.headers??(input instanceof Request?input.headers:undefined));
    if(!r.interactive && (init.method??'GET').toUpperCase()==='POST') {
      const record=await readRecord(r);
      if(record.discovery?.authorizationServerMetadata?.registration_endpoint===target.href)fail('OAUTH_REQUIRED','Start Connect in Settings to register an OAuth client',409);
    }
    // Never allow a resource bearer header to leak into metadata or AS requests.
    if(!isResource && headers.has('authorization') && !/^Basic /i.test(headers.get('authorization')))fail('OAUTH_URL','Resource credentials cannot be sent to OAuth metadata',409);
    const controller=new AbortController();controllers.add(controller);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000),...(init.signal?[init.signal]:[])]);
    try {
      const response=await fetch(target,{...init,headers,signal,redirect:'manual'});
      if(response.status>=300 && response.status<400) {await response.body?.cancel();fail('OAUTH_URL','OAuth and MCP redirects are not followed',409);}
      // Preserve SSE streaming for MCP; JSON metadata/token/error bodies are bounded.
      if(isResource && response.ok && (response.headers.get('content-type')??'').startsWith('text/event-stream'))return response;
      const bounded=await boundedResponse(response); current(r); return bounded;
    } catch(error) {throw oauthFailure(error);} finally{controllers.delete(controller);}
  }
  function validateDiscovery(r,value) {
    if(!value?.resourceMetadata || !value.authorizationServerMetadata)fail('OAUTH_METADATA','MCP protected resource and authorization metadata are required',409);
    const prm=value.resourceMetadata,md=value.authorizationServerMetadata;
    const resource=endpoint(prm.resource,r.resource);
    if(!checkResourceAllowed({requestedResource:r.resource,configuredResource:resource}))fail('OAUTH_METADATA','Resource does not match selected MCP server',409);
    const issuer=endpoint(value.authorizationServerUrl,r.resource);
    if(!prm.authorization_servers?.some(v=>sameIssuer(v,issuer)) || !sameIssuer(md.issuer,issuer))fail('OAUTH_METADATA','Authorization issuer does not match discovery',409);
    for(const field of ['authorization_endpoint','token_endpoint','registration_endpoint','revocation_endpoint']) if(md[field])endpoint(md[field],r.resource);
    if(!md.code_challenge_methods_supported?.includes('S256') || !md.response_types_supported?.includes('code'))fail('OAUTH_METADATA','Authorization server must advertise PKCE S256 and code response',409);
    if(value.resourceMetadataUrl)endpoint(value.resourceMetadataUrl,r.resource);
    return value;
  }
  async function discover(r) {
    // GET only: obtains WWW-Authenticate hints without initialize/tool effects.
    const response=await fetchFor(r,r.resource,{method:'GET',headers:{Accept:'application/json, text/event-stream'}});
    const hint=extractWWWAuthenticateParams(response); await response.body?.cancel();
    if(hint.resourceMetadataUrl)endpoint(hint.resourceMetadataUrl,r.resource);
    let resourceMetadata,metadata;
    try {
      resourceMetadata=await discoverOAuthProtectedResourceMetadata(r.resource,{resourceMetadataUrl:hint.resourceMetadataUrl},(u,i)=>fetchFor(r,u,i,true));
      if(!resourceMetadata.authorization_servers?.length)fail('OAUTH_METADATA','Protected resource metadata must name an authorization server',409);
      const issuer=endpoint(resourceMetadata.authorization_servers[0],r.resource);
      metadata=await discoverAuthorizationServerMetadata(issuer,{fetchFn:(u,i)=>fetchFor(r,u,i,true)});
      const value=validateDiscovery(r,{resourceMetadata,authorizationServerUrl:issuer.href,authorizationServerMetadata:metadata,resourceMetadataUrl:hint.resourceMetadataUrl?.href});
      return {value,scope:hint.scope};
    } catch(error) {throw oauthFailure(error,'OAUTH_METADATA');}
  }
  function runtimeFor(connection) {
    const c=scoped({...connection,connectionId:connection.id??connection.connectionId});
    if(c.config?.auth?.kind!=='oauth')return undefined;
    const reference=c.config.auth.reference;
    if(typeof reference!=='string'||!/^vault:mcp-[a-f0-9-]{36}$/.test(reference))fail('OAUTH_REQUIRED','Connect MCP OAuth in Settings',409);
    const bound=binding(c),key=digest(bound);
    if(runtimes.has(key))return runtimes.get(key);
    const r={context:context(c),binding:bound,key,name:reference.slice(6),resource:urlValue(c.url),active:undefined,error:undefined};
    const provider={
      get redirectUrl(){return redirectUrl;},
      get clientMetadata(){return {client_name:'FORGE local MCP',redirect_uris:[redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};},
      state(){current(r);expire(r);if(!r.interactive || !r.active || r.active.consumed || r.active.expiresAt<=Date.now())fail('OAUTH_REQUIRED','Start Connect in Settings',409);return r.active.state;},
      async clientInformation(){return structuredClone((await readRecord(r)).client);},
      async saveClientInformation(client){
        const record=await readRecord(r);validateDiscovery(r,record.discovery);
        if(!client.issuer || !sameIssuer(client.issuer,record.discovery.authorizationServerUrl))fail('OAUTH_METADATA','Client issuer mismatch',409);
        if(client.redirect_uris && (client.redirect_uris.length!==1 || client.redirect_uris[0]!==redirectUrl))fail('OAUTH_CALLBACK','Registration returned a different redirect URI',409);
        await persist(r,{client:structuredClone(client)});
      },
      async tokens(){
        const record=await readRecord(r);
        if(!record.tokens)return undefined;
        validateDiscovery(r,record.discovery);
        if(!sameIssuer(record.tokens.issuer,record.discovery.authorizationServerUrl))fail('OAUTH_METADATA','Token issuer mismatch',409);
        // The SDK auth orchestrator already refreshes during explicit begin;
        // proactive transport refresh must not rotate that token a second time.
        if(!r.interactive && record.expiresAt && record.expiresAt<=Date.now()+10000) return refresh(r);
        return structuredClone(record.tokens);
      },
      async saveTokens(tokens){
        const record=await readRecord(r);validateDiscovery(r,record.discovery);
        let parsed;try{parsed=OAuthTokensSchema.parse(tokens);}catch{fail('OAUTH_METADATA','Invalid OAuth token response',409);}
        if(!parsed.access_token || !/^Bearer$/i.test(parsed.token_type) || !parsed.issuer || !sameIssuer(parsed.issuer,record.discovery.authorizationServerUrl) || (parsed.expires_in!==undefined && (!Number.isFinite(parsed.expires_in)||parsed.expires_in<=0)))fail('OAUTH_METADATA','Invalid OAuth token response',409);
        await persist(r,{tokens:parsed,expiresAt:parsed.expires_in?Date.now()+parsed.expires_in*1000:undefined});
        r.error=undefined;await mark(r,'connected');
      },
      async redirectToAuthorization(url){
        current(r);expire(r);
        const p=r.active,record=await readRecord(r);validateDiscovery(r,record.discovery);
        const actual=endpoint(url,r.resource,{query:true}),expected=endpoint(record.discovery.authorizationServerMetadata.authorization_endpoint,r.resource);
        if(!r.interactive || !p || p.consumed || p.expiresAt<=Date.now() || actual.origin!==expected.origin || actual.pathname!==expected.pathname || actual.searchParams.get('state')!==p.state || actual.searchParams.get('redirect_uri')!==redirectUrl || actual.searchParams.get('code_challenge_method')!=='S256' || actual.searchParams.get('client_id')!==record.client?.client_id || actual.searchParams.has('access_token') || actual.searchParams.has('client_secret'))fail('OAUTH_CALLBACK','Unexpected authorization redirect',409);
        await checkNetwork(actual,r.resource);current(r);p.authorizationUrl=actual.href;
      },
      saveCodeVerifier(verifier){current(r);if(!r.interactive || !r.active || r.active.consumed)fail('OAUTH_STATE','No active sign-in',409);r.active.verifier=verifier;},
      codeVerifier(){current(r);expire(r);if(!r.active?.verifier || r.active.expiresAt<=Date.now())fail('OAUTH_STATE','Sign-in expired',409);return r.active.verifier;},
      async discoveryState(){const record=await readRecord(r);return record.discovery?structuredClone(validateDiscovery(r,record.discovery)):undefined;},
      async saveDiscoveryState(value){await persist(r,{discovery:structuredClone(validateDiscovery(r,value))});},
      async invalidateCredentials(scope){
        const patch=scope==='all'?{client:undefined,tokens:undefined,expiresAt:undefined,discovery:undefined}:scope==='client'?{client:undefined}:scope==='tokens'?{tokens:undefined,expiresAt:undefined}:scope==='discovery'?{discovery:undefined}:{};
        if(scope==='verifier'||scope==='all') {if(r.active)r.active.verifier=undefined;}
        await persist(r,patch);
        if(['tokens','all'].includes(scope))await mark(r,'required');
      },
    };
    r.provider=provider;runtimes.set(key,r);return r;
  }
  async function refresh(r) {
    if(r.refreshing)return r.refreshing;
    r.refreshing=(async()=>{
      const record=await readRecord(r);validateDiscovery(r,record.discovery);
      if(!record.tokens?.refresh_token || !record.client)fail('OAUTH_REFRESH','Reconnect this MCP connection',409);
      try {
        const tokens=await refreshAuthorization(record.discovery.authorizationServerUrl,{metadata:record.discovery.authorizationServerMetadata,clientInformation:record.client,refreshToken:record.tokens.refresh_token,resource:record.discovery.resourceMetadata.resource,fetchFn:(u,i)=>fetchFor(r,u,i,true)});
        await r.provider.saveTokens({...tokens,issuer:record.discovery.authorizationServerUrl});
        return structuredClone((await readRecord(r)).tokens);
      } catch(error) {
        r.error=safeOAuthError(error,'OAUTH_REFRESH');
        await persist(r,{tokens:undefined,expiresAt:undefined});await mark(r,'required');
        throw oauthFailure(error,'OAUTH_REFRESH');
      }
    })();
    try{return await r.refreshing;}finally{r.refreshing=undefined;}
  }
  async function operation(input,kind,fn) {
    const c=scoped(input,store.read(),kind!=='disconnect'),operationId=required(input.operationId,'operationId');sessionHash(input.sessionId);
    const fingerprint=digest({kind,projectId:c.projectId,connectionId:c.id,session:sessionHash(input.sessionId),clientInformationEnv:input.clientInformationEnv});
    return exclusive(`connection:${c.projectId}:${c.id}`,async()=>{
      const prior=store.read().receipts.find(r=>r.operationId===operationId);
      if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','OAuth setup operation reused',409);return {...await api.status(input),alreadySubmitted:true};}
      await store.transaction(s=>{
        scoped(input,s,kind!=='disconnect');
        if(s.receipts.some(r=>r.operationId===operationId)||s.runs.some(r=>r.operationId===operationId)||s.events.some(r=>r.operationId===operationId))fail('OPERATION_REUSE','Operation belongs to other work',409);
        s.receipts.push({operationId,fingerprint,type:`mcp.oauth.${kind}`,projectId:c.projectId,connectionId:c.id,status:'submitted'});
      });
      return fn();
    });
  }
  const api={
    async begin(input){
      return operation(input,'begin',async()=>{
        requireVault();let c=scoped(input);
        if(c.config?.authEnv)fail('OAUTH_REQUIRED','Remove the bearer environment reference before selecting OAuth',409);
        // Begin owns a new state even when superseding a previous window/session.
        for(const [key,p] of pending)if(p.runtime.context.connectionId===c.id){pending.delete(key);p.verifier=undefined;}
        await store.transaction(s=>{const x=scoped(input,s);x.config={...x.config,auth:{kind:'oauth',status:'connecting',reference:x.config?.auth?.reference??`vault:mcp-${randomUUID()}`}};x.discoveryStale=true;changed(x);});
        c=scoped(input);const r=runtimeFor(c);
        const state=randomBytes(32).toString('base64url'),p={state,runtime:r,session:sessionHash(input.sessionId),expiresAt:Date.now()+TTL,consumed:false};
        r.active=p;pending.set(state,p);
        try {
          const {value,scope}=await discover(r);await r.provider.saveDiscoveryState(value);
          if(input.clientInformationEnv!==undefined){
            if(typeof input.clientInformationEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(input.clientInformationEnv))fail('OAUTH_REGISTRATION_REQUIRED','Use a machine environment name',409);
            let client;try{client=OAuthClientInformationSchema.parse(JSON.parse(process.env[input.clientInformationEnv]??''));}catch{fail('OAUTH_REGISTRATION_REQUIRED','Machine OAuth client information is missing or invalid',409);}
            await r.provider.saveClientInformation(client);
          }
          if(!(await r.provider.clientInformation()) && !value.authorizationServerMetadata.registration_endpoint)fail('OAUTH_REGISTRATION_REQUIRED','Pre-registered client required',409);
          r.interactive=true;
          let result;try{result=await auth(r.provider,{serverUrl:r.resource,scope,fetchFn:(u,i)=>fetchFor(r,u,i,true)});}finally{r.interactive=false;}
          if(result==='REDIRECT')await mark(r,'awaiting-authorization');
          else {pending.delete(state);p.verifier=undefined;r.active=undefined;}
          return {...await api.status(input),...(result==='REDIRECT'?{authorizationUrl:p.authorizationUrl,expiresAt:new Date(p.expiresAt).toISOString()}:{} )};
        } catch(error){
          pending.delete(state);p.verifier=undefined;r.active=undefined;r.error=safeOAuthError(error);
          await mark(r,'required').catch(()=>{});throw oauthFailure(error);
        }
      });
    },
    async status(input){
      const c=scoped(input,store.read(),false),auth=c.config?.auth;
      if(auth?.kind!=='oauth')return {status:'not-configured',auth:{kind:'none',status:'not-configured'},live:LIVE};
      const r=runtimes.get(digest(binding(c)));if(r)expire(r);
      let status=c.enabled===false?'disabled':auth.status??'required';
      if(['connecting','awaiting-authorization'].includes(status) && (!r?.active || !pending.has(r.active.state)))status='required';
      // Connected denotes stored credentials, never a qualified remote tool call.
      if(status==='connected') {
        try{const runtime=runtimeFor(c),record=await readRecord(runtime);if(!record.tokens)status='required';}
        catch(error){status='required';return {status,auth:{kind:'oauth',status,reference:auth.reference},error:safeOAuthError(error),live:LIVE};}
      }
      return {status,auth:{kind:'oauth',status,reference:auth.reference},...(r?.error?{error:r.error}:{}),live:LIVE};
    },
    async callback({callbackUrl,sessionId,projectId,connectionId}){
      const url=urlValue(callbackUrl,{query:true}),expected=new URL(redirectUrl);
      if(url.origin!==expected.origin || url.pathname!==expected.pathname)fail('OAUTH_CALLBACK','Incorrect callback origin or path',409);
      if([...url.searchParams.keys()].some(k=>!['state','code','error','error_description','error_uri','iss'].includes(k)))fail('OAUTH_CALLBACK','Unexpected OAuth callback field',409);
      for(const key of ['state','code','error','iss'])if(url.searchParams.getAll(key).length>1)fail('OAUTH_CALLBACK','Duplicate OAuth callback field',409);
      const state=url.searchParams.get('state'),p=pending.get(state);
      if(!p || p.consumed || p.expiresAt<=Date.now() || p.session!==sessionHash(sessionId) || (projectId && projectId!==p.runtime.context.projectId) || (connectionId && connectionId!==p.runtime.context.connectionId))fail('OAUTH_STATE','OAuth callback expired or belongs to another session',409);
      // Consume before any await: parallel callbacks cannot exchange twice.
      p.consumed=true;pending.delete(state);
      const r=p.runtime;
      return exclusive(`connection:${r.context.projectId}:${r.context.connectionId}`,async()=>{
        try{
          current(r);
          if(r.active!==p || p.expiresAt<=Date.now())fail('OAUTH_STATE','Sign-in was superseded or expired while waiting',409);
          const record=await readRecord(r),discovery=validateDiscovery(r,record.discovery);
          if(url.searchParams.get('iss') && !sameIssuer(url.searchParams.get('iss'),discovery.authorizationServerUrl))fail('OAUTH_METADATA','Callback issuer mismatch',409);
          if(url.searchParams.has('error'))fail('OAUTH_DENIED','Authorization declined',409);
          const code=url.searchParams.get('code');if(!code || code.length>4096 || /[\r\n\0]/.test(code) || !p.verifier)fail('OAUTH_CALLBACK','Missing authorization code',409);
          // Use SDK's single code exchange helper: the high-level auth helper
          // retries invalid_grant, which must not replay a consumed callback code.
          const tokens=await exchangeAuthorization(discovery.authorizationServerUrl,{metadata:discovery.authorizationServerMetadata,clientInformation:record.client,authorizationCode:code,codeVerifier:p.verifier,redirectUri:redirectUrl,resource:discovery.resourceMetadata.resource,fetchFn:(u,i)=>fetchFor(r,u,i,true)});
          await r.provider.saveTokens({...tokens,issuer:discovery.authorizationServerUrl});return api.status(r.context);
        }catch(error){if(r.active===p){r.error=safeOAuthError(error,'OAUTH_REQUIRED');await mark(r,'required').catch(()=>{});}throw oauthFailure(error,'OAUTH_REQUIRED');}
        finally{p.verifier=undefined;p.authorizationUrl=undefined;if(r.active===p)r.active=undefined;}
      });
    },
    async disconnect(input){
      return operation(input,'disconnect',async()=>{
        const c=scoped(input,store.read(),false),bound=binding(c),r=runtimes.get(digest(bound));
        if(r)r.revoked=true;
        for(const [key,p]of pending)if(p.runtime.context.connectionId===c.id){pending.delete(key);p.verifier=undefined;}
        if(c.config?.auth?.reference){
          requireVault();
          if(!/^vault:mcp-[a-f0-9-]{36}$/.test(c.config.auth.reference))fail('OAUTH_REQUIRED','Invalid machine credential reference',409);
          // DPAPI vault API has get/set, so overwrite with a credential-free
          // tombstone. No remote revocation claim and no unrelated owner creds.
          await exclusive(`vault:${digest(bound)}`,async()=>{
            try{
              const raw=await vault.get(c.config.auth.reference.slice(6));
              if(raw && digest(JSON.parse(raw).binding)!==digest(bound))fail('CONNECTION_CHANGED','Credential reference belongs to another connection',409);
              await vault.set(c.config.auth.reference.slice(6),JSON.stringify({binding:bound}));
            }catch(error){throw oauthFailure(error,'OAUTH_STORAGE');}
          });
        }
        if(r){r.loaded=undefined;r.active=undefined;r.error=undefined;runtimes.delete(r.key);}
        await store.transaction(s=>{const x=scoped(input,s,false);x.config={...x.config,auth:{kind:'oauth',status:'disconnected'}};x.discoveryStale=true;changed(x);});
        return api.status(input);
      });
    },
    authProviderFor(connection){return runtimeFor(connection)?.provider;},
    transportOptions(connection){const r=runtimeFor(connection);return r?{authProvider:r.provider,fetch:(u,i)=>fetchFor(r,u,i)}:{};},
    async close(){
      closed=true;for(const p of pending.values()){p.verifier=undefined;p.authorizationUrl=undefined;}pending.clear();
      for(const c of controllers)c.abort();
      await Promise.allSettled([...locks.values(),...Array.from(runtimes.values(),r=>r.refreshing).filter(Boolean)]);
      runtimes.clear();
    },
  };
  return api;
}
