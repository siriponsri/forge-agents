import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { openStore } from '../app/server/store.mjs';
import { createMcpOAuthService } from '../app/providers/mcp-oauth.mjs';
import { createWindowsVault } from '../app/storage/auth.mjs';

// Disposable engineering fixtures: real loopback HTTP OAuth endpoints + MCP SDK
// server/client, with neither external account sign-in nor browser automation.
const callbackOrigin='http://127.0.0.1:53119';
const challenge=v=>createHash('sha256').update(v).digest('base64url');
const memoryVault=()=>{const values=new Map();return {values,async get(k){return values.get(k)??null;},async set(k,v){values.set(k,v);}};};
async function jsonBody(req){let s='';for await(const c of req)s+=c;return s;}
const rejects=(fn,code)=>assert.rejects(fn,e=>{assert.equal(e.code,code,e.message);return true;});
async function oauthFixture(t){
  const clients=new Map(),codes=new Map(),tokens=new Set(),refreshes=new Map(),sessions=new Map(),servers=new Set();
  const f={effects:0,registrations:0,exchanges:0,refreshCount:0,tokenBodies:[],requests:[],mode:'normal'};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,f.origin);f.requests.push({method:req.method,path:url.pathname,authorization:req.headers.authorization});
    const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value));};
    try{
      if(url.pathname==='/protected-metadata'){
        if(f.mode==='large')return send(200,{padding:'x'.repeat(1024*1024+1)});
        if(f.mode==='redirect') {res.writeHead(302,{Location:'http://169.254.169.254/latest/meta-data'});return res.end();}
        return send(200,{resource:f.mode==='resource-mismatch'?`${f.origin}/other`:f.resource,authorization_servers:[f.origin],scopes_supported:['tools:read','tools:write']});
      }
      if(url.pathname.startsWith('/.well-known/')){
        const metadata={issuer:f.mode==='issuer-mismatch'?'https://other.example':f.origin,authorization_endpoint:`${f.origin}/authorize`,token_endpoint:f.mode==='unsafe-token'?'http://169.254.169.254/token':`${f.origin}/token`,registration_endpoint:`${f.origin}/register`,response_types_supported:['code'],code_challenge_methods_supported:f.mode==='no-pkce'?['plain']:['S256'],token_endpoint_auth_methods_supported:['none']};
        if(f.mode==='no-registration')delete metadata.registration_endpoint;
        return send(200,metadata);
      }
      if(url.pathname==='/register'){
        const metadata=JSON.parse(await jsonBody(req));assert.deepEqual(metadata.redirect_uris,[`${callbackOrigin}/api/mcp/oauth/callback`]);assert.equal(metadata.token_endpoint_auth_method,'none');
        f.registrations++;const client={...metadata,client_id:`fixture-client-${f.registrations}`,client_secret:`fixture-client-secret-${f.registrations}`};clients.set(client.client_id,client);return send(201,client);
      }
      if(url.pathname==='/authorize'){
        const p=url.searchParams,client=clients.get(p.get('client_id'));
        if(!client || p.get('redirect_uri')!==client.redirect_uris[0] || p.get('code_challenge_method')!=='S256')return send(400,{error:'invalid_request'});
        const code=`fixture-code-${randomUUID()}`;
        codes.set(code,{clientId:client.client_id,challenge:p.get('code_challenge'),resource:p.get('resource'),redirect:p.get('redirect_uri')});
        const callback=new URL(p.get('redirect_uri'));callback.search=new URLSearchParams({code,state:p.get('state'),iss:f.origin});
        res.writeHead(302,{Location:callback.href});return res.end();
      }
      if(url.pathname==='/token'){
        const p=new URLSearchParams(await jsonBody(req));f.tokenBodies.push(Object.fromEntries(p));
        if(f.tokenGate)await f.tokenGate(p);
        let id=p.get('client_id');
        if(req.headers.authorization?.startsWith('Basic '))id=Buffer.from(req.headers.authorization.slice(6),'base64').toString().split(':')[0];
        if(!clients.has(id))return send(400,{error:'invalid_client',error_description:'fixture-SECRET-error-client'});
        if(p.get('resource')!==f.resource)return send(400,{error:'invalid_target',error_description:'fixture-SECRET-error-resource'});
        if(p.get('grant_type')==='authorization_code'){
          f.exchanges++;const code=codes.get(p.get('code'));codes.delete(p.get('code'));
          if(!code || code.clientId!==id || code.challenge!==challenge(p.get('code_verifier')??'') || code.redirect!==p.get('redirect_uri') || f.mode==='bad-pkce')return send(400,{error:'invalid_grant',error_description:'fixture-SECRET-pkce-error'});
        }else if(p.get('grant_type')==='refresh_token'){
          f.refreshCount++;
          if(refreshes.get(p.get('refresh_token'))!==id || f.mode==='reject-refresh')return send(400,{error:'invalid_grant',error_description:'fixture-SECRET-refresh-error'});
        }else return send(400,{error:'unsupported_grant_type'});
        const access=`fixture-access-SECRET-${randomUUID()}`,refresh=`fixture-refresh-SECRET-${randomUUID()}`;
        tokens.add(access);refreshes.set(refresh,id);
        return send(200,{access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'tools:read tools:write'});
      }
      if(url.pathname==='/mcp'){
        if(!tokens.has((req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{error:'unauthorized'}, {'WWW-Authenticate':`Bearer resource_metadata="${f.origin}/protected-metadata", scope="tools:read tools:write"`});
        if(req.method==='GET')return send(405,{error:'GET stream not provided by fixture'});
        const body=JSON.parse(await jsonBody(req));let transport=sessions.get(req.headers['mcp-session-id']);
        if(!transport && isInitializeRequest(body)){
          const sdk=new Server({name:'labelled-oauth-protected-MCP-fixture',version:'1.0.0'},{capabilities:{tools:{}}});servers.add(sdk);
          sdk.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'bounded-effect',inputSchema:{type:'object',additionalProperties:false}}]}));
          sdk.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:String(++f.effects)}]}));
          transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:true,onsessioninitialized:id=>sessions.set(id,transport)});
          await sdk.connect(transport);
        }
        if(!transport)return send(400,{error:'initialize first'});
        return await transport.handleRequest(req,res,body);
      }
      send(404,{error:'not_found'});
    }catch{if(!res.headersSent)send(500,{error:'fixture_failure'});else res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  f.origin=`http://127.0.0.1:${server.address().port}`;f.resource=`${f.origin}/mcp`;
  f.authorize=async authorizationUrl=>{const res=await fetch(authorizationUrl,{redirect:'manual'});assert.equal(res.status,302);await res.body.cancel();return res.headers.get('location');};
  f.expireAccess=()=>tokens.clear();
  f.registerStatic=()=>{const c={issuer:f.origin,client_id:'fixture-static',redirect_uris:[`${callbackOrigin}/api/mcp/oauth/callback`]};clients.set(c.client_id,c);return c;};
  t.after(async()=>{for(const sdk of servers)await sdk.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return f;
}
async function harness(t,{vault=memoryVault()}={}){
  const fixture=await oauthFixture(t),dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-mcp-oauth-fixture-'));
  let store=await openStore(dataDir),service;
  await store.transaction(s=>{s.projects.push({id:'p1'},{id:'p2'});s.connections.push({id:'c1',projectId:'p1',kind:'mcp',route:'http',url:fixture.resource,enabled:true,config:{},revision:1},{id:'c2',projectId:'p2',kind:'mcp',route:'http',url:fixture.resource,enabled:true,config:{},revision:1});});
  const start=()=>createMcpOAuthService({dataDir,store,callbackOrigin,vault});service=start();
  const context={projectId:'p1',connectionId:'c1'},sessionId='server-session-A';
  const h={fixture,dataDir,vault,context,sessionId,get store(){return store;},get service(){return service;},connection:()=>store.read().connections[0],
    begin:(extra={})=>service.begin({...context,sessionId,operationId:randomUUID(),...extra}),
    finish:async begin=>service.callback({callbackUrl:await fixture.authorize(begin.authorizationUrl),sessionId}),
    async restart(){await service.close();await store.close();store=await openStore(dataDir);service=start();},
  };
  t.after(async()=>{await service.close();await store.close();await rm(dataDir,{recursive:true,force:true});});
  return h;
}
async function sdkClient(t,h){
  const client=new Client({name:'labelled-local-OAuth-client-fixture',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(h.fixture.resource),h.service.transportOptions(h.connection())),{timeout:3000});
  t.after(()=>client.close());return client;
}

test('actual discovery, registration, SDK PKCE, protected MCP call and reconnect without duplicate effects',async t=>{
  const h=await harness(t),b=await h.begin();
  assert.equal(b.status,'awaiting-authorization');assert.equal(b.live,'NOT_RUN');assert.equal(h.fixture.registrations,1);
  const u=new URL(b.authorizationUrl);assert.equal(u.searchParams.get('resource'),h.fixture.resource);assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const callbackUrl=await h.fixture.authorize(b.authorizationUrl);
  await rejects(()=>h.service.callback({callbackUrl,sessionId:'different-session'}),'OAUTH_STATE');
  await rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId,projectId:'p2'}),'OAUTH_STATE');
  assert.equal((await h.service.callback({callbackUrl,sessionId:h.sessionId})).status,'connected');
  await rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId}),'OAUTH_STATE');assert.equal(h.fixture.exchanges,1);
  assert.equal(h.fixture.tokenBodies[0].resource,h.fixture.resource);
  assert.equal(challenge(h.fixture.tokenBodies[0].code_verifier),u.searchParams.get('code_challenge'));
  const client=await sdkClient(t,h);assert.equal((await client.listTools()).tools[0].name,'bounded-effect');
  assert.equal((await client.callTool({name:'bounded-effect',arguments:{}})).content[0].text,'1');
  await client.close();await h.restart();
  const reopened=await sdkClient(t,h);await reopened.listTools();assert.equal(h.fixture.effects,1);
  const publicState=JSON.stringify(h.store.read());
  for(const secret of ['fixture-access-SECRET','fixture-refresh-SECRET','fixture-client-secret','fixture-code-','code_verifier','code_challenge','authorizationUrl',u.searchParams.get('state')])assert.ok(!publicState.includes(secret),secret);
  const provider=h.service.authProviderFor(h.connection());const token=(await provider.tokens()).access_token;
  assert.ok(h.fixture.requests.some(r=>r.path==='/mcp'&&r.authorization===`Bearer ${token}`));
  assert.ok(h.fixture.requests.filter(r=>r.path!=='/mcp').every(r=>!r.authorization?.startsWith('Bearer ')));
});

