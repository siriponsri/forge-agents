import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';
import {reserveBudget} from '../app/budgets/index.mjs';

test('production Owner CSRF issues one run Memory grant, real SDK uses it, and restore never revives it',{timeout:15000},async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-memory-http-')),app=await createApplication({dataDir});t.after(()=>app.close());
  const selection={instanceId:'FIXTURE_NO_PROVIDER_CALL',model:'fixture-no-inference',options:[],connectionId:crypto.randomUUID(),connectionGeneration:1};
  const p=entity({name:'Disposable Memory transport',workspace:path.join(dataDir,'workspace'),profile:{provider:selection}}),bot=entity({name:'Fixture bot'},p.id),task=entity({title:'Fixture task',botId:bot.id},p.id);
  const run=entity({attemptId:crypto.randomUUID(),operationId:crypto.randomUUID(),status:'running',taskId:task.id,botId:bot.id,threadId:crypto.randomUUID(),providerRunId:crypto.randomUUID(),t3ProjectId:crypto.randomUUID(),providerInstanceId:selection.instanceId,selection},p.id);
  await app.store.transaction(s=>{s.projects.push(p);s.bots.push(bot);s.tasks.push(task);s.connections.push({...entity({kind:'provider',providerInstanceId:selection.instanceId,enabled:true,config:{generation:1,routeId:'fixture-no-provider-call'}},p.id),id:selection.connectionId});s.runs.push(run);reserveBudget(s,{run});});
  const response=await fetch(app.url+'/api/session'),{csrf}=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const post=async(route,input,owner=true)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Cookie:cookie,'X-Forge-CSRF':csrf}:{})},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  const backup=(await post('/api/storage/backup',{})).body,issue={projectId:p.id,runId:run.id,operationId:crypto.randomUUID(),expectedRevision:run.revision,access:'read-write'};
  assert.equal((await post('/api/memory-mcp/issue',issue,false)).status,403);assert.equal((await post('/api/memory-mcp/close',issue)).status,404);
  const granted=await post('/api/memory-mcp/issue',issue);assert.equal(granted.status,200);assert.equal(granted.body.nativeAttachmentStatus,'NATIVE_ATTACHMENT_NOT_CONFIGURED');
  const config=granted.body.configuration,client=new Client({name:'production-memory-fixture',version:'1'},{capabilities:{}});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}));assert.equal((await client.listTools()).tools.length,5);
  const args={projectId:p.id,scope:{projectId:p.id,kind:'project',id:p.id},operationId:crypto.randomUUID(),memoryType:'semantic',title:'Actual scoped record',content:'Real SQLite memory through production MCP HTTP'};
  const result=await client.callTool({name:'memory.remember',arguments:args});assert.ok(!result.isError);assert.equal((await client.callTool({name:'memory.list',arguments:{projectId:p.id,scope:args.scope}})).structuredContent.items.length,1);
  assert.ok(!JSON.stringify(app.store.read()).includes(config.headers.Authorization));assert.equal((await post('/api/memory-mcp/issue',issue)).body.configuration,undefined);
  await app.store.transaction(s=>{s.runs.find(r=>r.id===run.id).status='completed';});
  let restored;for(let attempt=0;attempt<3;attempt++){restored=await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});if(restored.status!==409||restored.body.error.code!=='REVISION_CONFLICT')break;}
  assert.equal(restored.status,200,JSON.stringify(restored.body));
  const stale=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(stale.status,401);
  assert.equal(app.store.read().receipts.filter(r=>r.type==='memory-mcp.issue'&&r.operationId===issue.operationId).length,1);
  assert.equal((await post('/api/memory-mcp/issue',issue)).body.configuration,undefined);
});
