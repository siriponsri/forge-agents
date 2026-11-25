import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { secret, clean, request, validateConfig } from '../app/compute/common.mjs';
import { prepareComputeEnvironment } from '../app/compute/environment.mjs';
import { ssh, sshHealth, sshArgs } from '../app/compute/ssh.mjs';
import { jupyterHealth, jupyterStart, jupyterStatus, jupyterStop } from '../app/compute/jupyter.mjs';
import { resource, transition } from '../app/compute/cloud.mjs';

const refs={api:'FORGE_COMPUTE_ENV_FIXTURE_API',jupyter:'FORGE_COMPUTE_ENV_FIXTURE_JUPYTER',known:'FORGE_COMPUTE_ENV_FIXTURE_KNOWN',identity:'FORGE_COMPUTE_ENV_FIXTURE_IDENTITY',foreign:'FORGE_COMPUTE_ENV_FIXTURE_FOREIGN'};
const values={api:'scoped-api-dummy-62491',jupyter:'scoped-jupyter-dummy-78914',known:'C:/fixture paths/scoped known_hosts',identity:'C:/fixture paths/scoped identity'};
const globalValue='unrelated-machine-account-dummy-14470';
function globals(t){for(const name of Object.values(refs)){const previous=process.env[name];process.env[name]=globalValue;t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});}}
function noValues(value){const serialized=typeof value==='string'?value:JSON.stringify(value);for(const v of [...Object.values(values),globalValue])assert.equal(serialized.includes(v),false,'Scoped credential/host reference escaped its transport boundary');}

test('authoritative scoped maps never read missing/inherited/accessor entries from the machine account',async t=>{
  globals(t);assert.equal(secret(refs.api),globalValue);assert.equal(secret(refs.api,{signal:new AbortController().signal}),globalValue);
  assert.equal(secret(refs.api,{env:{[refs.api]:values.api}}),values.api);
  for(const env of [undefined,null,{},Object.create({[refs.api]:values.api}),new Map([[refs.api,values.api]]),{[refs.api]:''},{[refs.api]:123}])assert.throws(()=>secret(refs.api,{env}),{code:'CREDENTIAL_REQUIRED'});
  let getterCalls=0;const accessor={};Object.defineProperty(accessor,refs.api,{get(){getterCalls++;throw new Error(values.api);}});assert.throws(()=>secret(refs.api,{env:accessor}),{code:'CREDENTIAL_REQUIRED'});assert.equal(getterCalls,0);
  assert.throws(()=>secret(refs.api,Object.create({env:{}})),{code:'CREDENTIAL_REQUIRED'});
  const c={authEnv:refs.api,executor:{authEnv:refs.jupyter}};
  assert.equal(clean(globalValue,c), '[REDACTED]');assert.equal(clean(globalValue,{authEnv:'FORGE_COMPUTE_ENV_FIXTURE_ABSENT'}),globalValue);
  assert.equal(clean(values.api,c,{env:{[refs.api]:values.api}}),'[REDACTED]');
  assert.equal(clean(globalValue,c,{env:{[refs.api]:values.api}}),globalValue,'Scoped cleanup must not consult global account values');
  assert.equal(clean(values.jupyter,{kind:'owner-ssh'},{env:{[refs.jupyter]:values.jupyter}}),'[REDACTED]','Nested executor redacts the entire injected operation map');
  assert.equal(process.env[refs.api],globalValue);
});

