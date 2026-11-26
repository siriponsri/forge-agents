import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createSessionRoleMcpGateway} from '../app/server/session-roles-mcp.mjs';
import {fixture} from './product-session-roles-fixture.mjs';
import {digest as nativeDigest} from '../app/guarded-runtime/profile.mjs';

async function harness(t){
  const f=await fixture(t);let gateway,time=100000;
  const server=http.createServer((req,res)=>gateway.handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${server.address().port}/mcp/session-roles`;
  const make=()=>createSessionRoleMcpGateway({store:f.store,service:f.roles,callerForRun:f.callerForRun,qualifyRun:f.qualifyRun,endpoint,clock:()=>time,ttlMs:1000});gateway=make();
  t.after(async()=>{await gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const connect=async config=>{const client=new Client({name:'session-role-sdk-engineering-fixture',version:'1'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:config.headers}}));t.after(()=>client.close());return client;};
  return {...f,get gateway(){return gateway;},endpoint,connect,advance:()=>{time+=1001;},restart:async()=>{await gateway.close();gateway=make();}};
}

test('actual MCP SDK over loopback lists only two bounded tools; exact parent run can send once to approved child',async t=>{
  const f=await harness(t),grant=f.gateway.issueForRun(f.parent),client=await f.connect(grant.configuration);
  assert.equal(grant.nativeAttachmentStatus,'NATIVE_ATTACHMENT_NOT_CONFIGURED','SDK HTTP availability is not native attachment evidence');
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['session_children','session_prompt']);
  const listed=await client.callTool({name:'session_children',arguments:{}});assert.equal(listed.structuredContent.children[0].membershipId,f.m.id);
  const args={membershipId:f.m.id,operationId:'mcp-fixture-prompt',text:'Review bounded engineering work.'};const result=await client.callTool({name:'session_prompt',arguments:args});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.childRun.status,'running');
  await client.callTool({name:'session_prompt',arguments:args});assert.equal(f.ownerLifecycle.calls,1);assert.equal(f.ownerLifecycle.effects.length,1);
  const injected=await client.callTool({name:'session_prompt',arguments:{...args,threadId:'arbitrary-thread'}});assert.equal(injected.isError,true);assert.equal(f.ownerLifecycle.calls,1);
  const arbitrary=await client.callTool({name:'t3_thread_send',arguments:{threadId:'arbitrary-thread',message:'forbidden'}});assert.equal(arbitrary.isError,true);
  const cross=await client.callTool({name:'session_children',arguments:{projectId:f.q.id}});assert.equal(cross.isError,true);
  await f.roles.revoke({projectId:f.p.id,membershipId:f.m.id,operationId:'revoke-over-sdk',expectedRevision:1},f.owner);
  const revoked=await client.callTool({name:'session_prompt',arguments:{...args,operationId:'revoked-sdk'}});assert.equal(revoked.isError,true);assert.equal(f.ownerLifecycle.effects.length,1);
});

test('MCP lease binds attempt/role, expires, invalidates on Stop/restore/restart, and never persists bearer',async t=>{
  const f=await harness(t),grant=f.gateway.issueForRun(f.parent);
  assert.equal(JSON.stringify(f.store.read()).includes(grant.configuration.headers.Authorization),false);
  const fetchTools=()=>fetch(f.endpoint,{method:'POST',headers:{...grant.configuration.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal((await fetchTools()).status,200);
  f.advance();assert.equal((await fetchTools()).status,401);
  const live=f.gateway.issueForRun(f.store.read().runs[0]);grant.configuration=live.configuration;f.gateway.invalidateForRestore();assert.equal((await fetchTools()).status,401);
  const beforeRestart=f.gateway.issueForRun(f.store.read().runs[0]);grant.configuration=beforeRestart.configuration;await f.restart();assert.equal((await fetchTools()).status,401);
  const stopGrant=f.gateway.issueForRun(f.store.read().runs[0]);grant.configuration=stopGrant.configuration;await f.store.transaction(s=>{s.runs[0].stopRequest={status:'submitting'};});assert.equal((await fetchTools()).status,401);
  await f.store.transaction(s=>{delete s.runs[0].stopRequest;});
  const roleGrant=f.gateway.issueForRun(f.store.read().runs[0]);grant.configuration=roleGrant.configuration;await f.assign(f.chat.id,f.bot.id,'reviewer',1);assert.equal((await fetchTools()).status,401);
  await f.assign(f.chat.id,f.bot.id,'orchestrator',2);assert.throws(()=>f.gateway.issueForRun(f.store.read().runs[0]),{code:'SESSION_ROLE_STALE'},'a dispatched attempt cannot acquire a new role snapshot');
});

test('MCP authenticates before parsing, fences origin/host/body size, and refuses unqualified guarded routes',async t=>{
  const f=await harness(t),grant=f.gateway.issueForRun(f.parent);
  const send=(headers={},body='not json',suffix='')=>fetch(f.endpoint+suffix,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await send()).status,401);
  assert.equal((await send({...grant.configuration.headers,Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await send(grant.configuration.headers,'not json')).status,400);
  assert.equal((await send(grant.configuration.headers,'x'.repeat(196609))).status,413);
  assert.equal((await send(grant.configuration.headers,'{}','?arbitrary=1')).status,400);
  await f.store.transaction(s=>{s.runs[0].guardedContext={fixture:true};});
  assert.throws(()=>f.gateway.issueForRun(f.store.read().runs[0]),{code:'SESSION_ROLE_QUALIFICATION'});
});

test('MCP refusal and unknown delivery remain tool errors with durable command identity, never fabricated success',async t=>{
  const f=await harness(t),grant=f.gateway.issueForRun(f.parent),client=await f.connect(grant.configuration);
  f.ownerLifecycle.beforeReserve=()=>{throw Object.assign(new Error('fixture workspace busy'),{code:'WORKSPACE_BUSY'});};
  const args={membershipId:f.m.id,operationId:'refused-sdk',text:'Bounded refused fixture'};
  const refusal=await client.callTool({name:'session_prompt',arguments:args});assert.equal(refusal.isError,true);assert.equal(refusal.structuredContent.error.code,'WORKSPACE_BUSY');assert.ok(refusal.structuredContent.id);
  f.ownerLifecycle.beforeReserve=null;f.ownerLifecycle.loseResponse=true;
  const unknown=await client.callTool({name:'session_prompt',arguments:{...args,operationId:'unknown-sdk'}});assert.equal(unknown.isError,true);assert.equal(unknown.structuredContent.childRun.status,'unknown');
  await client.callTool({name:'session_prompt',arguments:{...args,operationId:'unknown-sdk'}});assert.equal(f.ownerLifecycle.effects.length,1);assert.equal(f.ownerLifecycle.calls,2);
});

test('private adapter uses actual canonical references without ordinary IDs; exact native call metadata and synchronous proof fence every call',async t=>{
  const f=await harness(t);let qualified=true;
  // INJECTED native observation/attestation qualification, NOT a native launch.
  const run=await f.store.transaction(s=>{const r=s.runs[0];delete r.providerRunId;delete r.t3ProjectId;r.rootNodeId='fixture-root';r.nativeProviderThreadId='fixture-provider-thread';r.nativeProviderTurnId='fixture-provider-turn';r.nativeThreadRef={nativeId:'fixture-native-session'};r.nativeTurnRef={nativeId:'fixture-native-turn'};r.guardedContext={profile:{purpose:'supervised-orchestrator-v1',manifestDigest:'a'.repeat(64)}};r.guardedProjection={providerThread:{id:r.nativeProviderThreadId,appThreadId:r.threadId,nativeThreadRef:r.nativeThreadRef},providerTurn:{id:r.nativeProviderTurnId,providerThreadId:r.nativeProviderThreadId,nodeId:r.rootNodeId,runAttemptId:r.attemptId,status:'running',nativeTurnRef:r.nativeTurnRef}};return r;});
  const binding={projectId:run.projectId,runId:run.id,attemptId:run.attemptId,threadId:run.threadId,providerThreadId:run.nativeProviderThreadId,providerTurnId:run.nativeProviderTurnId,nativeSessionId:run.nativeThreadRef.nativeId,nativeTurnId:run.nativeTurnRef.nativeId,identityKind:'private-adapter'};
  const qualification={purpose:'supervised-orchestrator-v1',manifestDigest:'a'.repeat(64),profileDigest:nativeDigest(run.guardedContext.profile),attestationDigest:'b'.repeat(64),binding};
  f.setQualifier(()=>qualified?qualification:null);const linked=await f.bind();
  assert.throws(()=>f.gateway.issueForRun(run,{...binding,attemptId:'foreign-attempt'}),{code:'SESSION_ROLE_BINDING'});
  const grant=f.gateway.issueForRun(run,binding),client=await f.connect(grant.configuration);
  const without=await client.callTool({name:'session_children',arguments:{}});assert.equal(without.isError,true);
  const meta={sessionId:binding.nativeSessionId,turnId:binding.nativeTurnId,callId:'actual-fixture-call',messageId:'actual-fixture-message'};
  const bad=await client.callTool({name:'session_children',arguments:{},_meta:{'forge/session-native-v1':{...meta,turnId:'foreign-turn'}}});assert.equal(bad.isError,true);
  const result=await client.callTool({name:'session_children',arguments:{},_meta:{'forge/session-native-v1':meta}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.children[0].membershipId,linked.id);
  const prompted=await client.callTool({name:'session_prompt',arguments:{membershipId:linked.id,operationId:'private-sdk-prompt',text:'Bounded private fixture advice'},_meta:{'forge/session-native-v1':meta}});assert.equal(prompted.isError,undefined);assert.equal(f.ownerLifecycle.effects.length,1);
  qualified=false;await assert.rejects(client.listTools());qualified=true;
  await f.store.transaction(s=>{s.runs[0].nativeTurnRef.nativeId='different-native-turn';});assert.throws(()=>f.gateway.issueForRun(f.store.read().runs[0],binding),{code:'SESSION_ROLE_BINDING'});
});
