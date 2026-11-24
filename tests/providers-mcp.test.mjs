import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { openStore } from '../app/server/store.mjs';
import { createMcpService } from '../app/providers/mcp.mjs';

// Labelled disposable engineering fixture: real MCP SDK client and child stdio
// Server, actual initialize/list pagination/call/schema validation/cancellation.
// It has no external accounts, network inference or product example project.
const url=part=>pathToFileURL(path.resolve(`node_modules/@modelcontextprotocol/sdk/dist/esm/${part}`)).href;
const fixtureScript=`
  import { Server } from ${JSON.stringify(url('server/index.js'))};
  import { StdioServerTransport } from ${JSON.stringify(url('server/stdio.js'))};
  import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(url('types.js'))};
  const server=new Server({name:'labelled-local-SDK-fixture',version:'1.0.0'},{capabilities:{tools:{listChanged:true}}});
  let count=0;
  const tool=name=>({name,description:'Engineering fixture',inputSchema:{type:'object',properties:{value:{type:'string'}},additionalProperties:false}});
  server.setRequestHandler(ListToolsRequestSchema,async request=>request.params?.cursor?{tools:[tool('slow'),tool('change')]}:{tools:[tool('echo')],nextCursor:'page2'});
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    count++;
    if(request.params.name==='change')await server.notification({method:'notifications/tools/list_changed'});
    if(request.params.name==='slow')await new Promise(resolve=>{const timer=setTimeout(resolve,10000);extra.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
    return {content:[{type:'text',text:JSON.stringify({count,value:request.params.arguments?.value??null,envPresent:Boolean(process.env.FIXTURE_REFERENCE)})}]};
  });
  await server.connect(new StdioServerTransport());
`;
async function harness(t,authorizeTool=async()=>true){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-provider-mcp-SDK-fixture-')),store=await openStore(dataDir);
  await store.transaction(s=>{s.projects.push({id:'p1'},{id:'p2'});});
  const service=createMcpService({store,authorizeTool,timeoutMs:4000,machineEnv:{...process.env,FIXTURE_REFERENCE:'fixture-secret-not-displayed'}});
  t.after(async()=>{await service.close();await store.close();});
  const connection=await service.configure({operationId:'setup',projectId:'p1',name:'Labelled SDK fixture',route:'stdio',command:process.execPath,args:['--input-type=module','-e',fixtureScript.replace(/\r?\n/g,' ')],envRefs:['FIXTURE_REFERENCE']});
  const context={projectId:'p1',connectionId:connection.id};return {service,store,connection,context};
}
const until=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Fixture condition timeout');};

test('real SDK pagination, project isolation, schema validation, operation identity and listChanged',async t=>{
  const {service,context,store}=await harness(t);
  const discovery=await service.discover(context);assert.equal(discovery.status,'ready');assert.equal(discovery.server.name,'labelled-local-SDK-fixture');assert.deepEqual(discovery.capabilities.map(t=>t.name),['echo','slow','change']);
  await assert.rejects(service.discover({...context,projectId:'p2'}),{code:'NOT_FOUND'});
  const input={...context,operationId:'echo-call',name:'echo',arguments:{value:'observed'}};
  const result=await service.call(input);assert.equal(result.status,'completed');assert.equal(JSON.parse(result.result.content[0].text).count,1);assert.equal(JSON.parse(result.result.content[0].text).envPresent,true);
  assert.deepEqual(await service.call(input),result);await assert.rejects(service.call({...input,arguments:{value:'changed'}}),{code:'OPERATION_REUSE'});
  await assert.rejects(service.call({...context,operationId:'bad-schema',name:'echo',arguments:{value:33}}),{code:'MCP_ARGUMENTS'});
  await service.call({...context,operationId:'change-list',name:'change',arguments:{}});await until(()=>store.read().connections[0].discoveryStale);
  await assert.rejects(service.call({...context,operationId:'stale-list',name:'echo'}),{code:'DISCOVER_FIRST'});
  assert.doesNotMatch(JSON.stringify(store.read()),/fixture-secret-not-displayed/);
  assert.equal((await service.discover(context)).status,'ready');
});

test('MCP protocol cancellation and disable preserve uncertain outcomes without replay',async t=>{
  const {service,context,store}=await harness(t);await service.discover(context);
  const input={...context,operationId:'slow-call',name:'slow',arguments:{}};const pending=service.call(input);
  await until(()=>store.read().events.some(e=>e.operationId===input.operationId));
  const call=store.read().events.find(e=>e.operationId===input.operationId);
  await assert.rejects(service.stop({...context,projectId:'p2',callId:call.id}),{code:'NOT_FOUND'});
  await service.stop({...context,callId:call.id});const result=await pending;assert.equal(result.status,'unknown');assert.equal(result.stopRequested,true);
  assert.equal((await service.call(input)).id,call.id);
  await service.enable({...context,enabled:false});await assert.rejects(service.call({...context,operationId:'disabled',name:'echo'}),{code:'DISABLED'});
  await service.recover();assert.equal(store.read().connections[0].discoveryStale,true);
});

test('MCP execution cannot bypass existing supervised policy; auth/setup failures are sanitized',async t=>{
  const {service,context,store}=await harness(t,null);await service.discover(context);
  await assert.rejects(service.call({...context,operationId:'not-approved',name:'echo'}),{code:'SUPERVISED_POLICY_REQUIRED'});
  const denied=createMcpService({store,authorizeTool:async()=>false});t.after(()=>denied.close());await assert.rejects(denied.call({...context,operationId:'denied',name:'echo'}),{code:'TOOL_DENIED'});
  const c=await service.configure({operationId:'auth',projectId:'p2',route:'http',url:'http://127.0.0.1:1/mcp',authEnv:'UNSET_FIXTURE_ENV'});
  const auth=await service.discover({projectId:'p2',connectionId:c.id});assert.equal(auth.status,'error');assert.equal(auth.error.code,'AUTH_REQUIRED');
  await assert.rejects(service.configure({operationId:'secret',projectId:'p2',route:'http',url:'https://fixture.invalid/mcp',apiKey:'forbidden'}),{code:'MCP_CONFIG'});
});
