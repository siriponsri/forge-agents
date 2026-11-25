import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openStore} from '../app/server/store.mjs';
import {command,entity} from '../app/server/domain.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createMemoryService} from '../app/memory/index.mjs';

test('private run memory leases revoke independently and recheck a queued canonical write',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-run-memory-authority-')),store=await openStore(dataDir),authority=createLocalAuthority();
  const p=(await command(store,{operationId:crypto.randomUUID(),type:'project.create',data:{name:'Run-scoped memory',workspace:path.join(dataDir,'workspace')}})).entity;
  const run=await store.transaction(s=>{const run=entity({attemptId:crypto.randomUUID(),status:'running'},p.id);s.runs.push(run);return run;});
  const memory=await createMemoryService({store,dataDir,authorize:authority.authorize});t.after(async()=>{await memory.close();await store.close();});
  let active=true;const caller=authority.forRun(run,{allowWrite:true,active:()=>active}),other=authority.forRun(run,{allowWrite:true,active:()=>true});assert.notEqual(caller,other);
  const scope={projectId:p.id,kind:'project',id:p.id},input={projectId:p.id,scope,operationId:crypto.randomUUID(),memoryType:'semantic',title:'Lease boundary',content:'Explicitly permitted run data'};
  await assert.rejects(memory.remember(input,{}),{code:'MEMORY_FORBIDDEN'});
  const first=await memory.remember(input,caller);assert.ok(first.id);
  let release,entered;const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});
  const blocked=store.transaction(async()=>{entered();await held;});await inside;
  const write=memory.remember({...input,operationId:crypto.randomUUID(),title:'Must not commit'},caller);active=false;release();await blocked;
  await assert.rejects(write,{code:'MEMORY_FORBIDDEN'});await assert.rejects(memory.list({projectId:p.id,scope},caller),{code:'MEMORY_FORBIDDEN'});
  assert.equal((await memory.list({projectId:p.id,scope},other)).items.length,1);
  const asyncClaim=authority.forRun(run,{active:async()=>true});await assert.rejects(memory.list({projectId:p.id,scope},asyncClaim),{code:'MEMORY_FORBIDDEN'});
  assert.equal(authority.authorize({action:'owner.read',scope:{kind:'owner',id:'local-owner'},callerContext:other,state:store.read()}),false);
});
