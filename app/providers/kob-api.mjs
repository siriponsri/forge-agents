// Independently implemented API setup/discovery; no KOB CLI code or turn loop.
// Wire evidence: kobcli 452e16bcc62ef285dce78dfaf01faa7e0b484d7a,
// src/core/api.ts (auth/endpoints/envelopes), src/core/config.ts (key format).
const upstream = 'https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/';
export const KOB_API_DEFAULT_BASE_URL = 'https://www.kob-ai.dev/api/v2';
export const kobApiRoute = Object.freeze({
  id:'kob', brand:'KOB', driver:'opencode', authRoute:'machine-env-api-key',
  mode:'opencode-api', baseURL:KOB_API_DEFAULT_BASE_URL, apiFamily:'chat-completions',
  adapter:'kob-api', docs:upstream+'src/core/api.ts',
  requiresRuntime:'OpenCode 2.x; T3 0.1.11 detects v1/v2 separately',
  limitations:'API setup/discovery only. Select exact models/options from the T3 instance catalog. Tools, images, reasoning, cancellation and account access require live qualification. KOB CLI is not installed or reused.',
});

const messages = {
  KOB_INPUT:'Use only KOB API configuration fields and machine environment references.',
  KOB_API_URL:'Use an HTTPS service root, API base ending /v1 or /api/v2, or full /chat/completions URL, without credentials, query or fragment. HTTP is allowed only on loopback.',
  KOB_SECRET_REFERENCE:'Choose a machine environment variable name for the KOB API key.',
  KOB_SECRET_REQUIRED:'Set the selected KOB API key in the machine secret/environment store.',
  KOB_MODELS:'Supply distinct literal upstream model IDs; subsequent T3 catalog confirmation is required.',
  KOB_AUTH_REQUIRED:'KOB discovery rejected the API credential or account access.',
  KOB_RATE_LIMIT:'KOB discovery is rate limited. Retry explicitly later.',
  KOB_UNAVAILABLE:'KOB discovery is unavailable. Check the endpoint and retry explicitly.',
  KOB_REDIRECT:'KOB discovery redirected. Configure the final trusted HTTPS endpoint explicitly.',
  KOB_TIMEOUT:'KOB discovery timed out; no model inference was requested.',
  KOB_ABORTED:'KOB discovery was cancelled; no model inference was requested.',
  KOB_RESPONSE_TOO_LARGE:'KOB discovery exceeded the response size limit.',
  KOB_CATALOG_INVALID:'KOB discovery returned no supported model catalog envelope.',
  KOB_DISCOVERY_FAILED:'KOB discovery failed at the documented catalog endpoints.',
};
function reject(code, httpStatus) {
  // Never attach a cause, URL, response text, request body or credential.
  const configuration=['KOB_API_URL','KOB_INPUT','KOB_MODELS','KOB_SECRET_REFERENCE','KOB_SECRET_REQUIRED'].includes(code);
  throw Object.assign(new Error(messages[code]), {name:'KobApiError',code,
    statusCode:httpStatus===401||httpStatus===403?401:configuration?400:502,
    ...(httpStatus?{httpStatus}:{}),
  });
}
const record = value => value!==null && typeof value==='object' && !Array.isArray(value);
function inputFields(input, allowed) {
  if(!record(input)||Object.keys(input).some(k=>!allowed.includes(k)))reject('KOB_INPUT');
}
function reference(value) {
  if(typeof value!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value))reject('KOB_SECRET_REFERENCE');
  return value;
}
function modelId(value) {
  return typeof value==='string' && value.length>0 && value.length<=256 && value.trim()===value && !/[\x00-\x20\x7f{}]/.test(value);
}