test('refresh persists across SQLite/service restart, concurrent expiry refresh is single-flight, rejected refresh is redacted',async t=>{
  const h=await harness(t);await h.finish(await h.begin());
  const reference=h.connection().config.auth.reference.slice(6),record=JSON.parse(await h.vault.get(reference));
  record.expiresAt=Date.now()-1;await h.vault.set(reference,JSON.stringify(record));await h.restart();
  const p=h.service.authProviderFor(h.connection());const values=await Promise.all([p.tokens(),p.tokens(),p.tokens()]);
  assert.equal(h.fixture.refreshCount,1);assert.equal(values[0].access_token,values[2].access_token);assert.equal(h.fixture.registrations,1);
  assert.equal(h.fixture.tokenBodies.at(-1).resource,h.fixture.resource);
  await h.restart();h.fixture.expireAccess();
  const client=await sdkClient(t,h);await client.listTools();assert.equal(h.fixture.refreshCount,2);
  await client.close();
  const next=JSON.parse(await h.vault.get(reference));next.expiresAt=Date.now()-1;await h.vault.set(reference,JSON.stringify(next));await h.restart();h.fixture.mode='reject-refresh';
  await assert.rejects(()=>h.service.authProviderFor(h.connection()).tokens(),e=>{assert.equal(e.code,'OAUTH_REFRESH');assert.ok(!e.message.includes('SECRET'));return true;});
  assert.equal((await h.service.status(h.context)).status,'required');
  assert.ok(!JSON.stringify(h.store.read()).includes('SECRET'));
});

