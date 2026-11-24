import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openStore } from '../app/server/store.mjs';
import { entity } from '../app/server/domain.mjs';
import { createColabMcpAdapter, validateColabMcpConfig } from '../app/compute/colab-mcp.mjs';

// Explicit engineering fixture; no Google request/account/runtime is used.
// Tool fields mirror the primary Google reference updated 2026-11-13/20.
const str = { type: 'string' };
const shape = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const schemas = {
  get_runtime: shape({ name: str }, ['name']),
  list_runtimes: shape({}),
  list_sessions: shape({ parent: str }, ['parent']),
  create_session: shape({ parent: str, sessionId: str, session: shape({ name: str }) }, ['parent']),
  delete_session: shape({ name: str }, ['name']),
  execute_code: { ...shape({ code: str, executionId: str, session: str, runtime: str }, ['code']), oneOf: [{ required: ['session'], not: { required: ['runtime'] } }, { required: ['runtime'], not: { required: ['session'] } }] },
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
async function waitFor(fn, predicate) { for (let n=0;n<150;n++) { const v=await fn(); if(predicate(v))return v; await new Promise(r=>setTimeout(r,25)); } throw new Error('Fixture observation timed out'); }
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-colab-mcp-'));
  const store = await openStore(dir), sessions = new Set(['runtimes/owner-existing/sessions/owner-notebook']);
  const calls = [], children = new Map(), transports = new Set(), roots = new Map(), puts = [];
  let authStatus = 0, badRuntime = false, badSession = false, badReceipt = false, loseResult = false, holdCreate = false, releaseCreate, staleProxy = false, losePut = false;
  let project, notebook, other;
  await store.transaction(s => { project=entity({name:'Disposable Colab contract fixture',workspace:dir,profile:{compute:{},limits:{jobSeconds:15}}}); other=entity({name:'Other project',workspace:dir,profile:{compute:{}}}); notebook=entity({name:'Python',language:'python',code:"print('observed Python execution')"},project.id);s.projects.push(project,other);s.notebooks.push(notebook); });
  const server=http.createServer(async(req,res)=>{
    try {
      if (req.url === '/mcp') {
        if (authStatus) return json(res, {error:'fixture auth rejected'}, authStatus);
        assert.equal(req.headers.authorization, 'Bearer fixture-machine-bearer');
        const sdk=new Server({name:'labelled-colab-contract-fixture',version:'2026-11-20'}, {capabilities:{tools:{}}});
        sdk.setRequestHandler(ListToolsRequestSchema,()=>({tools:Object.entries(schemas).filter(([name])=>name!==options.missingTool).map(([name,inputSchema])=>({name,inputSchema}))}));
        sdk.setRequestHandler(CallToolRequestSchema,async request=>{
          const {name,arguments:a}=request.params;calls.push({name,args:structuredClone(a)});
          let result;
          if(name==='get_runtime')result={name:badRuntime?'runtimes/other':a.name,runtimeSpec:{variant:'VARIANT_CPU',accelerator:'NONE',shape:'SHAPE_STANDARD'},version:'2026.11',connectionInfo:{url:base+'/runtime',token:'fixture-runtime-proxy',expireTime:new Date(Date.now()+3600000).toISOString()}};
          if(name==='list_runtimes')result={runtimes:[]};
          if(name==='list_sessions')result={sessions:[...sessions].filter(n=>n.startsWith(a.parent+'/')).map(name=>({name}))};
          if(name==='create_session'){
            if(holdCreate)await new Promise(r=>releaseCreate=r);
            const actual=`${a.parent}/sessions/${a.sessionId}`;sessions.add(actual);result={name:badSession?'runtimes/other/sessions/unowned':actual};
          }
          if(name==='delete_session'){
            assert.notEqual(a.name,'runtimes/owner-existing/sessions/owner-notebook');
            sessions.delete(a.name);children.get(a.name)?.kill();result={};
          }
          if(name==='execute_code'){
            assert.equal(a.runtime,undefined);assert.ok(a.executionId);assert.ok(sessions.has(a.session));
            const encoded=a.code.match(/base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/)?.[1];assert.ok(encoded);
            const payload=JSON.parse(Buffer.from(encoded,'base64'));const local=path.join(dir,payload.identity.jobId);roots.set(payload.root,local);await mkdir(local,{recursive:true});
            // Only filesystem root is substituted for Windows engineering fixtures.
            // The exact supervisor and Python source otherwise execute unchanged.
            const code=a.code.replace(encoded,Buffer.from(JSON.stringify({...payload,root:local})).toString('base64'));
            let stdout='',stderr='';const child=spawn('python',['-u','-c',code],{windowsHide:true});children.set(a.session,child);
            child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
            await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});children.delete(a.session);
            if(badReceipt){const file=path.join(local,'.forge-receipt.json');const r=JSON.parse(await readFile(file,'utf8'));r.projectId='other-project';await writeFile(file,JSON.stringify(r));}
            if(loseResult)return {isError:true,content:[{type:'text',text:'UNAVAILABLE: response lost after execution'}]};
            result={executionId:a.executionId,session:a.session,executionCount:1,stdout,stderr,outputTruncated:false};
          }
          return {content:[],structuredContent:result};
        });
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});transports.add(transport);
        await sdk.connect(transport);res.on('close',()=>{transports.delete(transport);transport.close().catch(()=>{});});
        return await transport.handleRequest(req,res);
      }
      assert.equal(req.headers['x-colab-runtime-proxy-token'],'fixture-runtime-proxy');
      assert.equal(req.headers.authorization,undefined);
      if(staleProxy){staleProxy=false;return json(res,{},404);}
      const download=req.url.startsWith('/runtime/files/'),upload=req.url.startsWith('/runtime/api/contents/');
      assert.ok(download||upload);const remote=decodeURIComponent(req.url.slice(download?'/runtime/files'.length:'/runtime/api/contents'.length));
      const entry=[...roots].find(([root])=>remote===root||remote.startsWith(root+'/'));
      if(!entry)return json(res,{},404);
      const file=path.join(entry[1],remote.slice(entry[0].length));
      if(upload){let text='';for await(const b of req)text+=b;const body=JSON.parse(text);puts.push({remote,...body});if(body.type==='directory'){await mkdir(file,{recursive:true});return json(res,{});}const chunk=Buffer.from(body.content,'base64');await writeFile(file,chunk,{flag:body.chunk&&body.chunk!==1?'a':'w'});if(losePut){losePut=false;return json(res,{},503);}return json(res,{});}
      try {const bytes=await readFile(file);const tail=req.headers.range;const body=tail?bytes.subarray(-200000):bytes;res.writeHead(tail?206:200);res.end(body);}catch{return json(res,{},404);}
    } catch(e){if(!res.headersSent)json(res,{error:e.message},500);else res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const machineEnv={COLAB_FIXTURE_BEARER:'fixture-machine-bearer'};
  const adapter=createColabMcpAdapter({store,dataDir:dir,machineEnv,fixtureEndpoint:base+'/mcp',...options.adapterOptions});
  const config={kind:'colab-mcp',runtimeName:'runtimes/owner-existing',authEnv:'COLAB_FIXTURE_BEARER',timeoutMs:1000};
  const target=await adapter.configure({projectId:project.id,config,select:true});
  t.after(async()=>{for(const c of children.values())c.kill();releaseCreate?.();await adapter.shutdown();for(const tr of transports)await tr.close();server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,store,adapter,project,notebook,other,target,config,calls,sessions,puts,roots,base,machineEnv,
    auth:v=>authStatus=v,badRuntime:v=>badRuntime=v,badSession:v=>badSession=v,badReceipt:v=>badReceipt=v,loseResult:v=>loseResult=v,holdCreate:v=>holdCreate=v,releaseCreate:()=>releaseCreate?.(),staleProxy:()=>staleProxy=true,losePut:()=>losePut=true};
}
const start=x=>({projectId:x.project.id,notebookId:x.notebook.id,operationId:randomUUID()});
const jobInput=(x,j)=>({projectId:x.project.id,jobId:j.id});
const settled=(x,j)=>waitFor(()=>x.adapter.status(jobInput(x,j)),v=>['completed','failed','stopped'].includes(v.status));

test('configuration accepts machine env/vault refs only; explicit existing runtime and project boundaries',async t=>{
  const x=await fixture(t);
  for(const change of [{token:'raw-secret'},{baseUrl:'https://evil.invalid'},{runtimeName:'projects/other/runtimes/id'},{authEnv:'Bearer secret'},{authVaultRef:'vault/credential'},{timeoutMs:1}])assert.throws(()=>validateColabMcpConfig({...x.config,...change}),{code:'COLAB_CONFIG'});
  assert.equal(validateColabMcpConfig({kind:'colab-mcp',runtimeName:'runtimes/id',authVaultRef:'vault/colab-owner'}).authVaultRef,'vault/colab-owner');
  await assert.rejects(x.adapter.configure({projectId:x.other.id,targetId:x.target.id,config:x.config,expectedRevision:1}),{code:'NOT_FOUND'});
  await assert.rejects(x.adapter.health({projectId:x.other.id,targetId:x.target.id}),{code:'NOT_FOUND'});
  assert.equal(x.calls.length,0);
});

test('SDK HTTP discovery checks required official schemas and runtime identity; health is not execution proof',async t=>{
  const x=await fixture(t);const health=await x.adapter.health({projectId:x.project.id});
  assert.equal(health.verified,true);assert.equal(health.execution,true);assert.equal(health.executionVerified,false);assert.equal(health.provisioning,false);
  assert.deepEqual(x.calls.map(c=>c.name),['get_runtime']);assert.equal(health.runtime.runtimeName,x.config.runtimeName);
  x.badRuntime(true);assert.equal((await x.adapter.health({projectId:x.project.id})).errorCode,'COLAB_IDENTITY');
  const missing=await fixture(t,{missingTool:'execute_code'});assert.equal((await missing.adapter.health({projectId:missing.project.id})).errorCode,'COLAB_CAPABILITY');assert.equal(missing.calls.length,0);
});

test('actual Python lifecycle has source/config/session provenance, immutable operation replay, logs, cleanup and restart truth',async t=>{
  const x=await fixture(t),input=start(x);const [first,replayed]=await Promise.all([x.adapter.start(input),x.adapter.start(input)]);assert.equal(first.id,replayed.id);
  const done=await settled(x,first);assert.equal(done.status,'completed');assert.match(done.logs,/observed Python execution/);assert.equal(done.source.sha256,sha(x.notebook.code));assert.ok(done.environment.version);
  await waitFor(()=>x.store.read().jobs[0],j=>!!j.sessionClosedAt);assert.ok(x.sessions.has('runtimes/owner-existing/sessions/owner-notebook'));
  await x.store.transaction(s=>{s.notebooks[0].code="print('edited later')";s.notebooks[0].revision++;s.connections[0].config.runtimeName='runtimes/new-selection';});
  assert.equal((await x.adapter.start(input)).id,first.id);assert.equal(x.calls.filter(c=>c.name==='execute_code').length,1);
  await assert.rejects(x.adapter.start({...input,targetId:'different'}),{code:'OPERATION_REUSE'});
  await assert.rejects(x.adapter.logs({projectId:x.other.id,jobId:first.id}),{code:'NOT_FOUND'});
  await assert.rejects(x.adapter.start({...start(x),mode:'resume',previousJobId:first.id}),{code:'RESUME_UNSUPPORTED'});
  const exported=await x.adapter.exportNotebook(jobInput(x,first));assert.equal(sha(exported.content),exported.sha256);assert.equal(JSON.parse(exported.content).metadata.forge.sourceSha256,done.source.sha256);
  const restarted=await x.adapter.start({...start(x),previousJobId:first.id});assert.notEqual(restarted.id,first.id);assert.notEqual(restarted.remote.session,first.remote.session);assert.equal((await settled(x,restarted)).status,'completed');
  assert.ok(x.calls.every(c=>!['create_runtime','delete_runtime'].includes(c.name)));
  assert.doesNotMatch(JSON.stringify(x.store.read()),/fixture-machine-bearer|fixture-runtime-proxy/);
});

test('lost terminal response reconciles HTTP receipt after adapter restart without duplicate execution',async t=>{
  const x=await fixture(t);x.loseResult(true);const input=start(x),j=await x.adapter.start(input);
  await waitFor(()=>x.store.read().jobs[0],v=>v.status==='unknown');
  const next=createColabMcpAdapter({store:x.store,dataDir:x.dir,machineEnv:x.machineEnv,fixtureEndpoint:x.base+'/mcp'});t.after(()=>next.shutdown());
  const before=x.calls.filter(c=>c.name==='execute_code').length;
  const observed=await next.reconcile(jobInput(x,j));assert.equal(observed.status,'completed');assert.match(observed.logs,/observed Python/);
  assert.equal((await next.start(input)).id,j.id);assert.equal(x.calls.filter(c=>c.name==='execute_code').length,before);
  assert.equal(x.calls.filter(c=>c.name==='create_session').length,1);
});

test('runtime claim prevents duplicate source effects even if an external client reuses a terminal executionId',async t=>{
  const x=await fixture(t);await x.store.transaction(s=>{s.notebooks[0].code="from pathlib import Path\np=Path('counter.txt')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nprint('source effect recorded')";});
  const j=await x.adapter.start(start(x));assert.equal((await settled(x,j)).status,'completed');await waitFor(()=>x.store.read().jobs[0],v=>!!v.dispatchFinishedAt);
  const a=x.calls.find(c=>c.name==='execute_code').args; x.sessions.add(j.remote.session);
  const client=new Client({name:'explicit-replay-contract-fixture',version:'1'},{capabilities:{}});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(x.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer fixture-machine-bearer'}}}));
    const result=await client.callTool({name:'execute_code',arguments:a});assert.match(result.structuredContent.stdout,/never execute twice/);
    assert.equal(await readFile(path.join(x.roots.get(j.remote.workspace),'counter.txt'),'utf8'),'1');
  }finally{await client.close();}
});

test('stop closes only the owned session; unknown dispatch is not claimed stopped and can reconcile',async t=>{
  const x=await fixture(t);await x.store.transaction(s=>{s.notebooks[0].code="import time\nprint('before stop',flush=True)\ntime.sleep(30)";});
  const j=await x.adapter.start(start(x));await waitFor(()=>x.adapter.status(jobInput(x,j)),v=>v.status==='running');
  const stopped=await x.adapter.stop(jobInput(x,j));assert.equal(stopped.status,'stopped');assert.ok(stopped.stopRequested);
  assert.ok(x.sessions.has('runtimes/owner-existing/sessions/owner-notebook'));
  const deletes=x.calls.filter(c=>c.name==='delete_session');assert.ok(deletes.length);assert.ok(deletes.every(c=>c.args.name===j.remote.session));
  await waitFor(()=>x.store.read().jobs[0],j=>!!j.dispatchFinishedAt);
  await x.store.transaction(s=>{s.jobs[0].status='unknown';s.jobs[0].dispatchStage='executing';s.jobs[0].remote.workspace+='/missing';});
  const count=x.calls.filter(c=>c.name==='delete_session').length;assert.equal((await x.adapter.stop(jobInput(x,j))).status,'unknown');assert.equal(x.calls.filter(c=>c.name==='delete_session').length,count);
});

test('stop while session creation is pending prevents execution after delayed response',async t=>{
  const x=await fixture(t);x.holdCreate(true);const j=await x.adapter.start(start(x));
  await waitFor(()=>x.calls,v=>v.some(c=>c.name==='create_session'));
  assert.equal((await x.adapter.stop(jobInput(x,j))).status,'unknown');x.releaseCreate();
  const stopped=await settled(x,j);assert.equal(stopped.status,'stopped');assert.equal(x.calls.filter(c=>c.name==='execute_code').length,0);
});

test('runtime/session/receipt identity failures and transient auth keep uncertain outcomes separate',async t=>{
  const x=await fixture(t);x.auth(403);const unhealthy=await x.adapter.health({projectId:x.project.id});assert.equal(unhealthy.execution,false);
  x.auth(0);assert.equal((await x.adapter.health({projectId:x.project.id})).execution,true);
  x.badSession(true);const unknown=await x.adapter.start(start(x));await waitFor(()=>x.store.read().jobs[0],v=>v.status==='unknown');assert.equal(x.calls.filter(c=>c.name==='execute_code').length,0);
  assert.equal((await x.adapter.reconcile(jobInput(x,unknown))).status,'unknown');
  const y=await fixture(t);y.badReceipt(true);const j=await y.adapter.start(start(y));await waitFor(()=>y.store.read().jobs[0],v=>v.errorCode==='COLAB_RECEIPT');assert.equal((await y.adapter.status(jobInput(y,j))).status,'unknown');
});

test('HTTP file transfer verifies raw byte hashes, confines paths, chunks uploads and persists credential-free receipts',async t=>{
  const x=await fixture(t);const j=await x.adapter.start(start(x));await settled(x,j);
  const bytes=Buffer.from('actual artifact bytes \u0e44\u0e17\u0e22'),input={...jobInput(x,j),operationId:randomUUID(),relativePath:'outputs/model.bin',bytes,sha256:sha(bytes)};
  const uploaded=await x.adapter.uploadArtifact(input);assert.equal(uploaded.status,'completed');assert.equal(uploaded.sha256,sha(bytes));
  assert.equal((await x.adapter.uploadArtifact(input)).verifiedAt,uploaded.verifiedAt);
  const downloaded=await x.adapter.downloadArtifact({...jobInput(x,j),operationId:randomUUID(),relativePath:input.relativePath,sha256:sha(bytes)});assert.equal(downloaded.status,'completed');assert.deepEqual(await readFile(downloaded.localPath),bytes);
  await assert.rejects(x.adapter.uploadArtifact({...input,operationId:randomUUID(),sha256:'a'.repeat(64)}),{code:'COLAB_FILE_HASH'});
  await assert.rejects(x.adapter.downloadArtifact({...jobInput(x,j),operationId:randomUUID(),relativePath:'../owner-file',sha256:sha(bytes)}),{code:'COLAB_PATH'});
  const wrong=await x.adapter.downloadArtifact({...jobInput(x,j),operationId:randomUUID(),relativePath:input.relativePath,sha256:'a'.repeat(64)});assert.equal(wrong.status,'failed');assert.equal(wrong.errorCode,'COLAB_FILE_HASH');
  const big=Buffer.alloc(9*1024*1024,7);const chunked=await x.adapter.uploadArtifact({...jobInput(x,j),operationId:randomUUID(),relativePath:'chunks.bin',bytes:big,sha256:sha(big)});assert.equal(chunked.status,'completed');assert.deepEqual(x.puts.filter(v=>v.remote.endsWith('/chunks.bin')).map(v=>v.chunk),[1,-1]);
  x.staleProxy();assert.equal((await x.adapter.downloadArtifact({...jobInput(x,j),operationId:randomUUID(),relativePath:input.relativePath,sha256:sha(bytes)})).status,'completed');
  x.losePut();const uncertainInput={...input,operationId:randomUUID(),relativePath:'uncertain.bin'};const uncertain=await x.adapter.uploadArtifact(uncertainInput);assert.equal(uncertain.status,'unknown');const putCount=x.puts.length;
  assert.equal((await x.adapter.uploadArtifact(uncertainInput)).status,'unknown');
  assert.equal((await x.adapter.reconcileTransfer({projectId:x.project.id,operationId:uncertainInput.operationId})).status,'completed');assert.equal(x.puts.length,putCount);
  assert.doesNotMatch(JSON.stringify(x.store.read()),/fixture-machine-bearer|fixture-runtime-proxy|actual artifact bytes/);
});

test('source exception is failed; vault resolver is called per request without persistence',async t=>{
  let vaultCalls=0;const x=await fixture(t,{adapterOptions:{resolveBearer:async({vaultRef})=>{assert.equal(vaultRef,'owner/colab');vaultCalls++;return 'fixture-machine-bearer';}}});
  await x.adapter.configure({projectId:x.project.id,targetId:x.target.id,expectedRevision:x.target.revision,config:{kind:'colab-mcp',runtimeName:'runtimes/owner-existing',authVaultRef:'owner/colab'}});
  await x.store.transaction(s=>{s.notebooks[0].code="raise ValueError('observed failure')";});
  const j=await x.adapter.start(start(x));const failed=await settled(x,j);assert.equal(failed.status,'failed');assert.match(failed.logs,/observed failure/);assert.ok(vaultCalls>3);
  assert.equal(failed.configSnapshot.authVaultRef,'owner/colab');assert.doesNotMatch(JSON.stringify(x.store.read()),/fixture-machine-bearer|fixture-runtime-proxy/);
});

test('temporary auth failure during running work recovers observations and cannot resubmit code',async t=>{
  const x=await fixture(t);await x.store.transaction(s=>{s.notebooks[0].code="import time\nprint('running before transient auth',flush=True)\ntime.sleep(0.5)\nprint('finished once')";});
  const input=start(x),j=await x.adapter.start(input);await waitFor(()=>x.adapter.status(jobInput(x,j)),v=>v.status==='running');
  x.auth(403);assert.equal((await x.adapter.status(jobInput(x,j))).status,'unknown');assert.equal((await x.adapter.start(input)).id,j.id);
  x.auth(0);assert.equal((await settled(x,j)).status,'completed');assert.equal(x.calls.filter(c=>c.name==='execute_code').length,1);
});

test('shutdown detaches observation without cancelling owned runtime work; new adapter recovers the receipt',async t=>{
  const x=await fixture(t);await x.store.transaction(s=>{s.notebooks[0].code="import time\nprint('running across client shutdown',flush=True)\ntime.sleep(0.4)\nprint('completed across shutdown')";});
  const j=await x.adapter.start(start(x));await waitFor(()=>x.adapter.status(jobInput(x,j)),v=>v.status==='running');
  await x.adapter.shutdown();assert.ok(x.sessions.has(j.remote.session));assert.equal(x.calls.filter(c=>c.name==='delete_session').length,0);
  const next=createColabMcpAdapter({store:x.store,dataDir:x.dir,machineEnv:x.machineEnv,fixtureEndpoint:x.base+'/mcp'});t.after(()=>next.shutdown());
  const done=await waitFor(()=>next.status(jobInput(x,j)),v=>v.status==='completed');assert.match(done.logs,/completed across shutdown/);assert.equal(x.calls.filter(c=>c.name==='execute_code').length,1);
});
