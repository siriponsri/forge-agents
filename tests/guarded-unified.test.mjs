import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {checkProfile,digest,bytesDigest} from '../app/guarded-runtime/profile.mjs';
import {installT3GuardedHost} from '../app/guarded-runtime/t3-host.mjs';
import {purposeSeparatedToolNames} from '../app/frontend-tools/root-host-tools.mjs';
import {createGuardedRuntimeHost} from '../app/guarded-runtime/runtime-host.mjs';
import {openFrontendNativeGateway} from '../app/frontend-tools/native-gateway.mjs';

test('same singleton resolves handle-scoped purpose tools and read-only lifecycle snapshots',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-unified-unit-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('forge-unified-unit-'));await fs.rm(root,{recursive:true,force:true});});
  const workspace=path.join(root,'workspace');await fs.mkdir(workspace);const t3=path.join(root,'t3'),oc=path.join(root,'opencode');await fs.writeFile(t3,'t3');await fs.writeFile(oc,'oc');
  const h='a'.repeat(64),profile={version:1,projectId:'p',taskId:'t',runId:'run',threadId:'thread',envelopeDigest:h,identitySnapshot:h,scope:{paths:['.'],capabilities:['read'],maxBytes:4},route:{providerInstanceId:'i',apiProviderId:'api',providerImplementation:'opencode2-api',accountGeneration:'none',modelId:'api/model',options:[],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:bytesDigest('t3'),opencodeBinarySha256:bytesDigest('oc')},manifestDigest:h,contextDigest:h,policyGeneration:'1',toolGeneration:'1',expiresAt:Date.now()+60000};
  const frontend={...profile,purpose:'supervised-frontend-v1',runId:'frontend',threadId:'frontend-thread',scope:{paths:['.'],capabilities:['frontend_selection_read'],maxBytes:4}};
  checkProfile(frontend);assert.throws(()=>checkProfile({...profile,purpose:'unknown'}),{code:'PROFILE_PURPOSE_DENIED'});assert.throws(()=>checkProfile({...frontend,scope:profile.scope}),{code:'SCOPE_INVALID'});assert.throws(()=>checkProfile({...profile,scope:frontend.scope}),{code:'SCOPE_INVALID'});
  let host,lease,callback=purposeSeparatedToolNames,checks=0;const native=installT3GuardedHost({resolveThread:()=>lease,assertCurrent:x=>host.assertCurrent(x),runtimeDirectory:x=>host.runtimeDirectory(x),toolNames:(...a)=>callback(...a)});
  host=createGuardedRuntimeHost({t3Host:native,readRun:id=>({projectId:'p',taskId:'t',operationId:'op',status:'submitting',profile:id==='run'?profile:frontend}),validateReservation:()=>true,authorizeCurrent:()=>{checks++;return true;},authorizeAction:()=>true,recordReceipt(){},withFence:(_id,fn)=>fn(),artifacts:{t3:{path:t3},opencode:{path:oc}}});
  const input={operationId:'op',workspace,runtimeDirectory:path.join(root,'runtime'),homeDirectory:path.join(root,'home'),receiptPath:path.join(root,'effects.sqlite'),limits:{maxRunMs:60000,maxTokens:null,maxCost:null}};
  lease=host.reserve({...input,profile});assert.throws(()=>native.toolNames(lease),{code:'PRIVATE_PROFILE_REQUIRED'});native.resolve({id:'thread'},{});assert.equal(native.toolNames(lease),undefined);
  callback=()=>['forge_frontend_selection_read'];assert.throws(()=>native.toolNames(lease),{code:'PRIVATE_TOOL_PROFILE_REQUIRED'});callback=purposeSeparatedToolNames;
  const original=lease;lease=host.reserve({...input,profile:frontend});native.resolve({id:'frontend-thread'},{});assert.deepEqual(native.toolNames(lease),['forge_frontend_selection_read']);assert.equal(native.toolNames(original),undefined);
  const count=checks,snapshot=host.privateSnapshot(lease);assert.equal(checks,count);assert.equal(snapshot.live,false);assert.equal(snapshot.phase,'reserved');snapshot.profile.purpose='evil';assert.equal(host.privateSnapshot(lease).profile.purpose,'supervised-frontend-v1');
  callback=async()=>[];assert.throws(()=>native.toolNames(lease),{code:'SYNCHRONOUS_ROUTE_OBSERVATION_REQUIRED'});callback=purposeSeparatedToolNames;
  await host.close(lease);assert.equal(host.privateSnapshot(lease).phase,'closed');assert.throws(()=>native.toolNames(lease),{code:'ROUTE_CLOSED'});await host.close(original);
});

test('frontend native metadata uses same writer while SDK handler stays outside it',async()=>{
  const p={purpose:'supervised-frontend-v1',expiresAt:Date.now()+60000,runId:'r'},profileDigest=digest(p);let fenced=false,count=0;
  const gateway=await openFrontendNativeGateway({broker:{async close(){}},assertCurrent:()=>p,bindingProvider(){throw Error('not used');},authorizePhase:()=>{assert.equal(fenced,true);return true;},authenticateOwner:()=>null,withFence:async fn=>{assert.equal(fenced,false);fenced=true;count++;try{return structuredClone(fn());}finally{fenced=false;}}});
  try{const {key,brokerUrl}=gateway.bootstrap(),raw=JSON.stringify({profileDigest,phase:'model-request',sessionID:'actual-session'}),response=await fetch(brokerUrl+'/fence',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'X-Forge-Mac':createHmac('sha256',Buffer.from(key,'hex')).update(raw).digest('hex')},body:raw});assert.equal(response.status,200);assert.equal((await response.json()).result.profileDigest,profileDigest);assert.equal(count,1);}finally{await gateway.close();}
});

test('private generation hashes Research, components, frontend and server source; editable drift fails before refresh',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-unified-source-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('forge-unified-source-'));await fs.rm(root,{recursive:true,force:true});});
  const directories=['guarded-runtime','research-native','research-components','frontend-tools','server'];for(const d of directories)await fs.mkdir(path.join(root,'app',d),{recursive:true});
  const original=new URL('../app/server/guarded-policy.mjs',import.meta.url),source=(await fs.readFile(original,'utf8')).replace(/from '([^']+)'/g,(whole,spec)=>spec.startsWith('.')?"from '"+new URL(spec,original).href+"'":whole),file=path.join(root,'app/server/guarded-policy.mjs');await fs.writeFile(file,source);
  const {createGuardedPolicy}=await import(pathToFileURL(file).href);
  for(const directory of directories){const changed=path.join(root,'app',directory,'enforcement.mjs');await fs.writeFile(changed,'export const rule=1;');const policy=createGuardedPolicy({});await fs.writeFile(changed,'export const rule=2;');await assert.rejects(policy.refresh({projectId:'p'}),{code:'GUARDED_MODULE_CHANGED'});await fs.unlink(changed);}
});

