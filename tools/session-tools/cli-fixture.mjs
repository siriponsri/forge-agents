// Actual NEW CLI + matching T3 adapter. Canonical SQLite role service/gateway;
// child conversation owner is explicitly INJECTED (no paid child turn).
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {randomBytes,createHmac} from 'node:crypto';
import {createInterface} from 'node:readline';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {digest,bytesDigest} from '../../app/guarded-runtime/profile.mjs';
import {openSessionNativeGateway} from '../../app/session-tools/native-gateway.mjs';
import {toolManifest,NATIVE_NAMES} from '../../app/session-tools/contract.mjs';
import {sessionArtifactInventory} from './pipeline.mjs';
import {registerHooks} from 'node:module';

const generation=path.resolve(process.argv[2]),serviceRoot=path.resolve(process.argv[3]??fileURLToPath(new URL('../..',import.meta.url))),stopCase=process.argv.includes('--stop');
const inventory=await sessionArtifactInventory(generation),meta=JSON.parse(await readFile(path.join(generation,'generation.json'),'utf8'));
// Read-only dependency fallback when consuming the separate role worker's
// checkout. No dependency links or source writes in that worker's tree.
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||specifier.startsWith('.')||specifier.startsWith('/')||specifier.startsWith('node:'))throw e;return {url:import.meta.resolve(specifier),shortCircuit:true};}}});
for(const name of ['t3','opencode'])assert.equal(JSON.parse(await readFile(path.join(generation,name+'-session-build.json'),'utf8')).exitCode,0);
const {fixture}=await import(pathToFileURL(path.join(serviceRoot,'tests/product-session-roles-fixture.mjs')).href);
const {createSessionRoleMcpGateway}=await import(pathToFileURL(path.join(serviceRoot,'app/server/session-roles-mcp.mjs')).href);
const after=[],f=await fixture({after:fn=>after.push(fn)});
const root=await mkdtemp(path.join(os.tmpdir(),'forge-session-cli-')),home=path.join(root,'home'),cwd=path.join(root,'runtime');await mkdir(home);await mkdir(cwd);
await writeFile(path.join(cwd,'AGENTS.md'),'UNAPPROVED_SESSION_CONTEXT_SENTINEL');
await writeFile(path.join(cwd,'opencode.json'),'{"mcp":{"evil":{"command":["shell"]}}}');
let native,driver,roleGateway,nativeGateway,currentThread,currentTurn,grant,link,stopped=false,revoked=false,profile,calls=0,nativeLogs='',driverLogs='',pending=Promise.resolve();const events=[],requests=[];
const run=()=>f.store.read().runs.find(x=>x.id==='run');
const live=()=>{if(stopped||Date.now()>=profile.expiresAt)throw Error('SESSION_NATIVE_STOPPED');return profile;};
const binding=()=>{live();if(!currentThread?.nativeThreadRef?.nativeId||!currentTurn?.nativeTurnRef?.nativeId||currentTurn.runAttemptId!=='attempt'||currentTurn.nodeId!=='node'||currentTurn.providerThreadId!==currentThread.id||currentTurn.status!=='running')throw Error('SESSION_NATIVE_BINDING');return {projectId:f.p.id,runId:'run',attemptId:'attempt',threadId:'thread',providerThreadId:currentThread.id,providerTurnId:currentTurn.id,nativeSessionId:currentThread.nativeThreadRef.nativeId,nativeTurnId:currentTurn.nativeTurnRef.nativeId,identityKind:'private-adapter'};};
await f.store.transaction(s=>{const r=s.runs[0];r.id='run';r.threadId='thread';r.attemptId='attempt';r.rootNodeId='node';delete r.providerRunId;delete r.t3ProjectId;});
Object.assign(f.parent,{id:'run',threadId:'thread',attemptId:'attempt'});
const args=()=>({membershipId:link.id,operationId:'native-session-advice',text:'Review bounded fixture work.'});
const steps=[['shell',{}],['unknown_future',{}],['forge_sessions_session_prompt_alias',{}],['forge_guarded_read_text',{path:'AGENTS.md'}],['forge_frontend_selection_read',{}],['forge_sessions_session_children',{}],['forge_sessions_session_children',{parentRunId:'foreign'}],['forge_sessions_session_prompt',()=>({...args(),membershipId:f.m.id,operationId:'foreign-parent'})],['forge_sessions_session_prompt',args],['forge_sessions_session_prompt',args],['forge_sessions_session_prompt',()=>({...args(),operationId:'revoked-advice'})],['forge_sessions_session_children',{}]];
const model=createServer(async(req,res)=>{
  try{
    let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests.push(body);const index=calls++;
    if(stopCase)return;
    if(index===10){await f.roles.revoke({projectId:f.p.id,membershipId:link.id,operationId:'native-revoke',expectedRevision:link.revision},f.owner);revoked=true;}
    const step=steps[index],delta=step?{role:'assistant',tool_calls:[{index:0,id:'session_call_'+index,type:'function',function:{name:step[0],arguments:JSON.stringify(typeof step[1]==='function'?step[1]():step[1])}}]}:{role:'assistant',content:'session native fixture complete'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'chatcmpl_sessions',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta,finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}})+'\n\ndata: [DONE]\n\n');
  }catch(e){res.writeHead(500);res.end(String(e));}
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
const provider={id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'fixture-no-account',transport:'http'}},manifest=toolManifest();
profile={version:1,purpose:'supervised-orchestrator-v1',projectId:f.p.id,taskId:'task',runId:'run',attemptId:'attempt',threadId:'thread',route:{providerInstanceId:'fixture',apiProviderId:'openai',modelId:'openai/forge-fixture',options:[{id:'variant',value:'default'}],opencodeBinarySha256:inventory.opencode.sha256},expiresAt:Date.now()+240000,manifestDigest:digest(manifest),contextDigest:digest({provider,runtimeDirectory:cwd,toolManifest:manifest}),toolGeneration:'sessions-v1',policyGeneration:'1'};
await f.store.transaction(s=>{s.runs[0].guardedContext={profile};});
f.setQualifier(()=>{try{return {purpose:profile.purpose,manifestDigest:profile.manifestDigest,profileDigest:digest(profile),attestationDigest:digest({binary:inventory.opencode.sha256,thread:currentThread?.nativeThreadRef,turn:currentTurn?.nativeTurnRef}),binding:binding()};}catch{return null;}});
const roleServer=createServer((req,res)=>roleGateway.handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));await new Promise(r=>roleServer.listen(0,'127.0.0.1',r));
roleGateway=createSessionRoleMcpGateway({store:f.store,service:f.roles,callerForRun:f.callerForRun,qualifyRun:f.qualifyRun,endpoint:`http://127.0.0.1:${roleServer.address().port}/mcp/session-roles`,ttlMs:120000});
nativeGateway=await openSessionNativeGateway({assertCurrent:live,bindingProvider:()=>binding(),attachmentProvider:b=>grant??(grant=roleGateway.issueForRun(run(),b)),authorizePhase:body=>{live();return body.sessionID===null||body.sessionID===currentThread?.nativeThreadRef?.nativeId;},withFence:fn=>f.store.transaction(()=>fn()),onClose:()=>grant?.revoke()});
const boot=nativeGateway.bootstrap(),password=randomBytes(32).toString('hex'),env={SystemRoot:process.env.SystemRoot,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,FORGE_GUARDED_BOOTSTRAP_FD:'3',OPENCODE_PASSWORD:password,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FILEWATCHER:'1',OPENCODE_DISABLE_FFF:'1'};
async function waitFor(predicate,ms=60000){const end=Date.now()+ms;while(!predicate()){if(Date.now()>=end||driver?.exitCode!==null&&driver?.exitCode!==undefined)throw Error('FIXTURE_WAIT_FAILED '+driverLogs.slice(-2500)+nativeLogs.slice(-1500));await new Promise(r=>setTimeout(r,25));}}
try{
  native=spawn(inventory.opencode.path,['serve','--hostname','127.0.0.1','--port','0'],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe']});native.stdout.on('data',b=>nativeLogs+=b);native.stderr.on('data',b=>nativeLogs+=b);native.stdio[3].end(JSON.stringify({version:1,profile,key:boot.key,brokerUrl:boot.brokerUrl,provider,runtimeDirectory:cwd,toolManifest:manifest}));
  await waitFor(()=>nativeLogs.match(/http:\/\/127\.0\.0\.1:[0-9]+/)||native.exitCode!==null,20000);const url=nativeLogs.match(/http:\/\/127\.0\.0\.1:[0-9]+/)?.[0];assert.ok(url,nativeLogs.slice(-2000));
  const driverPath=path.join(generation,'t3/packages/provider-opencode/forge-session-driver.ts');await copyFile(fileURLToPath(new URL('./t3-cli-driver.ts',import.meta.url)),driverPath);
  driver=spawn(process.execPath,[driverPath],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe','pipe']});const done=new Promise(r=>driver.once('close',r));driver.stderr.on('data',b=>driverLogs+=b);
  driver.stdio[3].end(JSON.stringify({nativeEntry:inventory.t3.entry,hostModule:fileURLToPath(new URL('../../app/guarded-runtime/t3-host.mjs',import.meta.url)),binary:inventory.opencode.path,url,password,cwd,profile,guardDefault:stopCase}));
  const lines=createInterface({input:driver.stdout});lines.on('line',line=>{try{const value=JSON.parse(line);events.push(value);
    if(value.kind==='thread'){currentThread=value.thread;pending=pending.then(()=>f.store.transaction(s=>{const r=s.runs[0];r.nativeProviderThreadId=currentThread.id;r.nativeThreadRef=currentThread.nativeThreadRef;r.guardedProjection={providerThread:currentThread};})).then(()=>stopCase?driver.stdin.write('mapped\n'):driver.stdin.end('mapped\n'));}
    if(value.kind==='native'&&value.event.type==='provider_turn.updated'){currentTurn=value.event.providerTurn;const observed=structuredClone(currentTurn);pending=pending.then(()=>f.store.transaction(s=>{const r=s.runs[0];r.nativeProviderTurnId=observed.id;r.nativeTurnRef=observed.nativeTurnRef;r.guardedProjection.providerTurn=observed;})).then(async()=>{if(!link&&observed.status==='running')link=await f.bind();});}
  }catch{driverLogs+=line+'\n';}});
  if(stopCase){
    await waitFor(()=>calls===1&&currentTurn?.status==='running');await pending;await f.store.transaction(s=>{s.runs[0].stopRequest={status:'requested'};});stopped=true;
    const raw=JSON.stringify({profileDigest:digest(profile),sessionId:currentThread.nativeThreadRef.nativeId,callId:'after-stop',messageId:'msg'});const denied=await fetch(boot.brokerUrl+'/session-binding',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+boot.key,'X-Forge-Mac':createHmac('sha256',Buffer.from(boot.key,'hex')).update(raw).digest('hex')},body:raw});assert.equal(denied.status,403);driver.stdin.end('stop\n');
  }
  const timeout=setTimeout(()=>driver.kill(),150000);const exit=await done;clearTimeout(timeout);await pending;assert.equal(exit,0,driverLogs.slice(-5000));
  assert.deepEqual(requests[0].tools.map(x=>x.function.name).sort(),[...NATIVE_NAMES].sort());
  if(!stopCase){
    assert.equal(calls,steps.length+1);const messages=requests.at(-1).messages,tool=n=>JSON.parse(messages.find(m=>m.role==='tool'&&m.tool_call_id==='session_call_'+n).content);
    assert.equal(tool(5).children[0].membershipId,link.id);assert.equal(tool(8).childRun.status,'running');assert.equal(tool(9).childRun.id,tool(8).childRun.id);
    // Pinned native JSON-schema decoding removes undeclared keys before execute.
    // Foreign model JSON therefore cannot change the canonical parent scope.
    assert.equal(tool(6).parentRunId,'run');
    for(const n of [0,1,2,3,4,7,10])assert.ok(tool(n).error,'failed native result '+n);
    assert.deepEqual(tool(11).children,[]);assert.ok(revoked);assert.equal(f.ownerLifecycle.effects.length,1);assert.equal(f.ownerLifecycle.calls,1);
    const raw=JSON.stringify({profileDigest:digest(profile),sessionId:'foreign-session',callId:'c',messageId:'msg'});assert.equal((await fetch(boot.brokerUrl+'/session-binding',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+boot.key,'X-Forge-Mac':createHmac('sha256',Buffer.from(boot.key,'hex')).update(raw).digest('hex')},body:raw})).status,403);
    assert.equal(JSON.stringify(requests).includes('UNAPPROVED_SESSION_CONTEXT_SENTINEL'),false);assert.equal(JSON.stringify(requests).includes(boot.key),false);assert.equal(JSON.stringify(requests).includes(grant.configuration.headers.Authorization),false);
  }
  const evidence={version:1,scope:'actual NEW compiled CLI and matching compiled T3 adapter, actual SQLite role service/private SDK gateway; INJECTED_CHILD_CONVERSATION_OWNER',observedAt:new Date().toISOString(),generation,cliBinarySha256:inventory.opencode.sha256,t3BundleAndNodeSha256:inventory.t3.sha256,actualSameNativeTurnResult:!stopCase,actualStop:stopCase,terminal:events.find(x=>x.kind==='done')?.status,modelRequests:calls,advertisedTools:requests[0].tools.map(x=>x.function.name),nativeThreadRef:currentThread.nativeThreadRef,nativeTurnRef:currentTurn.nativeTurnRef,childOwnerEffects:f.ownerLifecycle.effects.length,negatives:stopCase?['Stop binding denied','actual T3 interrupt terminal']:['unknown','alias','Guarded file tool','frontend tool','foreign-parent JSON','foreign membership','revoke','session binding'],externalRequests:0,proof:null,homeUat:'NOT_RUN'};
  await writeFile(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,evidencePath:path.join(root,'evidence.json')},null,2));
}finally{
  stopped=true;await nativeGateway?.close();await roleGateway?.close();roleServer.closeAllConnections();await new Promise(r=>roleServer.close(r));
  if(driver?.exitCode===null)driver.kill();if(native?.exitCode===null)native.kill();model.closeAllConnections();await new Promise(r=>model.close(r));
  await writeFile(path.join(root,'native.log'),nativeLogs);await writeFile(path.join(root,'driver.log'),driverLogs);await writeFile(path.join(root,'debug.json'),JSON.stringify({calls,events,messages:requests.map(x=>x.messages)},null,2));
  for(const fn of after.reverse())await fn();
}