test('environment preparation resolves only selected names recursively and never exports resolver metadata',async t=>{
  globals(t);const calls=[];const config={kind:'vast',authEnv:refs.api,executor:{kind:'owner-ssh',knownHostsFileEnv:refs.known,identityFileEnv:refs.identity},unselected:{authEnv:refs.foreign}};
  const snapshot=structuredClone(config);const lookup=Object.fromEntries(Object.entries(refs).filter(([key])=>key in values).map(([key,name])=>[name,values[key]]));
  const runtime=await prepareComputeEnvironment(config,async name=>{calls.push({projectId:'fixture-project-a',purpose:'compute',expectedRevision:7,generation:2,name});return lookup[name];});
  assert.deepEqual(calls.map(x=>x.name),[refs.api,refs.identity,refs.known]);assert.deepEqual(Object.keys(runtime.env),[refs.api,refs.identity,refs.known]);assert.equal(Object.hasOwn(runtime.env,refs.foreign),false);assert.equal(secret(refs.api,runtime),values.api);
  assert.equal(Object.isFrozen(runtime),true);assert.equal(Object.isFrozen(runtime.env),true);assert.deepEqual(config,snapshot);noValues(JSON.stringify(runtime));noValues(inspect(runtime));noValues(inspect(runtime.env));
  const duplicate=await prepareComputeEnvironment({authEnv:refs.api,executor:{authEnv:refs.api}},async name=>{assert.equal(name,refs.api);return values.api;});assert.equal(Object.keys(duplicate.env).length,1);
  let caught;try{await prepareComputeEnvironment(config,async()=>{throw new Error(`foreign purpose ${values.api}`);});}catch(e){caught=e;}assert.equal(caught.code,'CREDENTIAL_REQUIRED');noValues(String(caught));
  await assert.rejects(prepareComputeEnvironment({authEnv:refs.api},async()=>({value:values.api,projectId:'foreign'})),{code:'CREDENTIAL_REQUIRED'});
  const cycle={authEnv:refs.api};cycle.executor=cycle;await assert.rejects(prepareComputeEnvironment(cycle,async()=>values.api),{code:'COMPUTE_CONFIG'});
});

const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
function frame(message){const data=Buffer.from(JSON.stringify(message));return Buffer.concat([data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]),data]);}
function receive(socket,fn){let pending=Buffer.alloc(0);socket.on('data',b=>{pending=Buffer.concat([pending,b]);while(pending.length>=2){let size=pending[1]&127,start=2;if(size===126){if(pending.length<4)return;size=pending.readUInt16BE(2);start=4;}else if(size===127){if(pending.length<10)return;size=Number(pending.readBigUInt64BE(2));start=10;}const masked=!!(pending[1]&128);if(pending.length<start+(masked?4:0)+size)return;const mask=masked?pending.subarray(start,start+4):null;start+=masked?4:0;const data=Buffer.from(pending.subarray(start,start+size)),opcode=pending[0]&15;pending=pending.subarray(start+size);if(mask)for(let i=0;i<data.length;i++)data[i]^=mask[i%4];if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}if(opcode===1)fn(JSON.parse(data.toString()));}});}
async function fixture(t,job){
  // Labelled loopback protocol fixture: no live provider or real Jupyter kernel.
  const seen=[],sockets=new Set();let wsResolve,slowResolve;const websocketMessage=new Promise(r=>wsResolve=r),slowStarted=new Promise(r=>slowResolve=r);
  const server=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;seen.push({method:req.method,path:req.url,auth:req.headers.authorization,body});
    if(req.url==='/slow'){slowResolve();return;}
    if(req.url==='/denied')return json(res,{message:values.api},403);
    if(req.url==='/api/kernelspecs')return json(res,{kernelspecs:{python3:{}}});
    if(req.url==='/api/sessions')return json(res,{id:'session-env-fixture',kernel:{id:'kernel-env-fixture'}},201);
    if(req.url==='/api/sessions/session-env-fixture')return json(res,{id:'session-env-fixture',kernel:{id:'kernel-env-fixture'}});
    if(req.url.endsWith('/interrupt'))return json(res,{},204);
    if(req.url.startsWith('/api/contents/'))return json(res,{content:req.url.endsWith('.json')?JSON.stringify({owner:job.ownerToken,status:'completed',error:values.jupyter,finishedAt:12345}):`${values.jupyter}\n${values.api}\nfixture-safe-log`});
    if(req.url.startsWith('/instances/'))return json(res,req.method==='PUT'?{success:true}:{instances:{id:123,actual_status:'running',image_uuid:values.api,jupyter_token:values.api}});
    if(req.url.startsWith('/pods/'))return json(res,{id:'pod-env-fixture',status:'RUNNING',actions:['start','stop'],image:values.api,env:{TOKEN:values.api}});
    return json(res,{},404);
  });
  server.on('upgrade',(req,socket)=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});const endpoint=new URL(req.url,'http://localhost');seen.push({method:'WS',path:endpoint.pathname,auth:endpoint.searchParams.get('token')});const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);receive(socket,message=>{wsResolve(message);socket.write(frame({header:{msg_type:'execute_reply'},parent_header:{msg_id:message.header.msg_id},content:{status:'ok'}}));});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));});return {baseUrl:`http://127.0.0.1:${server.address().port}`,seen,websocketMessage,slowStarted};
}

