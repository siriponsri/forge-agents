import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {digest,checkProfile} from '../app/guarded-runtime/profile.mjs';
import {PURPOSE,NATIVE_NAMES,argumentsFor,toolManifest,resultFor} from '../app/session-tools/contract.mjs';
import {openSessionNativeGateway} from '../app/session-tools/native-gateway.mjs';
import {makeOpenCodeSessionTool} from '../app/session-tools/native-tool.mjs';
import {installT3GuardedHost} from '../app/guarded-runtime/t3-host.mjs';

const binding={projectId:'p',runId:'r',attemptId:'a',threadId:'t',providerThreadId:'pt',providerTurnId:'pv',nativeSessionId:'s',nativeTurnId:'v',identityKind:'private-adapter'};
test('exact two-tool contract never promotes gateway errors or extra model fields',()=>{
  assert.deepEqual(NATIVE_NAMES,['forge_sessions_session_children','forge_sessions_session_prompt']);
  assert.throws(()=>argumentsFor('session_children',{role:'orchestrator'}));
  assert.throws(()=>argumentsFor('session_prompt',{membershipId:'m',operationId:'o',text:'x',parentRunId:'foreign'}));
  assert.throws(()=>argumentsFor('session_prompt',{membershipId:'m',operationId:'o',text:'x'.repeat(48001)}));
  assert.throws(()=>resultFor({isError:true,structuredContent:{error:{code:'SESSION_ROLE_DENIED'}},content:[{type:'text',text:'{}'}]}));
  assert.throws(()=>resultFor({structuredContent:{ok:true},content:[{type:'text',text:'{"ok":false}'}]}));
});
test('session profile binds an exact attempt and has no file capabilities',()=>{
  const h='a'.repeat(64),p={version:1,purpose:PURPOSE,projectId:'p',taskId:'t',runId:'r',attemptId:'a',threadId:'thread',envelopeDigest:h,identitySnapshot:h,scope:{paths:['.'],capabilities:['session_children','session_prompt'],maxBytes:65536},route:{providerInstanceId:'i',apiProviderId:'api',providerImplementation:'opencode2-api',accountGeneration:'none',modelId:'api/model',options:[],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:h,opencodeBinarySha256:h},manifestDigest:h,contextDigest:h,policyGeneration:'1',toolGeneration:'1',expiresAt:Date.now()+60000};
  assert.deepEqual(checkProfile(p),p);const {attemptId,...unbound}=p;assert.throws(()=>checkProfile(unbound));
  assert.throws(()=>checkProfile({...p,scope:{...p.scope,capabilities:['read']}}));
  assert.throws(()=>checkProfile({...p,scope:{...p.scope,capabilities:['session_children','session_prompt','workspace.write']}}));
  assert.throws(()=>checkProfile({...p,purpose:'supervised-frontend-v1'}));
});
test('private bootstrap mapping rechecks writer authority, exact binding, purpose and Stop',async()=>{
  let stopped=false,foreign=false,fenced=false;const p={purpose:PURPOSE,projectId:'p',runId:'r',attemptId:'a',threadId:'t',expiresAt:Date.now()+60000,manifestDigest:digest(toolManifest())};
  const gateway=await openSessionNativeGateway({assertCurrent:()=>{if(stopped)throw Error('SESSION_NATIVE_STOPPED');return p;},bindingProvider:()=>{assert.ok(fenced);return {...binding,...(foreign?{runId:'foreign'}:{})};},attachmentProvider:()=>({configuration:{type:'http',url:'http://127.0.0.1:9999/private-sessions',headers:{Authorization:'Bearer '+'x'.repeat(43)}},expiresAt:p.expiresAt}),authorizePhase:()=>true,withFence:fn=>{fenced=true;try{return fn();}finally{fenced=false;}}});
  const {key,brokerUrl}=gateway.bootstrap();
  async function call(url,body,auth=key){const raw=JSON.stringify(body);return fetch(brokerUrl+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth,'X-Forge-Mac':createHmac('sha256',Buffer.from(key,'hex')).update(raw).digest('hex')},body:raw});}
  const b={profileDigest:digest(p),sessionId:'s',callId:'c',messageId:'msg'};
  try{
    assert.equal((await call('/session-binding',b,'bad')).status,401);
    assert.equal((await call('/session-binding',{...b,sessionId:'foreign'})).status,403);
    foreign=true;assert.equal((await call('/session-binding',b)).status,403);foreign=false;
    const ok=await call('/session-binding',b);assert.equal(ok.status,200);assert.deepEqual((await ok.json()).result.binding,binding);
    assert.equal((await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'session_prompt'}})).status,403);
    stopped=true;assert.equal((await call('/session-binding',b)).status,403);
  }finally{await gateway.close();}
});
test('singleton tool selection is bound to the exact handle purpose',()=>{
  const guarded={},frontend={},orchestrator={},profiles=new Map([[guarded,{}],[frontend,{purpose:'supervised-frontend-v1'}],[orchestrator,{purpose:PURPOSE}]]);let wrong=false;
  const host=installT3GuardedHost({resolveThread:thread=>thread,assertCurrent:handle=>profiles.get(handle),runtimeDirectory:()=>'',toolNames:(handle,p)=>wrong?NATIVE_NAMES:p.purpose===PURPOSE?NATIVE_NAMES:p.purpose==='supervised-frontend-v1'?['forge_frontend_selection_read']:undefined});
  for(const handle of profiles.keys())host.resolve(handle,{});
  assert.deepEqual(host.toolNames(orchestrator),NATIVE_NAMES);assert.equal(host.toolNames(guarded),undefined);assert.deepEqual(host.toolNames(frontend),['forge_frontend_selection_read']);
  wrong=true;assert.throws(()=>host.toolNames(frontend));assert.throws(()=>host.toolNames(guarded));assert.throws(()=>host.toolNames({}));
});
test('native hook supplies real context metadata and a revoked awaited result fails',async()=>{
  // Minimal deterministic Effect interpreter verifies hook contract only. The
  // separate compiled fixture uses the actual Effect/native tool graph.
  const Effect={tryPromise:x=>x.try(new AbortController().signal)},ToolError=class extends Error{constructor({message}){super(message);}};let active=true,seen;
  const tool=makeOpenCodeSessionTool({name:'session_prompt',Effect,ToolError,binding,assertCurrent:()=>active,client:{async callTool(input){seen=input;active=false;return {structuredContent:{sent:true},content:[{type:'text',text:'{"sent":true}'}]};}}});
  await assert.rejects(tool.execute({membershipId:'m',operationId:'o',text:'advice'},{sessionID:'s',id:'actual-call',messageID:'actual-message'}),/SESSION_NATIVE_CONTEXT/);
  assert.deepEqual(seen._meta['forge/session-native-v1'],{sessionId:'s',turnId:'v',callId:'actual-call',messageId:'actual-message'});
});