test('PKCE rejection exchanges once, consumes state, and never persists server error secrets',async t=>{
  const h=await harness(t),b=await h.begin(),callbackUrl=await h.fixture.authorize(b.authorizationUrl);h.fixture.mode='bad-pkce';
  await assert.rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId}),e=>!e.message.includes('SECRET'));
  await rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId}),'OAUTH_STATE');
  assert.equal(h.fixture.exchanges,1);assert.equal((await h.service.status(h.context)).status,'required');
  assert.ok(!JSON.stringify(h.store.read()).includes('SECRET'));
});

test('state expires and is invalid after restart; exact callback origin/path and duplicates are rejected',async t=>{
  const h=await harness(t),b=await h.begin(),callbackUrl=await h.fixture.authorize(b.authorizationUrl);
  await rejects(()=>h.service.callback({callbackUrl:callbackUrl.replace(callbackOrigin,'http://localhost:53119'),sessionId:h.sessionId}),'OAUTH_CALLBACK');
  await rejects(()=>h.service.callback({callbackUrl:callbackUrl.replace('/callback','/callback/other'),sessionId:h.sessionId}),'OAUTH_CALLBACK');
  await rejects(()=>h.service.callback({callbackUrl:`${callbackUrl}&state=duplicate`,sessionId:h.sessionId}),'OAUTH_CALLBACK');
  const now=Date.now;try{Date.now=()=>now()+11*60*1000;await rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId}),'OAUTH_STATE');assert.equal((await h.service.status(h.context)).status,'required');}finally{Date.now=now;}
  const second=await h.begin(),secondCallback=await h.fixture.authorize(second.authorizationUrl);await h.restart();
  await rejects(()=>h.service.callback({callbackUrl:secondCallback,sessionId:h.sessionId}),'OAUTH_STATE');assert.equal(h.fixture.exchanges,0);
});