test('HTTP and WebSocket adapters use injected dummy credentials without persisting or projecting values',async t=>{
  globals(t);const job={id:randomUUID(),ownerToken:randomUUID(),code:"print('credential-free fixture source')",limitSeconds:1};const f=await fixture(t,job);
  const c=validateConfig({kind:'jupyter',baseUrl:f.baseUrl,workspace:'work',authEnv:refs.jupyter});const runtime={env:{[refs.jupyter]:values.jupyter,[refs.api]:values.api}};const originalConfig=structuredClone(c),persisted=[];
  assert.equal((await jupyterHealth(c,runtime)).execution,true);
  const started=await jupyterStart(c,job,async remote=>{persisted.push(structuredClone(remote));job.remote=remote;},()=>false,runtime);assert.equal(started.status,'submitted');
  const message=await f.websocketMessage;assert.equal(message.header.msg_type,'execute_request');noValues(message);noValues(started);noValues(persisted);
  const status=await jupyterStatus(c,job,runtime);assert.equal(status.status,'completed');assert.match(status.logs,/fixture-safe-log/);noValues(status);
  assert.equal((await jupyterStop(c,job,runtime)).status,'stopping');
  assert.ok(f.seen.filter(x=>x.path.startsWith('/api/')).every(x=>x.auth===`token ${values.jupyter}`||x.method==='WS'&&x.auth===values.jupyter));assert.equal(f.seen.find(x=>x.method==='WS').auth,values.jupyter);
  for(const kind of ['vast','runpod']){const cloud=validateConfig({kind,baseUrl:f.baseUrl,resourceId:kind==='vast'?'123':'pod-env-fixture',authEnv:refs.api});noValues(await resource(cloud,runtime));assert.equal((await transition(cloud,'stop',runtime)).status,'requested');}
  assert.ok(f.seen.filter(x=>x.path.startsWith('/instances/')||x.path.startsWith('/pods/')).every(x=>x.auth===`Bearer ${values.api}`));
  const before=f.seen.length;for(const run of [()=>jupyterHealth(c,{env:{[refs.foreign]:values.jupyter}}),()=>resource({kind:'vast',resourceId:'123',baseUrl:f.baseUrl,authEnv:refs.api,timeoutMs:100},{env:{}}),()=>jupyterStart(c,job,()=>assert.fail('Missing map must not persist'),()=>false,{env:{}})])await assert.rejects(run(),{code:'CREDENTIAL_REQUIRED'});assert.equal(f.seen.length,before);
  let rejected;try{await request(c,'/denied',{},runtime);}catch(e){rejected=e;}assert.equal(rejected.code,'COMPUTE_AUTH');noValues(String(rejected));
  assert.deepEqual(c,originalConfig);noValues(c);noValues(job);noValues({journal:{source:job.code,config:c,remote:job.remote,logs:status.logs}});assert.equal(process.env[refs.api],globalValue);assert.equal(process.env[refs.jupyter],globalValue);
});

