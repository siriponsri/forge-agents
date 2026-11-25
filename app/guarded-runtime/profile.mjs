import {createHash,timingSafeEqual} from 'node:crypto';

export const fail=code=>{throw Object.assign(new Error(code),{code});};
export function canonical(x){
  if(x===null||typeof x==='boolean'||typeof x==='string')return JSON.stringify(x);
  if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);
  if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
  if(x&&Object.getPrototypeOf(x)===Object.prototype)return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
  fail('NON_JSON');
}
export const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
export const bytesDigest=x=>createHash('sha256').update(x).digest('hex');
export function exact(x,keys){
  if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).sort().join('\0')!==[...keys].sort().join('\0'))fail('INVALID_SHAPE');
}
export const secretEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const TOOLS=Object.freeze(['read_text','propose_change','edit_text']);
export function relativeTextPath(p){
  if(typeof p!=='string'||p.length>512||!p||p.includes('\\')||p.includes(':')||p.startsWith('/')||p.split('/').some(s=>!s||s==='.'||s==='..'||/[\x00-\x1f<>"|?*]/.test(s)||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)))fail('PATH_DENIED');
  return p;
}
export function checkProfile(p,now=Date.now()){
  exact(p,['version','projectId','taskId','runId','threadId','envelopeDigest','identitySnapshot','scope','route','policyGeneration','toolGeneration','manifestDigest','contextDigest','expiresAt',...(Object.hasOwn(p??{},'purpose')?['purpose']:[])]);
  if(Object.hasOwn(p,'purpose')&&p.purpose!=='supervised-frontend-v1')fail('PROFILE_PURPOSE_DENIED');
  if(p.version!==1||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now)fail('PROFILE_EXPIRED');
  for(const k of ['projectId','taskId','runId','threadId','policyGeneration','toolGeneration'])if(typeof p[k]!=='string'||!p[k]||p[k].length>200)fail('PROFILE_INVALID');
  for(const k of ['envelopeDigest','identitySnapshot','manifestDigest','contextDigest'])if(!/^[a-f0-9]{64}$/.test(p[k]))fail('PROFILE_INVALID');
  exact(p.route,['providerInstanceId','apiProviderId','providerImplementation','accountGeneration','modelId','options','t3Revision','opencodeRevision','t3BinarySha256','opencodeBinarySha256']);
  for(const k of ['providerInstanceId','apiProviderId','providerImplementation','accountGeneration','modelId'])if(typeof p.route[k]!=='string'||!p.route[k]||p.route[k].length>300)fail('ROUTE_INVALID');
  if(p.route.providerImplementation!=='opencode2-api'||p.route.t3Revision!=='59651c1761f6c63e9b6056839067066968e6a406'||p.route.opencodeRevision!=='6f0514052a3c859894ad01bb14cc14dda1e44b96')fail('ROUTE_UNSUPPORTED');
  for(const k of ['t3BinarySha256','opencodeBinarySha256'])if(!/^[a-f0-9]{64}$/.test(p.route[k]))fail('ROUTE_INVALID');
  canonical(p.route.options);
  if(Array.isArray(p.route.options)){
    if(p.route.options.length>1)fail('ROUTE_OPTIONS_UNSUPPORTED');
    for(const option of p.route.options){exact(option,['id','value']);if(option.id!=='variant'||typeof option.value!=='string'||!option.value||option.value.length>200)fail('ROUTE_OPTIONS_UNSUPPORTED');}
  }else if(!p.route.options||Object.keys(p.route.options).length)fail('ROUTE_OPTIONS_UNSUPPORTED');
  exact(p.scope,['paths','capabilities','maxBytes']);
  if(!Array.isArray(p.scope.paths)||!p.scope.paths.length||p.scope.paths.length>32)fail('SCOPE_INVALID');
  p.scope.paths.forEach(x=>x==='.'?null:relativeTextPath(x));
  if(p.purpose==='supervised-frontend-v1'){
    if(JSON.stringify(p.scope.paths)!=='["."]'||JSON.stringify(p.scope.capabilities)!=='["frontend_selection_read"]')fail('SCOPE_INVALID');
  }else if(!Array.isArray(p.scope.capabilities)||!p.scope.capabilities.length||p.scope.capabilities.some(x=>!['read','propose','workspace.write'].includes(x)))fail('SCOPE_INVALID');
  if(!Number.isSafeInteger(p.scope.maxBytes)||p.scope.maxBytes<1||p.scope.maxBytes>65536)fail('SCOPE_INVALID');
  return structuredClone(p);
}

// Host-private object capability, deliberately not serializable as authority.
// No supported flag, source audit or test result can call this a runtime proof.
export function createProfileAuthority({readCurrent,clock=Date.now}){
  if(typeof readCurrent!=='function')fail('HOST_AUTHORITY_REQUIRED');
  const issued=new WeakMap();
  return Object.freeze({
    bind(profile){const p=checkProfile(profile,clock()),handle=Object.freeze({});issued.set(handle,{profile:p,digest:digest(p)});return handle;},
    assert(handle){
      const bound=issued.get(handle);if(!bound)fail('PRIVATE_PROFILE_REQUIRED');
      const current=readCurrent(bound.profile.runId);
      if(!current||typeof current.then==='function'||current.stopped||current.revoked||current.runtimeMode!=='approval-required'||current.governanceAllowed!==true)fail('PROFILE_REVOKED');
      checkProfile(current.profile,clock());
      if(digest(current.profile)!==bound.digest)fail('PROFILE_CHANGED');
      return structuredClone(bound.profile);
    },
  });
}
