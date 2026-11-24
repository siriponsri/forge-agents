import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture } from './memory-fixtures.test.mjs';
import { createMemoryMcpServer } from '../app/memory/mcp.mjs';
import { createMemoryHttpHandler } from '../app/memory/http.mjs';
import { transformWithEsbuild } from 'vite';
import { readFile } from 'node:fs/promises';

test('official MCP SDK client discovers and actually invokes all five scoped native memory operations',async t=>{
  const f=await fixture(t),server=createMemoryMcpServer({service:f.service,callerContext:f.caller});
  const client=new Client({name:'real-sdk-fixture',version:'1.0.0'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);t.after(()=>client.close());t.after(()=>server.close());
  assert.deepEqual((await client.listTools()).tools.map(x=>x.name),['memory.remember','memory.recall','memory.update','memory.list','memory.forget']);
  const call=async(name,args)=>client.callTool({name:'memory.'+name,arguments:f.input(args)});
  let result=await call('remember',{operationId:randomUUID(),memoryType:'working',title:'MCP memory',content:'SDK ภาษาไทย recall'});
  assert.equal(result.isError,undefined);const r=result.structuredContent;
  assert.equal((await call('recall',{query:'ภาษาไทย'})).structuredContent.items[0].id,r.id);
  result=await call('update',{operationId:randomUUID(),id:r.id,expectedRevision:1,patch:{pinned:true}});assert.equal(result.structuredContent.revision,2);
  assert.equal((await call('list',{})).structuredContent.items.length,1);
  for(const args of [{actor:'owner'}, {scope:{...f.project,id:'forged'}}, {projectId:'q',scope:f.other}])assert.equal((await call('list',args)).isError,true);
  assert.equal((await call('update',{operationId:randomUUID(),id:r.id,expectedRevision:2,patch:{pinned:'yes'}})).isError,true);
  assert.equal((await call('forget',{operationId:randomUUID(),id:r.id,expectedRevision:2})).structuredContent.deleted,true);
  assert.equal((await call('list',{})).structuredContent.items.length,0);
});

test('mountable HTTP native API requires host-authenticated context and bounds JSON inputs',async t=>{
  const f=await fixture(t);
  const handler=createMemoryHttpHandler({service:f.service,resolveCaller:req=>req.headers['x-engineering-fixture']==='authenticated'?f.caller:null});
  const server=createServer(async(req,res)=>{if(!await handler(req,res))res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/api/memory/`;
  const post=(method,body,headers={})=>fetch(url+method,{method:'POST',headers:{'content-type':'application/json','x-engineering-fixture':'authenticated',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(url+'status?projectId=p')).status,403);
  assert.equal((await post('list',f.input())).status,200);
  assert.equal((await post('list',f.input({actor:'owner'}))).status,400);
  assert.equal((await post('list',f.input(),{'content-type':'text/plain'})).status,415);
  assert.equal((await post('remember',f.input({content:'x'.repeat(70000)}))).status,413);
  assert.equal((await fetch(url+'status?projectId=p',{headers:{'x-engineering-fixture':'authenticated'}})).status,200);
});

test('Memory Studio JSX compiles with the installed Vite toolchain',async()=>{
  const source=await readFile(new URL('../app/web/src/Memory.jsx',import.meta.url),'utf8');
  const result=await transformWithEsbuild(source,'Memory.jsx',{loader:'jsx'});assert.ok(result.code.includes('Memory Studio'));
});
