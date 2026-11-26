import {browserOwner} from './support/browser-owner.mjs';
// Display/recovery HTTP fixture: this file does not claim a provider ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';
import {command,entity} from '../app/server/domain.mjs';
test('live AG-UI display uses durable cursors and domain deltas without executing replayed tools',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-protocol-http-')),app=await createApplication({dataDir:path.join(root,'state')});t.after(()=>app.close());
  const cmd=(type,projectId,data)=>command(app.store,{type,projectId,data,operationId:crypto.randomUUID()});
  const p=(await cmd('project.create',null,{name:'Protocol HTTP fixture',workspace:path.join(root,'workspace')})).entity;
  const task=(await cmd('task.create',p.id,{title:'Read-only projection fixture'})).entity;
  const run=await app.store.transaction(s=>{const r=entity({taskId:task.id,threadId:'fixture-thread',providerRunId:'fixture-provider-run',status:'running',attemptId:'fixture-attempt',protocolSequence:0},p.id);s.runs.push(r);return r;});
  const response=await fetch(app.url+`/api/runs/${run.id}/stream`,{signal:AbortSignal.timeout(5000)}),reader=response.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));
  const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/STATE_SNAPSHOT/);
  await cmd('document.create',p.id,{name:'Saved revision',kind:'doc',snapshot:{body:{dataStream:'Thai\r\n'}}});
  let live='';while(!live.includes('STATE_DELTA')){const part=await reader.read();if(part.done)break;live+=new TextDecoder().decode(part.value);}assert.match(live,/STATE_DELTA/);assert.match(live,/documents/);
  const recovery=await(await fetch(app.url+`/api/runs/${run.id}/recovery`)).json();assert.equal(recovery.identity.runId,run.id);assert.equal(recovery.capabilities.frontendToolResults,false);
  const unsupported=await fetch(app.url+`/api/runs/${run.id}/tool-result`,{method:'POST',headers:{'Content-Type':'application/json',...await browserOwner(app.url)},body:JSON.stringify({result:'forged result'})});assert.equal(unsupported.status,409);assert.equal((await unsupported.json()).error.code,'T3_FRONTEND_TOOL_UNSUPPORTED');
  assert.equal(app.store.read().runs.length,1);
  await reader.cancel();
});
