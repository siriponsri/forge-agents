import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createGuardedExecutionBridge} from '../app/server/guarded.mjs';

test('missing trusted callbacks default deny; metadata/report cannot qualify',async()=>{
  const state={projects:[],runs:[],receipts:[]},store={read:()=>structuredClone(state),transaction:async fn=>fn(state)};
  const bridge=createGuardedExecutionBridge({store,dataDir:path.join(os.tmpdir(),'forge-bridge-deny')});
  assert.equal(bridge.qualifyProactive(state,{projectId:'p'}),null);
  assert.equal(bridge.readiness({projectId:'p'}),null);
  await assert.rejects(bridge.prepare({projectId:'p'}),{code:'GUARDED_HOST_CALLBACK_REQUIRED'});
  await assert.rejects(bridge.launch('unknown',{message:'must not send'}),{code:'GUARDED_PRIVATE_LEASE_REQUIRED'});
  await bridge.close();
});
