// Production GUI API boundaries and actual SDK stdio child. Disposable keys only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createApplication} from '../app/server/main.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');

test('Owner key entry feeds only selected MCP child, rotates/revokes cached clients, and never enters canonical data',async t=>{
  if(process.platform!=='win32'){t.skip('Native DPAPI qualification requires Windows');return;}
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-secret-runtime-'));
  const app=await createApplication({dataDir:path.join(dir,'state'),machineSecretDir:path.join(dir,'machine')});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrf;
  async function post(route,data,{auth=true}={}){const response=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-Forge-CSRF':csrf}:{})},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error.message),{status:response.status,...result.error});return result;}
  const op=()=>crypto.randomUUID(),create=async(name,workspace)=>(await post('/api/command',{type:'project.create',operationId:op(),data:{name,workspace}})).entity;
  const p=await create('Disposable secret runtime fixture',path.join(dir,'workspace')),q=await create('Isolated other project',path.join(dir,'other'));
  const name='FORGE_MCP_FIXTURE_'+op().replaceAll('-','').toUpperCase(),value='disposable-engineering-value-'+op();
  await assert.rejects(post('/api/secrets/set',{projectId:p.id,purpose:'mcp',operationId:op(),expectedRevision:0,name,value},{auth:false}),{status:403,code:'BROWSER_SESSION_REQUIRED'});
  const first=await post('/api/secrets/set',{projectId:p.id,purpose:'mcp',operationId:op(),expectedRevision:0,name,value});
  const sdk=file=>JSON.stringify(pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/'+file)).href),script=path.join(dir,'owned-sdk.mjs');
  await writeFile(script,`import {Server}from ${sdk('server/index.js')};import{StdioServerTransport}from ${sdk('server/stdio.js')};import{ListToolsRequestSchema}from ${sdk('types.js')};import{createHash}from'node:crypto';const secret=process.env[${JSON.stringify(name)}];if(!secret)throw Error('No scoped fixture key');const s=new Server({name:'owned-secret-fixture',version:'1'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'fixture_'+createHash('sha256').update(secret).digest('hex').slice(0,12),inputSchema:{type:'object',properties:{}}}]}));await s.connect(new StdioServerTransport());`);
  const config={operationId:op(),projectId:p.id,name:'Actual SDK with scoped key',route:'stdio',command:process.execPath,args:[script],envRefs:[name]};
  const c=await post('/api/mcp/configure',config),scope={projectId:p.id,connectionId:c.id};
  let discovered=await post('/api/mcp/discover',scope);assert.equal(discovered.status,'ready',JSON.stringify(discovered));assert.equal(discovered.capabilities[0].name,'fixture_'+hash(value).slice(0,12));
  const rotatedValue='rotated-disposable-value-'+op();
  const second=await post('/api/secrets/set',{projectId:p.id,purpose:'mcp',operationId:op(),expectedRevision:first.secret.revision,reference:first.secret.reference,value:rotatedValue});
  assert.equal(app.store.read().connections.find(x=>x.id===c.id).discoveryStale,true);
  discovered=await post('/api/mcp/discover',scope);assert.equal(discovered.status,'ready');assert.equal(discovered.capabilities[0].name,'fixture_'+hash(rotatedValue).slice(0,12));
  const foreign=await post('/api/mcp/configure',{...config,operationId:op(),projectId:q.id});
  assert.equal((await post('/api/mcp/discover',{projectId:q.id,connectionId:foreign.id})).status,'error');
  await post('/api/secrets/remove',{projectId:p.id,purpose:'mcp',operationId:op(),expectedRevision:second.secret.revision,reference:second.secret.reference});
  discovered=await post('/api/mcp/discover',scope);assert.equal(discovered.status,'error');
  await assert.rejects(post('/api/secrets/resolveEnv',{projectId:p.id,name,purpose:'mcp'}),{status:404});
  const canonical=JSON.stringify(app.store.read());assert.ok(!canonical.includes(value)&&!canonical.includes(rotatedValue));
  assert.equal(process.env[name],undefined,'Host process environment is never assigned');
});