/** Convert root/API-base/full endpoint into the base OpenCode will append to. */
export function normalizeKobEndpoint(value=KOB_API_DEFAULT_BASE_URL) {
  if(typeof value!=='string'||!value||value.length>2048||/[\s\\%?#]/.test(value))reject('KOB_API_URL');
  let url;
  try { url=new URL(value); } catch { reject('KOB_API_URL'); }
  const authority=value.slice(value.indexOf('://')+3).split('/')[0];
  if(url.username||url.password||authority.includes('@')||!url.hostname||!/^https?:\/\//i.test(value)||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))reject('KOB_API_URL');
  // Reject parser-normalized dot segments and ambiguous slashes before using URL.
  const rawPath=value.slice(value.indexOf('://')+3).replace(/^[^/]*/, '');
  if(rawPath.split('/').some(s=>s==='.'||s==='..')||rawPath.includes('//')||!/^[a-zA-Z0-9._~/-]*$/.test(url.pathname))reject('KOB_API_URL');
  let apiPath=url.pathname.replace(/\/+$/,'');
  const full=apiPath.endsWith('/chat/completions');
  if(full)apiPath=apiPath.slice(0,-'/chat/completions'.length);
  else if(!apiPath)apiPath=['kob-ai.dev','www.kob-ai.dev'].includes(url.hostname)?'/api/v2':'/v1';
  else if(!apiPath.endsWith('/v1')&&!apiPath.endsWith('/api/v2'))reject('KOB_API_URL');
  const rootPath=apiPath.endsWith('/api/v2')?apiPath.slice(0,-7):apiPath.endsWith('/v1')?apiPath.slice(0,-3):apiPath;
  const root=url.origin+rootPath;
  const baseURL=url.origin+apiPath;
  return {baseURL,chatURL:baseURL+'/chat/completions',modelsEndpoints:[
    {id:'openai',method:'GET',url:root+'/v1/models'},
    {id:'kob-legacy',method:'POST',url:root+'/api/models'},
    {id:'kob-v2',method:'GET',url:root+'/api/v2/models'},
  ]};
}

/** Pure compiler. Secret values are never read or stored by setup. */
export function compileKobApiConfig(input) {
  inputFields(input,['baseURL','apiKeyEnv','models']);
  const endpoint=normalizeKobEndpoint(input.baseURL),apiKeyEnv=reference(input.apiKeyEnv);
  if(!Array.isArray(input.models)||!input.models.length||input.models.length>100||input.models.some(m=>!modelId(m))||new Set(input.models).size!==input.models.length)reject('KOB_MODELS');
  return {...endpoint,apiKeyEnv,opencodeConfig:{update:'disable',providers:{forge:{
    name:'KOB',env:[apiKeyEnv],package:'@opencode/ai/providers/openai-compatible',
    settings:{baseURL:endpoint.baseURL,apiKey:`{env:${apiKeyEnv}}`},
    models:Object.fromEntries(input.models.map(id=>[id,{modelID:id,name:id}])),
  }}}};
}

// Return only literal identities/labels. Unknown capability and price fields are
// deliberately excluded; this list is never authoritative for T3 selection.
function catalogRows(value, secrets) {
  if(!record(value))return null;
  let recognized=false;
  const rows=[];
  for(const field of ['data','models'])if(Array.isArray(value[field])){recognized=true;for(const row of value[field])rows.push(row);}
  if(Array.isArray(value.providers)){
    recognized=true;
    for(const group of value.providers)if(record(group)&&Array.isArray(group.models)){
      for(const row of group.models)if(record(row))rows.push({...row,id:row.modelId??row.id,provider:group.provider});
    }
  }
  if(!recognized)return null;
  const sensitive=text=>secrets.some(secret=>text.includes(secret));
  const label=text=>typeof text==='string'&&text.length<=256&&!/[\x00-\x1f\x7f]/.test(text)&&!sensitive(text)?text:undefined;
  const seen=new Set(),models=[];
  for(const row of rows){
    if(!record(row)||!modelId(row.id)||sensitive(row.id)||seen.has(row.id))continue;
    seen.add(row.id);
    const name=label(row.displayName??row.display_name),provider=label(row.provider);
    models.push({id:row.id,...(name?{name}:{}),...(provider?{provider}:{})});
  }
  // A nonempty envelope of malformed identities is not a valid empty catalog.
  return rows.length&&!models.length?null:models;
}

async function readCatalog(response, maxResponseBytes) {
  const declared=Number(response.headers.get('content-length'));
  if(declared>maxResponseBytes){await response.body?.cancel().catch(()=>{});reject('KOB_RESPONSE_TOO_LARGE');}
  if(!response.body)return null;
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxResponseBytes){await reader.cancel().catch(()=>{});reject('KOB_RESPONSE_TOO_LARGE');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch {return null;}
}

/** Explicit model discovery only. Never performs a chat/billable probe.
 * resolveEnv(name) may bridge a machine vault to the selected env reference.
 * It is server-side only; never accept it or credential values over HTTP.
 */
export async function discoverKobModels(input, {fetchImpl=globalThis.fetch,env=process.env,resolveEnv,signal,timeoutMs=10000,maxResponseBytes=1048576,clock=Date.now}={}) {
  inputFields(input,['baseURL','apiKeyEnv']);
  const endpoint=normalizeKobEndpoint(input.baseURL),apiKeyEnv=reference(input.apiKeyEnv);
  if(typeof fetchImpl!=='function'||typeof clock!=='function'||resolveEnv!==undefined&&typeof resolveEnv!=='function'||signal!==undefined&&!(signal instanceof AbortSignal)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>10485760)reject('KOB_INPUT');
  const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const cancelled=()=>{if(signal?.aborted)reject('KOB_ABORTED');if(deadline.aborted)reject('KOB_TIMEOUT');};
  cancelled();
  let raw;
  try {
    if(resolveEnv){
      // A pending vault lookup must not make Stop or the deadline ineffective.
      let onAbort;
      try {raw=await Promise.race([
        Promise.resolve().then(()=>resolveEnv(apiKeyEnv)),
        new Promise((_,rejectLookup)=>{onAbort=()=>rejectLookup();combined.addEventListener('abort',onAbort,{once:true});if(combined.aborted)onAbort();}),
      ]);}finally{combined.removeEventListener('abort',onAbort);}
    }else raw=env[apiKeyEnv];
  }catch {cancelled();reject('KOB_SECRET_REQUIRED');}
  cancelled();
  if(typeof raw!=='string'||!raw||raw.length>8192||/[\s\x00-\x1f\x7f]/.test(raw))reject('KOB_SECRET_REQUIRED');
  const colon=raw.indexOf(':'),apiKey=colon<0?raw:raw.slice(0,colon),apiToken=colon<0?undefined:raw.slice(colon+1);
  if(!apiKey||apiToken==='')reject('KOB_SECRET_REQUIRED');
  const secrets=[...new Set([raw,apiKey,apiToken].filter(Boolean))],attempts=[];
  let emptyCatalog=false;
  for(const candidate of endpoint.modelsEndpoints){
    cancelled();
    let response;
    try {
      response=await fetchImpl(candidate.url,{method:candidate.method,redirect:'manual',signal:combined,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${raw}`},
        ...(candidate.method==='POST'?{body:JSON.stringify({api_key:apiKey,...(apiToken?{api_token:apiToken}:{})})}:{}),
      });
    }catch {cancelled();reject('KOB_UNAVAILABLE');}
    cancelled();
    const attempt={endpoint:candidate.id,method:candidate.method,status:response.status};attempts.push(attempt);
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      if(response.status>=300&&response.status<400)reject('KOB_REDIRECT',response.status);
      if([401,403].includes(response.status))reject('KOB_AUTH_REQUIRED',response.status);
      if(response.status===429)reject('KOB_RATE_LIMIT',response.status);
      if([404,405,410,501].includes(response.status)){attempt.outcome='unavailable';continue;}
      reject('KOB_UNAVAILABLE',response.status);
    }
    let data;
    try {data=await readCatalog(response,maxResponseBytes);}catch(error){cancelled();if(error?.code==='KOB_RESPONSE_TOO_LARGE')throw error;reject('KOB_UNAVAILABLE');}
    cancelled();
    const models=catalogRows(data,secrets);
    attempt.outcome=models===null?'invalid':models.length?'models':'empty';
    if(models===null)continue;
    if(!models.length){emptyCatalog=true;continue;}
    return {models,attempts,observedAt:clock(),source:'kob-api-discovery',verification:'discovery-only',executionVerified:false};
  }
  if(emptyCatalog)return {models:[],attempts,observedAt:clock(),source:'kob-api-discovery',verification:'discovery-only',executionVerified:false};
  reject(attempts.some(a=>a.outcome==='invalid')?'KOB_CATALOG_INVALID':'KOB_DISCOVERY_FAILED');
}
