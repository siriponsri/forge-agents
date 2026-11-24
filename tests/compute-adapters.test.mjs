import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openStore } from '../app/server/store.mjs';
import { entity } from '../app/server/domain.mjs';
import { createJobService } from '../app/server/jobs.mjs';
import { createComputeService } from '../app/compute/index.mjs';
import { validateConfig, hash } from '../app/compute/common.mjs';
import { ssh, sshArgs } from '../app/compute/ssh.mjs';

// Disposable contract fixture, NOT a real Jupyter/provider service or cloud qualification.
async function httpFixture(t,handler){
  const seen=[];const server=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);let body;try{body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;}catch{}
    seen.push({method:req.method,path:req.url,body,auth:req.headers.authorization});
    try{await handler(req,res,body);}catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {server,seen,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
async function setup(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-compute-fixture-'));const store=await openStore(dir);
  const workspace=path.join(dir,'workspace');await mkdir(workspace);let project,other,notebook,phase;
  await store.transaction(s=>{project=entity({name:'Disposable compute contract fixture',workspace,profile:{compute:{kind:'local'},phaseOverrides:{},limits:{jobSeconds:3}}});other=entity({name:'Isolation fixture',workspace,profile:{compute:{kind:'local'}}});notebook=entity({name:'Harmless Python',language:'python',code:"print('actual Python behind labelled HTTP fixture')"},project.id);phase=entity({name:'Fixture phase'},project.id);s.projects.push(project,other);s.notebooks.push(notebook);s.phases.push(phase);});
  const localJobs=createJobService({store,dataDir:dir});const localFacade={start:({resolvedCompute,...input})=>localJobs.start(input,{resolvedCompute}),stop:id=>localJobs.stop(id)};const service=createComputeService({store,dataDir:dir,localJobs:localFacade});
  t.after(async()=>{await service.shutdown();await localJobs.shutdown();await new Promise(r=>setTimeout(r,60));await store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,store,project,other,notebook,phase,service,localJobs};
}
const startInput=x=>({projectId:x.project.id,notebookId:x.notebook.id,operationId:randomUUID()});
async function waitFor(fn,predicate){for(let i=0;i<100;i++){const v=await fn();if(predicate(v))return v;await new Promise(r=>setTimeout(r,40));}throw new Error('Fixture observation timed out');}

test('configuration rejects credentials/options injection; profiles and phase selections stay project-scoped',async t=>{
  const x=await setup(t);
  for(const c of [{kind:'jupyter',baseUrl:'https://token@example.com',workspace:'work',authEnv:'TOKEN'},{kind:'jupyter',baseUrl:'http://example.com',workspace:'work',authEnv:'TOKEN'},{kind:'local',apiKey:'never-persist'},{kind:'owner-ssh',host:'-oProxyCommand=evil',user:'root',workspace:'/work',knownHostsFileEnv:'KNOWN'},{kind:'jupyter',baseUrl:'https://example.com',workspace:'../secret',authEnv:'TOKEN'}])assert.throws(()=>validateConfig(c),{code:'COMPUTE_CONFIG'});
  const local=await x.service.configure({projectId:x.project.id,config:{kind:'local'},select:true});
  const colab=await x.service.configure({projectId:x.project.id,config:{kind:'colab-browser'},select:true,phaseId:x.phase.id});
  assert.equal(x.store.read().projects.find(p=>p.id===x.other.id).profile.compute.kind,'local');
  assert.equal(x.store.read().projects.find(p=>p.id===x.project.id).profile.compute.connectionId,local.id);
  assert.equal((await x.service.health({projectId:x.project.id,phaseId:x.phase.id})).interactive,true);
  await assert.rejects(x.service.configure({projectId:x.other.id,targetId:local.id,expectedRevision:local.revision,config:{kind:'local'}}),{code:'NOT_FOUND'});
  await assert.rejects(x.service.configure({projectId:x.project.id,targetId:colab.id,expectedRevision:99,config:{kind:'local'}}),{code:'REVISION_CONFLICT'});
  await assert.rejects(x.service.health({projectId:x.other.id,phaseId:x.phase.id}),{code:'NOT_FOUND'});
});

test('local execution keeps existing job owner and stable operation/source; errors and stop are real processes',async t=>{
  const x=await setup(t);const input=startInput(x);const [first,replayed]=await Promise.all([x.service.start(input),x.service.start(input)]);assert.equal(first.id,replayed.id);
  const done=await waitFor(()=>x.service.status({projectId:x.project.id,jobId:first.id}),j=>j.status==='completed');assert.match(done.logs,/actual Python/);assert.equal(x.store.read().jobs.length,1);assert.equal(done.computeAttempt.kind,'local');assert.equal(done.source.sha256,hash(x.notebook.code));
  await assert.rejects(x.service.start({...input,targetId:'different'}),{code:'OPERATION_REUSE'});
  await assert.rejects(x.service.logs({projectId:x.other.id,jobId:done.id}),{code:'NOT_FOUND'});
  await x.store.transaction(s=>{s.notebooks[0].code="raise ValueError('labelled fixture failure')";s.notebooks[0].revision++;});
  const failed=await x.service.start(startInput(x));assert.equal((await waitFor(()=>x.service.status({projectId:x.project.id,jobId:failed.id}),j=>j.status==='failed')).source.revision,2);
  await x.store.transaction(s=>{s.notebooks[0].code='import time\ntime.sleep(30)';s.notebooks[0].revision++;});
  const sleeping=await x.service.start(startInput(x));await x.service.stop({projectId:x.project.id,jobId:sleeping.id});
  assert.equal((await waitFor(()=>x.service.status({projectId:x.project.id,jobId:sleeping.id}),j=>j.status==='stopped')).status,'stopped');
  await assert.rejects(x.service.start({...startInput(x),mode:'resume',previousJobId:sleeping.id}),{code:'RESUME_UNSUPPORTED'});
});

// Minimal RFC6455 server codec to exercise Node's real WebSocket + real Python wrapper.
function frame(text){const b=Buffer.from(text);const h=b.length<126?Buffer.from([0x81,b.length]):Buffer.from([0x81,126,b.length>>8,b.length&255]);return Buffer.concat([h,b]);}
function receive(socket,callback){let pending=Buffer.alloc(0);socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=2){let len=pending[1]&127,offset=2;if(len===126){if(pending.length<4)return;len=pending.readUInt16BE(2);offset=4;}else if(len===127){if(pending.length<10)return;len=Number(pending.readBigUInt64BE(2));offset=10;}const masked=!!(pending[1]&128);if(pending.length<offset+(masked?4:0)+len)return;const mask=masked?pending.subarray(offset,offset+4):null;offset+=masked?4:0;const data=Buffer.from(pending.subarray(offset,offset+len)),opcode=pending[0]&15;pending=pending.subarray(offset+len);if(mask)for(let i=0;i<data.length;i++)data[i]^=mask[i%4];if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}if(opcode===1)callback(JSON.parse(data.toString()));}});}
async function jupyterFixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-jupyter-contract-'));const sessions=new Map(),children=new Set(),sockets=new Set();let executions=0,slow=false;
  const f=await httpFixture(t,async(req,res,body)=>{
    if(req.headers.authorization!=='token fixture-jupyter-secret')return json(res,{error:'unauthorized'},403);
    if(slow===true||(slow==='sessions'&&req.url==='/api/sessions')){await new Promise(r=>setTimeout(r,200));return json(res,{});}
    if(req.url==='/api/kernelspecs')return json(res,{kernelspecs:{python3:{}}});
    if(req.url==='/api/sessions'&&req.method==='POST'){const id=randomUUID(),kernelId=randomUUID();sessions.set(id,{id,kernel:{id:kernelId},path:body.path});return json(res,sessions.get(id),201);}
    if(req.url.startsWith('/api/sessions/'))return json(res,sessions.get(req.url.split('/').at(-1))??{},200);
    if(req.url.includes('/interrupt')){for(const child of children)child.kill();for(const file of await (await import('node:fs/promises')).readdir(dir)){if(file.endsWith('.json')){const p=path.join(dir,file),r=JSON.parse(await readFile(p,'utf8'));if(r.status==='running')await writeFile(p,JSON.stringify({...r,status:'interrupted'}));}}return json(res,{},204);}
    if(req.url.startsWith('/api/contents/')){const file=decodeURIComponent(req.url.split('/').at(-1));try{return json(res,{content:await readFile(path.join(dir,file),'utf8')});}catch{return json(res,{},404);}}
    return json(res,{},404);
  });
  f.server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const u=new URL(req.url,f.baseUrl);if(u.searchParams.get('token')!=='fixture-jupyter-secret')return socket.destroy();
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    receive(socket,msg=>{executions++;const child=spawn('python',['-u','-c',msg.content.code],{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe']});children.add(child);child.stderr.on('data',()=>{});child.on('exit',()=>{children.delete(child);if(!socket.destroyed)socket.write(frame(JSON.stringify({header:{msg_type:'execute_reply'},parent_header:{msg_id:msg.header.msg_id},content:{status:'ok'}})));});});
  });
  t.after(async()=>{for(const c of children)c.kill();for(const s of sockets)s.destroy();await new Promise(r=>setTimeout(r,60));await rm(dir,{recursive:true,force:true});});
  process.env.FORGE_COMPUTE_JUPYTER_FIXTURE='fixture-jupyter-secret';t.after(()=>delete process.env.FORGE_COMPUTE_JUPYTER_FIXTURE);
  return {...f,dir,executions:()=>executions,slow:value=>slow=value,config:{kind:'jupyter',baseUrl:f.baseUrl,workspace:'work',authEnv:'FORGE_COMPUTE_JUPYTER_FIXTURE',timeoutMs:1000}};
}

test('Jupyter contract: actual Python logs/receipt, process interruption, reconnect without execution replay',async t=>{
  const x=await setup(t),f=await jupyterFixture(t);const target=await x.service.configure({projectId:x.project.id,config:f.config,select:true});
  assert.equal((await x.service.health({projectId:x.project.id})).execution,true);
  const input=startInput(x);const job=await x.service.start(input);assert.equal(job.status,'submitted');assert.equal(job.ownerToken,undefined);assert.ok(job.remote.kernelId);
  const done=await waitFor(()=>x.service.status({projectId:x.project.id,jobId:job.id}),j=>j.status==='completed');assert.match(done.logs,/actual Python/);assert.equal(f.executions(),1);
  await x.store.transaction(s=>{s.notebooks[0].code="print('edited later')";s.notebooks[0].revision++;});assert.equal((await x.service.start(input)).source.sha256,hash(x.notebook.code));assert.equal(f.executions(),1);
  const again=createComputeService({dataDir:x.dir,store:x.store,localJobs:x.localJobs});await again.reconcile({projectId:x.project.id});assert.equal(f.executions(),1);await again.shutdown();
  await x.store.transaction(s=>{s.notebooks[0].code="import time\nprint('before interrupt',flush=True)\ntime.sleep(30)";s.notebooks[0].revision++;});
  const running=await x.service.start(startInput(x));await waitFor(()=>x.service.status({projectId:x.project.id,jobId:running.id}),j=>j.status==='running');
  await assert.rejects(x.service.start(startInput(x)),{code:'WORKSPACE_BUSY'});await x.service.stop({projectId:x.project.id,jobId:running.id});assert.equal((await x.service.status({projectId:x.project.id,jobId:running.id})).status,'stopped');
  assert.equal(f.seen.filter(r=>r.path.includes('/interrupt')).length,1);assert.equal(f.executions(),2);
  assert.equal(x.store.read().connections.find(c=>c.id===target.id).config.authEnv,'FORGE_COMPUTE_JUPYTER_FIXTURE');assert.doesNotMatch(JSON.stringify(x.store.read()),/fixture-jupyter-secret/);
});

test('Jupyter timeout or missing receipt stays unknown and replay cannot redispatch; failed code is failed',async t=>{
  const x=await setup(t),f=await jupyterFixture(t);await x.service.configure({projectId:x.project.id,config:{...f.config,timeoutMs:100},select:true});
  f.slow('sessions');const input=startInput(x);const uncertain=await x.service.start(input);assert.equal(uncertain.status,'unknown');assert.equal((await x.service.start(input)).id,uncertain.id);assert.equal(f.executions(),0);
  f.slow(false);assert.equal((await x.service.reconcile({projectId:x.project.id,jobId:uncertain.id})).status,'unknown');assert.equal(f.executions(),0);
  // Explicit fixture repair models the owner's separate reconciliation evidence; production never guesses this.
  await x.store.transaction(s=>{s.jobs[0].status='failed';s.notebooks[0].code="raise RuntimeError('contract failure')";s.notebooks[0].revision++;});
  const failed=await x.service.start(startInput(x));const result=await waitFor(()=>x.service.status({projectId:x.project.id,jobId:failed.id}),j=>j.status==='failed');assert.match(result.logs,/contract failure/);
});

test('checkpoint resume is source/target qualified and a new attempt, restart never implies resume',async t=>{
  const x=await setup(t),f=await jupyterFixture(t);const target=await x.service.configure({projectId:x.project.id,config:f.config,select:true});
  const code="import os\nprint(os.environ.get('FORGE_CHECKPOINT_PATH','fresh'))";await x.store.transaction(s=>{s.notebooks[0].code=code;s.notebooks[0].compute={resume:{protocol:'forge-checkpoint-env-v1',sourceSha256:hash(code)}};});
  const first=await x.service.start(startInput(x));await waitFor(()=>x.service.status({projectId:x.project.id,jobId:first.id}),j=>j.status==='completed');
  let checkpoint;await x.store.transaction(s=>{checkpoint=entity({kind:'checkpoint',status:'verified',sha256:hash('labelled existing checkpoint'),locations:[{kind:'compute',targetId:target.id,path:'/work/fixture.ckpt',sha256:hash('labelled existing checkpoint'),verifiedAt:new Date().toISOString()}]},x.project.id);s.artifacts.push(checkpoint);});
  const resume={...startInput(x),mode:'resume',previousJobId:first.id,checkpointArtifactId:checkpoint.id};const second=await x.service.start(resume);assert.notEqual(second.id,first.id);assert.equal(second.mode,'resume');
  const done=await waitFor(()=>x.service.status({projectId:x.project.id,jobId:second.id}),j=>j.status==='completed');assert.match(done.logs,/fixture.ckpt/);assert.deepEqual(done.checkpointRefs,[checkpoint.id]);
  await x.store.transaction(s=>{s.artifacts[0].locations[0].targetId='another-target';});await assert.rejects(x.service.start({...resume,operationId:randomUUID()}),{code:'CHECKPOINT_UNVERIFIED'});
});

test('Vast and Runpod existing-resource contracts: exact routes, identity, redaction, lifecycle replay, no provisioning',async t=>{
  const x=await setup(t);let kind='vast',state='running',badIdentity=false;
  const f=await httpFixture(t,async(req,res,body)=>{if(req.method==='PUT'||req.method==='POST'){state=body.state??(body.action==='stop'?'EXITED':'RUNNING');return json(res,kind==='vast'?{success:true}:{id:'pod-fixture',status:state});}return json(res,kind==='vast'?{instances:{id:badIdentity?999:123,actual_status:state,jupyter_token:'provider-secret',extra_env:{API_KEY:'provider-secret'}}}:{id:badIdentity?'wrong':'pod-fixture',status:state,actions:['start','stop'],env:{API_KEY:'provider-secret'}});});
  process.env.FORGE_COMPUTE_CLOUD_FIXTURE='fixture-cloud-secret';t.after(()=>delete process.env.FORGE_COMPUTE_CLOUD_FIXTURE);
  for(const k of ['vast','runpod']){
    kind=k;state=k==='vast'?'running':'RUNNING';const target=await x.service.configure({projectId:x.project.id,config:{kind:k,resourceId:k==='vast'?'123':'pod-fixture',authEnv:'FORGE_COMPUTE_CLOUD_FIXTURE',baseUrl:f.baseUrl},select:true});
    const health=await x.service.health({projectId:x.project.id});assert.equal(health.resource.running,true);assert.equal(health.execution,false);assert.doesNotMatch(JSON.stringify(health),/provider-secret/);
    const op={projectId:x.project.id,targetId:target.id,operationId:randomUUID(),action:'stop'};const first=await x.service.lifecycle(op);assert.equal(first.status,'requested');assert.deepEqual(await x.service.lifecycle(op),{...first,replayed:true});
    assert.equal(f.seen.at(-1).method,k==='vast'?'PUT':'POST');assert.equal(f.seen.at(-1).path,k==='vast'?'/instances/123':'/pods/pod-fixture/action');
    assert.deepEqual(f.seen.at(-1).body,k==='vast'?{state:'stopped'}:{action:'stop'});
    const count=f.seen.filter(r=>r.method!=='GET').length;const reconciled=await x.service.reconcile({projectId:x.project.id});assert.equal(reconciled.find(r=>r.operationId===op.operationId).status,'completed');assert.equal(f.seen.filter(r=>r.method!=='GET').length,count);
    await assert.rejects(x.service.lifecycle({...op,action:'start'}),{code:'OPERATION_REUSE'});
    await assert.rejects(x.service.lifecycle({...op,operationId:randomUUID(),action:'create'}),{code:'COMPUTE_POLICY'});
    badIdentity=true;assert.equal((await x.service.health({projectId:x.project.id})).code,'RESOURCE_IDENTITY_MISMATCH');badIdentity=false;
  }
  assert.doesNotMatch(JSON.stringify(x.store.read()),/fixture-cloud-secret|provider-secret/);
  assert.ok(f.seen.every(r=>!['/asks','/pods','/instances'].includes(r.path)));
});

test('stop during preflight prevents dispatch; Jupyter deadline interrupts only the attempt kernel',async t=>{
  const x=await setup(t),f=await jupyterFixture(t);await x.service.configure({projectId:x.project.id,config:f.config,select:true});
  f.slow(true);const pending=x.service.start(startInput(x));const reserved=await waitFor(async()=>x.store.read().jobs[0],j=>!!j);await x.service.stop({projectId:x.project.id,jobId:reserved.id});assert.equal((await pending).status,'stopped');assert.equal(f.executions(),0);
  f.slow(false);await x.store.transaction(s=>{s.projects[0].profile.limits.jobSeconds=1;s.notebooks[0].code='import time\ntime.sleep(30)';});
  const running=await x.service.start(startInput(x));const done=await waitFor(()=>x.service.status({projectId:x.project.id,jobId:running.id}),j=>j.status==='stopped');assert.equal(done.stopRequested,true);assert.equal(f.seen.filter(r=>r.path.includes('/interrupt')).length,1);assert.equal(f.executions(),1);
});

test('Colab browser uses real notebook import/export provenance and truthful stop; no invented execution API',async t=>{
  const x=await setup(t);await x.service.configure({projectId:x.project.id,config:{kind:'colab-browser'},select:true});
  const input=startInput(x),j=await x.service.start(input);assert.equal(j.status,'awaiting-owner');assert.equal(j.setup.capabilities.automaticExecution,false);assert.equal(j.setup.remoteApi.endpoint,'https://colaboratory.googleapis.com/mcp');
  const exported=await x.service.exportNotebook({projectId:x.project.id,jobId:j.id}),n=JSON.parse(exported.content);assert.equal(n.nbformat,4);assert.equal(n.metadata.forge.sourceSha256,hash(x.notebook.code));
  assert.equal((await x.service.stop({projectId:x.project.id,jobId:j.id})).status,'unknown');
  n.cells[0].execution_count=1;n.cells[0].outputs=[{output_type:'stream',name:'stdout',text:['owner-supplied notebook output']}];
  await assert.rejects(x.service.importResult({projectId:x.other.id,jobId:j.id,notebook:n}),{code:'NOT_FOUND'});
  const changed=structuredClone(n);changed.cells[0].source=['tampered code'];await assert.rejects(x.service.importResult({projectId:x.project.id,jobId:j.id,notebook:changed}),{code:'SOURCE_MISMATCH'});
  const imported=await x.service.importResult({projectId:x.project.id,jobId:j.id,notebook:n});assert.equal(imported.status,'completed');assert.match(imported.evidenceScope,/owner-imported/);assert.match(imported.logs,/owner-supplied/);assert.equal(hash(await readFile(imported.resultRef.path,'utf8')),imported.resultRef.sha256);
});

test('SSH subprocess contract fixture uses strict host verification and stdin payload; path never reaches shell',async t=>{
  process.env.FORGE_COMPUTE_KNOWN_FIXTURE='C:/fixture known hosts';t.after(()=>delete process.env.FORGE_COMPUTE_KNOWN_FIXTURE);
  const c=validateConfig({kind:'owner-ssh',host:'fixture.invalid',user:'owner',knownHostsFileEnv:'FORGE_COMPUTE_KNOWN_FIXTURE',expectedMachineId:'a'.repeat(64),workspace:"/work/a path'; touch injected",timeoutMs:500});
  const args=sshArgs(c);assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('BatchMode=yes'));assert.doesNotMatch(args.at(-1),/touch injected/);
  let count=0;
  const spawnProcess=(command,args,options)=>{assert.equal(command,'ssh');assert.equal(options.shell,false);count++;return spawn(process.execPath,['-e',"let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{const r=JSON.parse(b);if(r.action==='health')console.log(JSON.stringify({machineId:r.expectedMachineId}));else console.log(JSON.stringify({status:'running',logs:r.workspace,owner:r.owner}));});"],{...options,env:process.env});};
  const j={id:randomUUID(),ownerToken:randomUUID(),code:"print('fixture')",limitSeconds:1};const r=await ssh(c,'start',j,{spawnProcess});assert.equal(r.status,'running');assert.equal(r.logs,c.workspace);assert.equal(count,1);
  await assert.rejects(ssh({...c,timeoutMs:50},'status',j,{spawnProcess:(...args)=>spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],args[2])}),{code:'COMPUTE_UNCERTAIN'});
});