test('project/connection/resource ownership, disable and disconnect prevent credential reuse',async t=>{
  const h=await harness(t);await rejects(()=>h.begin({projectId:'p2'}),'NOT_FOUND');await h.finish(await h.begin());
  const old=h.service.authProviderFor(h.connection()),reference=h.connection().config.auth.reference;
  await h.store.transaction(s=>{s.connections[1].config.auth={kind:'oauth',status:'connected',reference};});
  await rejects(()=>h.service.authProviderFor(h.store.read().connections[1]).tokens(),'CONNECTION_CHANGED');
  await rejects(()=>h.service.disconnect({projectId:'p2',connectionId:'c2',sessionId:h.sessionId,operationId:randomUUID()}),'CONNECTION_CHANGED');
  assert.ok((await old.tokens()).access_token);
  await h.store.transaction(s=>{s.connections[0].enabled=false;});
  await rejects(()=>old.tokens(),'DISABLED');await rejects(()=>h.begin(),'DISABLED');assert.equal((await h.service.status(h.context)).status,'disabled');
  const disconnected=await h.service.disconnect({...h.context,sessionId:h.sessionId,operationId:randomUUID()});assert.equal(disconnected.status,'disabled');
  assert.ok(!JSON.stringify(await h.vault.get(reference.slice(6))).includes('SECRET'));
  await rejects(()=>old.tokens(),'CONNECTION_CHANGED');
  await h.store.transaction(s=>{s.connections[0].enabled=true;});assert.equal((await h.service.status(h.context)).status,'disconnected');
  await h.finish(await h.begin());const provider=h.service.authProviderFor(h.connection());
  await h.store.transaction(s=>{s.connections[0].url=`${h.fixture.origin}/other`;});await rejects(()=>provider.tokens(),'CONNECTION_CHANGED');
});

test('setup operation replay does not register twice; callback concurrency exchanges exactly once',async t=>{
  const h=await harness(t),operationId=randomUUID(),b=await h.begin({operationId});
  const replay=await h.begin({operationId});assert.equal(replay.alreadySubmitted,true);assert.equal(replay.authorizationUrl,undefined);assert.equal(h.fixture.registrations,1);
  await rejects(()=>h.begin({operationId,sessionId:'another-session'}),'OPERATION_REUSE');
  const callbackUrl=await h.fixture.authorize(b.authorizationUrl),values=await Promise.allSettled([h.service.callback({callbackUrl,sessionId:h.sessionId}),h.service.callback({callbackUrl,sessionId:h.sessionId})]);
  assert.equal(values.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.fixture.exchanges,1);
});

test('a new begin supersedes an already queued callback without corrupting the new flow',async t=>{
  const h=await harness(t),first=await h.begin(),callbackUrl=await h.fixture.authorize(first.authorizationUrl);
  const next=h.begin(),old=h.service.callback({callbackUrl,sessionId:h.sessionId}),rejected=rejects(()=>old,'OAUTH_STATE');
  const second=await next;await rejected;assert.equal(h.fixture.exchanges,0);
  assert.equal((await h.service.status(h.context)).status,'awaiting-authorization');
  assert.equal((await h.finish(second)).status,'connected');assert.equal(h.fixture.exchanges,1);
});

for(const mode of ['large','redirect','resource-mismatch','issuer-mismatch','unsafe-token','no-pkce'])test(`discovery rejects ${mode} before registration or credential exchange`,async t=>{
  const h=await harness(t);h.fixture.mode=mode;
  await assert.rejects(()=>h.begin());assert.equal(h.fixture.registrations,0);assert.equal(h.fixture.exchanges,0);
  assert.ok(!h.fixture.requests.some(r=>r.path==='/register'||r.path==='/token'));
});