test('transport abort reasons remain private; scoped pre-abort cannot dispatch HTTP or SSH',async t=>{
  globals(t);const f=await fixture(t,{ownerToken:randomUUID()});const c=validateConfig({kind:'jupyter',baseUrl:f.baseUrl,workspace:'work',authEnv:refs.jupyter});const pre=new AbortController();pre.abort(new Error(values.jupyter));
  let err;try{await jupyterHealth(c,{env:{[refs.jupyter]:values.jupyter},signal:pre.signal});}catch(e){err=e;}assert.equal(err.code,'COMPUTE_ABORTED');noValues(String(err));assert.equal(f.seen.length,0);
  const controller=new AbortController();const pending=request(c,'/slow',{}, {env:{[refs.jupyter]:values.jupyter},signal:controller.signal});await f.slowStarted;controller.abort(new Error(values.jupyter));await assert.rejects(pending,e=>{assert.equal(e.code,'COMPUTE_UNCERTAIN');noValues(String(e));return true;});
  let spawns=0;const sshConfig=validateConfig({kind:'owner-ssh',host:'fixture.invalid',user:'owner',workspace:'/work',knownHostsFileEnv:refs.known});await assert.rejects(ssh(sshConfig,'health',undefined,{env:{[refs.known]:values.known},signal:pre.signal,spawnProcess:()=>{spawns++;}}),{code:'COMPUTE_ABORTED'});assert.equal(spawns,0);
});

test('SSH scoped filepath refs stay out of child env/stdin; tokens never enter argv and missing maps cannot use global refs',async t=>{
  globals(t);const c=validateConfig({kind:'owner-ssh',host:'fixture.invalid',user:'owner',workspace:'/work',knownHostsFileEnv:refs.known,identityFileEnv:refs.identity,expectedMachineId:'a'.repeat(64),timeoutMs:1000});
  let spawns=0;const spawnProcess=(command,args,options)=>{spawns++;assert.equal(command,'ssh');assert.equal(options.shell,false);assert.ok(args.includes(values.identity));assert.ok(args.includes(`UserKnownHostsFile="${values.known}"`));assert.equal(args.join(' ').includes(values.api),false);assert.equal(args.join(' ').includes(values.jupyter),false);noValues(options.env);assert.ok(Object.keys(options.env).every(k=>['PATH','Path','SystemRoot','USERPROFILE','HOME','TEMP','TMP','SSH_AUTH_SOCK'].includes(k)));
    const child=spawn(process.execPath,['-e',"let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{const r=JSON.parse(b);console.log(JSON.stringify(r.action==='health'?{machineId:r.expectedMachineId,hostname:'fixture-host'}:{status:'running',logs:'SSH contract fixture'}));});"],options);const originalEnd=child.stdin.end.bind(child.stdin);child.stdin.end=(payload,...rest)=>{noValues(payload);return originalEnd(payload,...rest);};return child;};
  const runtime={env:{[refs.known]:values.known,[refs.identity]:values.identity,[refs.api]:values.api,[refs.jupyter]:values.jupyter},spawnProcess};const job={id:randomUUID(),ownerToken:randomUUID(),code:"print('no injected environment in source')",limitSeconds:1};
  assert.equal((await ssh(c,'start',job,runtime)).status,'running');assert.equal((await sshHealth(c,runtime)).execution,true);assert.equal(spawns,2);noValues(job);noValues(c);
  await assert.rejects(ssh(c,'status',job,{env:{[refs.known]:values.known},spawnProcess}),{code:'CREDENTIAL_REQUIRED'});assert.throws(()=>sshArgs(c,{env:{}}),{code:'CREDENTIAL_REQUIRED'});assert.equal(spawns,2);
  const controller=new AbortController();const pending=ssh(c,'status',job,{...runtime,signal:controller.signal,spawnProcess:(cmd,args,options)=>spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],options)});controller.abort(new Error(values.api));await assert.rejects(pending,e=>{assert.equal(e.code,'COMPUTE_UNCERTAIN');noValues(String(e));return true;});
});
