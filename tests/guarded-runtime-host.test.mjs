// Trust-boundary unit checks only. Actual native evidence is exercised by the
// isolated compiled supervisor/CLI fixtures, never manufactured here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {bytesDigest,digest} from '../app/guarded-runtime/profile.mjs';
import {installT3GuardedHost} from '../app/guarded-runtime/t3-host.mjs';
import {createGuardedRuntimeHost} from '../app/guarded-runtime/runtime-host.mjs';
import {createGuardedInstallationHost} from '../app/guarded-runtime/installation-host.mjs';

test('private reservation requires canonical current governance, exact code, supported limits and the committed same run',async()=>{
  assert.throws(()=>createGuardedInstallationHost({t3Host:{}}),{code:'PRIVATE_T3_HOST_REQUIRED'});
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-host-unit-'));
  let run=null,allowed=true,host,lease;
  const native=installT3GuardedHost({resolveThread:()=>lease,assertCurrent:h=>host.assertCurrent(h),runtimeDirectory:h=>host.runtimeDirectory(h)});
  try{
    const workspace=path.join(root,'workspace');await mkdir(workspace);
    const t3=path.join(root,'t3-fixture'),oc=path.join(root,'oc-fixture');await writeFile(t3,'t3');await writeFile(oc,'oc');
    const hash='a'.repeat(64),scope={paths:['allowed'],capabilities:['read']};
    const profile={version:1,projectId:'p',taskId:'t',runId:'r',threadId:'thread',envelopeDigest:hash,identitySnapshot:hash,scope:{...scope,maxBytes:1024},route:{providerInstanceId:'fixture',apiProviderId:'api',providerImplementation:'opencode2-api',accountGeneration:'none',modelId:'api/model',options:[],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:bytesDigest('t3'),opencodeBinarySha256:bytesDigest('oc')},manifestDigest:hash,contextDigest:hash,policyGeneration:'1',toolGeneration:'1',expiresAt:Date.now()+60000};
    const callbacks={t3Host:native,readRun:()=>run,validateReservation:()=>true,authorizeCurrent:input=>allowed&&input.workspace===workspace&&input.runtimeDirectory===path.join(root,'runtime'),authorizeAction:()=>true,recordReceipt(){},withFence:(_id,fn)=>fn(),artifacts:{t3:{path:t3},opencode:{path:oc}}};
    assert.throws(()=>createGuardedRuntimeHost({...callbacks,authorizeCurrent:undefined}),{code:'CANONICAL_HOST_REQUIRED'});
    host=createGuardedRuntimeHost(callbacks);
    const input={profile,operationId:'op',workspace,runtimeDirectory:path.join(root,'runtime'),homeDirectory:path.join(root,'home'),receiptPath:path.join(root,'receipts/effects.sqlite'),limits:{maxRunMs:10000,maxTokens:null,maxCost:null}};
    assert.throws(()=>host.reserve({...input,limits:{...input.limits,maxTokens:1}}),{code:'UNENFORCEABLE_LIMIT'});
    lease=host.reserve(input);assert.equal(host.qualify(lease,{}),null);
    await assert.rejects(host.bind(lease),{code:'CANONICAL_RUN_NOT_DISPATCHABLE'});
    run={projectId:'p',taskId:'t',operationId:'op',status:'submitting',profile};
    allowed=false;assert.throws(()=>host.assertCurrent(lease),{code:'CANONICAL_CURRENT_AUTHORITY_DENIED'});allowed=true;
    assert.deepEqual(host.assertCurrent(lease),profile);
    const otherWorkspace=host.reserve({...input,workspace:path.join(root,'other-workspace')});
    assert.throws(()=>host.assertCurrent(otherWorkspace),{code:'CANONICAL_CURRENT_AUTHORITY_DENIED'});await host.close(otherWorkspace);
    run.status='completed';assert.throws(()=>host.assertCurrent(lease),{code:'CANONICAL_RUN_NOT_DISPATCHABLE'});run.status='submitting';
    run.profile={...profile,policyGeneration:'2'};assert.throws(()=>host.assertCurrent(lease),{code:'CANONICAL_RUN_NOT_DISPATCHABLE'});run.profile=profile;
    await writeFile(oc,'changed');assert.throws(()=>host.assertCurrent(lease),{code:'RUNTIME_ARTIFACT_CHANGED'});await writeFile(oc,'oc');
    await host.close(lease);assert.equal(host.qualify(lease,{}),null);
    assert.throws(()=>host.assertCurrent(structuredClone(lease)),{code:'PRIVATE_ROUTE_LEASE_REQUIRED'});
    assert.equal(digest(scope),digest({capabilities:['read'],paths:['allowed']}));
  }finally{if(lease)await host.close(lease);await rm(root,{recursive:true,force:true});}
});