test('pre-registered machine environment client supports servers without DCR; missing binding is actionable',async t=>{
  const h=await harness(t);h.fixture.mode='no-registration';
  await rejects(()=>h.begin(),'OAUTH_REGISTRATION_REQUIRED');
  process.env.FORGE_MCP_OAUTH_FIXTURE=JSON.stringify(h.fixture.registerStatic());
  t.after(()=>delete process.env.FORGE_MCP_OAUTH_FIXTURE);
  const b=await h.begin({clientInformationEnv:'FORGE_MCP_OAUTH_FIXTURE'});assert.equal((await h.finish(b)).status,'connected');assert.equal(h.fixture.registrations,0);
  assert.ok(!JSON.stringify(h.store.read()).includes('fixture-static'));
});

test('transport setup never restarts interactive auth or replays tools when refresh is revoked',async t=>{
  const h=await harness(t);await h.finish(await h.begin());const client=await sdkClient(t,h);
  await client.callTool({name:'bounded-effect',arguments:{}});h.fixture.expireAccess();h.fixture.mode='reject-refresh';
  await assert.rejects(()=>client.listTools());assert.equal(h.fixture.effects,1);assert.equal(h.fixture.registrations,1);
  assert.equal((await h.service.status(h.context)).status,'required');
});

test('disabling during callback discards the in-flight token response',async t=>{
  const h=await harness(t),b=await h.begin(),callbackUrl=await h.fixture.authorize(b.authorizationUrl);
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  h.fixture.tokenGate=async()=>{entered();await gate;};
  const finishing=h.service.callback({callbackUrl,sessionId:h.sessionId});
  const outcome=rejects(()=>finishing,'DISABLED');
  await reached;await h.store.transaction(s=>{s.connections[0].enabled=false;});release();await outcome;
  const record=JSON.parse(await h.vault.get(h.connection().config.auth.reference.slice(6)));
  assert.equal(record.tokens,undefined);assert.equal(h.fixture.effects,0);
});

test('disconnect racing refresh cannot restore forgotten credentials',async t=>{
  const h=await harness(t);await h.finish(await h.begin());
  const reference=h.connection().config.auth.reference.slice(6),record=JSON.parse(await h.vault.get(reference));
  record.expiresAt=Date.now()-1;await h.vault.set(reference,JSON.stringify(record));await h.restart();
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  h.fixture.tokenGate=async()=>{entered();await gate;};
  const refreshing=h.service.authProviderFor(h.connection()).tokens(),outcome=assert.rejects(()=>refreshing);
  await reached;await h.service.disconnect({...h.context,sessionId:h.sessionId,operationId:randomUUID()});release();await outcome;
  assert.equal(JSON.parse(await h.vault.get(reference)).tokens,undefined);assert.equal((await h.service.status(h.context)).status,'disconnected');
});

test('close aborts an in-flight callback and clears interactive state',async t=>{
  const h=await harness(t),b=await h.begin(),callbackUrl=await h.fixture.authorize(b.authorizationUrl);
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  h.fixture.tokenGate=async()=>{entered();await gate;};
  const finishing=h.service.callback({callbackUrl,sessionId:h.sessionId}),outcome=assert.rejects(()=>finishing);
  await reached;await h.service.close();release();await outcome;await h.restart();
  await rejects(()=>h.service.callback({callbackUrl,sessionId:h.sessionId}),'OAUTH_STATE');
  assert.equal((await h.service.status(h.context)).status,'required');
});

test('Windows DPAPI encrypts disposable OAuth credentials outside SQLite and survives restart', {skip:process.platform!=='win32'},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'forge-mcp-DPAPI-fixture-'));
  const h=await harness(t,{vault:createWindowsVault({directory})});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await h.finish(await h.begin());
  const reference=h.connection().config.auth.reference.slice(6),record=JSON.parse(await h.vault.get(reference));
  record.expiresAt=Date.now()-1;await h.vault.set(reference,JSON.stringify(record));
  await h.restart();const tokens=await h.service.authProviderFor(h.connection()).tokens();assert.ok(tokens.access_token.startsWith('fixture-access-SECRET'));assert.equal(h.fixture.refreshCount,1);
  const files=await readdir(directory);assert.equal(files.length,1);const bytes=await readFile(path.join(directory,files[0]));
  assert.ok(!bytes.includes(Buffer.from(tokens.access_token)));assert.ok(!bytes.includes(Buffer.from('client_secret')));
  assert.ok(!(await readFile(path.join(h.dataDir,'forge.sqlite'))).includes(Buffer.from('fixture-access-SECRET')));
});
