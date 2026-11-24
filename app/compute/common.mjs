import { createHash } from 'node:crypto';

export const stamp=()=>new Date().toISOString();
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function error(code,message,statusCode=400){throw Object.assign(new Error(message),{code,statusCode});}
export function text(value,label,pattern){if(typeof value!=='string'||!value.trim()||(pattern&&!pattern.test(value)))error('COMPUTE_CONFIG',`Invalid ${label}`);return value;}
export function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value))error('COMPUTE_CONFIG','Configuration must be an object');for(const k of Object.keys(value))if(!allowed.includes(k))error('COMPUTE_CONFIG',`Unsupported configuration field: ${k}`);}
export function envRef(name,optional=false){if(name===undefined&&optional)return;return text(name,'machine environment reference',/^[A-Za-z_][A-Za-z0-9_]*$/);}
export function secret(name){envRef(name);const value=process.env[name];if(!value)error('CREDENTIAL_REQUIRED',`Configure machine environment reference ${name}`,409);return value;}
export function clean(value,config){let out=String(value??'');const visit=c=>{for(const [k,v]of Object.entries(c??{})){if(k.endsWith('Env')&&typeof v==='string'&&process.env[v])out=out.split(process.env[v]).join('[REDACTED]');else if(v&&typeof v==='object')visit(v);}};visit(config);return out.replace(/((?:Bearer|token|password|api[_-]?key)\s*[:= ]\s*)[^\s"'<>]+/gi,'$1[REDACTED]');}
export function url(value,{cloudOrigin}={}){let u;try{u=new URL(text(value,'URL'));}catch{error('COMPUTE_CONFIG','Invalid URL');}if(u.username||u.password||u.search||u.hash)error('COMPUTE_CONFIG','URLs cannot contain credentials, query or fragment');const loop=['localhost','127.0.0.1','[::1]'].includes(u.hostname);if(u.protocol!=='https:'&&!(loop&&u.protocol==='http:'))error('COMPUTE_CONFIG','Use HTTPS or loopback HTTP');if(cloudOrigin&&!loop&&u.origin!==cloudOrigin)error('COMPUTE_CONFIG','Provider API origin does not match its documented contract');return u.href.replace(/\/$/,'');}
export function relative(value){text(value,'relative workspace');if(value.startsWith('/')||value.includes('\\')||value.split('/').some(x=>!x||x==='.'||x==='..')||/[\x00-\x1f]/.test(value))error('COMPUTE_CONFIG','Workspace must be a confined relative POSIX path');return value;}
export function validateConfig(raw){
  keys(raw,['kind','name','timeoutMs','authEnv','baseUrl','resourceId','executor','host','port','user','knownHostsFileEnv','identityFileEnv','expectedMachineId','workspace','kernelName','environmentRevision']);
  const c=structuredClone(raw);if(!['local','owner-ssh','jupyter','vast','runpod','colab-browser'].includes(c.kind))error('COMPUTE_CONFIG','Unsupported compute kind');
  const shared=['kind','name','timeoutMs','environmentRevision'];
  const byKind={local:[], 'colab-browser':[], 'owner-ssh':['host','port','user','knownHostsFileEnv','identityFileEnv','expectedMachineId','workspace'],jupyter:['baseUrl','authEnv','workspace','kernelName'],vast:['baseUrl','authEnv','resourceId','executor'],runpod:['baseUrl','authEnv','resourceId','executor']};
  keys(c,[...shared,...byKind[c.kind]]);
  c.timeoutMs??=15000;if(!Number.isInteger(c.timeoutMs)||c.timeoutMs<50||c.timeoutMs>120000)error('COMPUTE_CONFIG','timeoutMs must be 50..120000');
  if(c.authEnv)envRef(c.authEnv);
  if(c.kind==='owner-ssh'){
    text(c.host,'SSH host',/^[A-Za-z0-9][A-Za-z0-9.-]*$/);text(c.user,'SSH user',/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/);c.port??=22;if(!Number.isInteger(c.port)||c.port<1||c.port>65535)error('COMPUTE_CONFIG','Invalid SSH port');
    envRef(c.knownHostsFileEnv);envRef(c.identityFileEnv,true);if(c.expectedMachineId)text(c.expectedMachineId,'machine identity SHA256',/^[a-f0-9]{64}$/);
    text(c.workspace,'absolute remote workspace');if(!c.workspace.startsWith('/')||c.workspace.split('/').includes('..')||/[\x00-\x1f]/.test(c.workspace))error('COMPUTE_CONFIG','SSH workspace must be absolute POSIX path');
  }
  if(c.kind==='jupyter'){c.baseUrl=url(c.baseUrl);c.workspace=relative(c.workspace);c.kernelName??='python3';text(c.kernelName,'kernel name',/^[A-Za-z0-9_.-]+$/);envRef(c.authEnv);}
  if(['vast','runpod'].includes(c.kind)){
    text(c.resourceId,'existing resource ID',c.kind==='vast'?/^[1-9][0-9]*$/:/^[A-Za-z0-9_-]+$/);envRef(c.authEnv);
    c.baseUrl=url(c.baseUrl??(c.kind==='vast'?'https://console.vast.ai/api/v0':'https://api.runpod.io/v2'),{cloudOrigin:c.kind==='vast'?'https://console.vast.ai':'https://api.runpod.io'});
    const parsed=new URL(c.baseUrl);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&parsed.pathname!==(c.kind==='vast'?'/api/v0':'/v2'))error('COMPUTE_CONFIG','Provider API base path differs from the verified contract');
    if(c.executor){c.executor=validateConfig(c.executor);if(!['owner-ssh','jupyter'].includes(c.executor.kind))error('COMPUTE_CONFIG','Cloud execution requires an SSH or Jupyter target');}
  }
  if(c.environmentRevision!==undefined)text(c.environmentRevision,'environment revision');return c;
}
export async function request(config,route,{method='GET',body,auth='Bearer',allow404=false}={}){
  const headers={'Accept':'application/json'};if(config.authEnv)headers.Authorization=`${auth} ${secret(config.authEnv)}`;
  if(body!==undefined)headers['Content-Type']='application/json';let response;
  try{response=await fetch(config.baseUrl+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(config.timeoutMs),redirect:'error'});}catch{error('COMPUTE_UNCERTAIN','Connection failed or timed out; reconcile the recorded execution before retrying',502);}
  if(allow404&&response.status===404)return null;
  if(!response.ok)error(response.status===401||response.status===403?'COMPUTE_AUTH':'COMPUTE_HTTP',`Compute HTTP ${response.status}; provider response omitted to protect credentials`,response.status===401||response.status===403?409:502);
  if(response.status===204)return {};const bytes=await response.text();if(bytes.length>2000000)error('COMPUTE_RESPONSE','Compute response exceeded the 2 MB limit',502);try{return JSON.parse(bytes);}catch{error('COMPUTE_RESPONSE','Compute returned invalid JSON',502);}
}
