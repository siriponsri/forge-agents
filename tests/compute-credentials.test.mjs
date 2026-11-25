import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createComputeCredentialRuntime} from '../app/server/compute-credentials.mjs';
import {createSecretService} from '../app/secrets/index.mjs';
import {validateConfig,secret} from '../app/compute/common.mjs';
import {emptyState} from '../app/server/store.mjs';

async function fixture(){
  const state=emptyState(),projectId=randomUUID(),otherId=randomUUID(),targetId=randomUUID();
  state.projects.push({id:projectId},{id:otherId});
  const config=validateConfig({kind:'jupyter',baseUrl:'http://127.0.0.1:4444',workspace:'work',authEnv:'FORGE_COMPUTE_SCOPED_FIXTURE'});
  state.connections.push({id:targetId,projectId,kind:'compute',enabled:true,config,revision:1});
  const store={read:()=>structuredClone(state)};let encryptedFixtureState=null;
  const nativeStore={supported:true,read:async()=>structuredClone(encryptedFixtureState),transaction:async work=>{const out=await work(structuredClone(encryptedFixtureState));if(out.next)encryptedFixtureState=structuredClone(out.next);return out.result;},status:async()=>({supported:true,backend:'in-memory-vault-fixture'})};
  const secrets=await createSecretService({store,machineDir:'C:/forge-compute-credential-fixture-outside-source',nativeStore,env:{FORGE_COMPUTE_SCOPED_FIXTURE:'explicit-dummy-env'}});
  const manager=createComputeCredentialRuntime({store,secrets});
  const put=async(projectId,value,purpose='compute')=>secrets.set({operationId:randomUUID(),projectId,purpose,name:config.authEnv,value,expectedRevision:0});
  return {state,projectId,otherId,targetId,config,manager,secrets,put};
}
test('host compute runtime resolves exact project/purpose and fences rotated/disabled bindings without global fallback',async()=>{
  const fixtureState=await fixture(),{projectId,otherId,targetId,config,manager,secrets}=fixtureState;
  const first=await fixtureState.put(projectId,'project-a-dummy-key'),second=await fixtureState.put(otherId,'project-b-dummy-key');
  const runtime=await manager.prepare({projectId,targetId,config});
  assert.equal(secret(config.authEnv,runtime),'project-a-dummy-key');
  assert.ok(!JSON.stringify(runtime).includes('dummy-key'));
  assert.equal(runtime.references[0].reference,first.secret.reference);
  assert.notEqual(runtime.references[0].reference,second.secret.reference);
  await runtime.beforeDispatch();
  await secrets.set({operationId:randomUUID(),projectId,purpose:'compute',reference:first.secret.reference,value:'project-a-rotated-dummy',expectedRevision:1});
  await assert.rejects(runtime.beforeDispatch(),{code:'COMPUTE_CREDENTIAL_CHANGED'});
  manager.invalidate({projectId:otherId,name:config.authEnv});assert.equal(runtime.signal.aborted,false);
  manager.invalidate({projectId,name:config.authEnv});assert.equal(runtime.signal.aborted,true);
  runtime.dispose();
  const fresh=await manager.prepare({projectId,targetId,config});assert.equal(secret(config.authEnv,fresh),'project-a-rotated-dummy');
  fixtureState.state.connections[0].enabled=false;
  await assert.rejects(fresh.beforeDispatch(),{code:'COMPUTE_BINDING_CHANGED'});fresh.dispose();manager.close();
});
test('missing compute purpose cannot use a same-name provider key and local readiness never opens a vault',async()=>{
  const fixtureState=await fixture(),{projectId,targetId,config,manager}=fixtureState;
  await fixtureState.put(projectId,'provider-only-dummy-key','provider');
  await assert.rejects(manager.prepare({projectId,targetId,config}),{code:'CREDENTIAL_REQUIRED'});
  let vaultReads=0;
  const local=createComputeCredentialRuntime({store:{read:()=>({projects:[{id:projectId}]})},secrets:{list(){vaultReads++;throw new Error('No native vault on this OS');}}});
  const runtime=await local.prepare({projectId,config:{kind:'local'}});
  assert.deepEqual(Object.keys(runtime.env),[]);await runtime.beforeDispatch();assert.equal(vaultReads,0);runtime.dispose();local.close();
});
