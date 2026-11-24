import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {discoverKobModels} from '../app/providers/kob-api.mjs';

// All HTTP traffic here stays on ephemeral loopback. No KOB account, model run,
// CLI install or live provider is used. Credentials and IDs are labelled fixtures.
const raw='fixture-kob-key:fixture-api-token';
async function fixture(t,handler){
  const calls=[],server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request={method:req.method,path:req.url,authorization:req.headers.authorization,contentType:req.headers['content-type'],body:Buffer.concat(chunks).toString('utf8')};calls.push(request);
    handler(request,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  return {calls,baseURL,input:{baseURL,apiKeyEnv:'FIXTURE_KOB_KEY'},options:{env:{FIXTURE_KOB_KEY:raw},clock:()=>1234}};
}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function redacted(error,code){
  assert.equal(error.code,code);assert.equal(error.cause,undefined);
  assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`,/fixture-kob-key|fixture-api-token|PRIVATE_RESPONSE|secret-url|Bearer /);
  return true;
}

test('OpenAI discovery uses Bearer raw key, GET without body, and returns only safe observed identities',async t=>{
  const f=await fixture(t,(req,res)=>json(res,200,{object:'list',data:[
    {id:'fixture/model-a',display_name:'Fixture A',supports_tools:true,inputPricePer1M:999,options:{effort:'xhigh'}},
    {id:'fixture/model-a',display_name:'duplicate'},
    {id:'fixture/model-b',display_name:raw},
    {id:raw}, {id:17}, {id:'{env:SECRET}'},
  ]}));
  const result=await discoverKobModels(f.input,f.options);
  assert.deepEqual(result.models,[{id:'fixture/model-a',name:'Fixture A'},{id:'fixture/model-b'}]);
  assert.deepEqual(result.attempts,[{endpoint:'openai',method:'GET',status:200,outcome:'models'}]);
  assert.equal(result.observedAt,1234);assert.equal(result.verification,'discovery-only');assert.equal(result.executionVerified,false);
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{method:'GET',path:'/v1/models',authorization:`Bearer ${raw}`,contentType:'application/json',body:''});
  assert.doesNotMatch(JSON.stringify(result),/fixture-kob-key|fixture-api-token|supports_tools|999|xhigh/);
});

test('404 fallback POST uses split api_key/api_token and normalizes providers envelope',async t=>{
  const f=await fixture(t,(req,res)=>req.path==='/v1/models'?json(res,404,{message:'PRIVATE_RESPONSE '+raw}):json(res,200,{providers:[{provider:'Fixture vendor',models:[{modelId:'fixture/model-c',displayName:'Fixture C',inputPricePer1M:0.01},{id:'fixture/model-d'}]}]}));
  const result=await discoverKobModels({...f.input,baseURL:f.baseURL+'/api/v2/chat/completions'},f.options);
  assert.deepEqual(f.calls.map(c=>[c.method,c.path]),[['GET','/v1/models'],['POST','/api/models']]);
  assert.equal(f.calls[1].authorization,`Bearer ${raw}`);
  assert.deepEqual(JSON.parse(f.calls[1].body),{api_key:'fixture-kob-key',api_token:'fixture-api-token'});
  assert.deepEqual(result.models,[{id:'fixture/model-c',name:'Fixture C',provider:'Fixture vendor'},{id:'fixture/model-d',provider:'Fixture vendor'}]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_RESPONSE|fixture-kob-key|fixture-api-token|Price/);
});

test('plain key POST has no api_token; unsupported/invalid discovery falls back to GET api/v2/models',async t=>{
  const f=await fixture(t,(req,res)=>{
    if(req.path==='/v1/models'){res.writeHead(200);res.end('not JSON PRIVATE_RESPONSE '+raw);}
    else if(req.path==='/api/models')json(res,405,{message:raw});
    else json(res,200,{models:[{id:'fixture/model-e',display_name:'Fixture E'}]});
  });
  const result=await discoverKobModels(f.input,{...f.options,env:{FIXTURE_KOB_KEY:'fixture-plain-key'}});
  assert.deepEqual(f.calls.map(c=>[c.method,c.path]),[['GET','/v1/models'],['POST','/api/models'],['GET','/api/v2/models']]);
  assert.deepEqual(JSON.parse(f.calls[1].body),{api_key:'fixture-plain-key'});
  assert.deepEqual(result.models,[{id:'fixture/model-e',name:'Fixture E'}]);
  assert.deepEqual(result.attempts.map(a=>a.outcome),['invalid','unavailable','models']);
});

test('empty observed catalogs remain empty without made-up defaults',async t=>{
  const f=await fixture(t,(req,res)=>json(res,200,{models:[]}));
  const result=await discoverKobModels(f.input,f.options);
  assert.deepEqual(result.models,[]);assert.equal(result.executionVerified,false);assert.equal(f.calls.length,3);
});

test('malformed envelopes or identities fail closed; unsupported endpoints have a distinct fixed error',async t=>{
  for(const payload of [{message:raw},{models:[{id:23},{id:'bad\n'}]},['fixture/model']]){
    const f=await fixture(t,(req,res)=>json(res,200,payload));
    await assert.rejects(discoverKobModels(f.input,f.options),e=>redacted(e,'KOB_CATALOG_INVALID'));
    assert.equal(f.calls.length,3);
  }
  const f=await fixture(t,(req,res)=>json(res,404,{error:{message:raw}}));
  await assert.rejects(discoverKobModels(f.input,f.options),e=>redacted(e,'KOB_DISCOVERY_FAILED'));
});

test('auth/rate-limit/server failures stop without fallback/retry or raw response text',async t=>{
  for(const [status,code] of [[401,'KOB_AUTH_REQUIRED'],[403,'KOB_AUTH_REQUIRED'],[429,'KOB_RATE_LIMIT'],[500,'KOB_UNAVAILABLE'],[400,'KOB_UNAVAILABLE']]){
    const f=await fixture(t,(req,res)=>json(res,status,{error:{message:'PRIVATE_RESPONSE '+raw},url:'secret-url'}));
    await assert.rejects(discoverKobModels(f.input,f.options),e=>{redacted(e,code);assert.equal(e.httpStatus,status);return true;});
    assert.equal(f.calls.length,1);
  }
});

test('discovery refuses redirects before credentials can cross to a second endpoint',async t=>{
  let followed=false;
  const target=await fixture(t,(req,res)=>{followed=true;json(res,200,{models:[{id:'fixture/wrong-target'}]});});
  const f=await fixture(t,(req,res)=>{res.writeHead(307,{location:target.baseURL+'/secret-url'});res.end(raw);});
  await assert.rejects(discoverKobModels(f.input,f.options),e=>redacted(e,'KOB_REDIRECT'));
  assert.equal(followed,false);assert.equal(f.calls.length,1);assert.equal(target.calls.length,0);
});

test('bounded body reading rejects advertised and streaming response overflow',async t=>{
  const declared=await fixture(t,(req,res)=>{res.writeHead(200,{'content-length':10000});res.end('PRIVATE_RESPONSE '+raw);});
  await assert.rejects(discoverKobModels(declared.input,{...declared.options,maxResponseBytes:100}),e=>redacted(e,'KOB_RESPONSE_TOO_LARGE'));
  const streamed=await fixture(t,(req,res)=>{res.writeHead(200);res.write(' '.repeat(100));res.end(raw);});
  await assert.rejects(discoverKobModels(streamed.input,{...streamed.options,maxResponseBytes:100}),e=>redacted(e,'KOB_RESPONSE_TOO_LARGE'));
});

test('deadline and caller abort cancel in-flight discovery with fixed errors and no retry',async t=>{
  const f=await fixture(t,()=>{});
  await assert.rejects(discoverKobModels(f.input,{...f.options,timeoutMs:40}),e=>redacted(e,'KOB_TIMEOUT'));
  assert.equal(f.calls.length,1);
  const controller=new AbortController();
  // Wait until request reaches fixture before cancellation; no timing assumption.
  const g=await fixture(t,()=>controller.abort(new Error('PRIVATE_RESPONSE '+raw)));
  await assert.rejects(discoverKobModels(g.input,{...g.options,signal:controller.signal}),e=>redacted(e,'KOB_ABORTED'));
  assert.equal(g.calls.length,1);
  await assert.rejects(discoverKobModels(g.input,{...g.options,signal:controller.signal}),e=>redacted(e,'KOB_ABORTED'));
  assert.equal(g.calls.length,1);
});

test('secret resolver and transport errors never expose causes; missing/invalid keys never dispatch',async()=>{
  const input={baseURL:'https://fixture.invalid/v1',apiKeyEnv:'FIXTURE_KOB_KEY'};
  let dispatched=0;
  const fetchImpl=async()=>{dispatched++;throw new Error('PRIVATE_RESPONSE Bearer '+raw+' secret-url');};
  for(const secret of [undefined,'','fixture key','fixture\nkey',':token','key:']){
    await assert.rejects(discoverKobModels(input,{fetchImpl,env:{FIXTURE_KOB_KEY:secret}}),e=>redacted(e,'KOB_SECRET_REQUIRED'));
  }
  await assert.rejects(discoverKobModels(input,{fetchImpl,resolveEnv:async()=>{throw new Error(raw);}}),e=>redacted(e,'KOB_SECRET_REQUIRED'));
  assert.equal(dispatched,0);
  await assert.rejects(discoverKobModels(input,{fetchImpl,resolveEnv:async name=>{assert.equal(name,'FIXTURE_KOB_KEY');return raw;}}),e=>redacted(e,'KOB_UNAVAILABLE'));
  assert.equal(dispatched,1);
  await assert.rejects(discoverKobModels({...input,apiKey:raw},{fetchImpl}),{code:'KOB_INPUT'});
});

test('Stop cancels a pending machine-vault lookup before HTTP dispatch',async()=>{
  const controller=new AbortController();let dispatches=0;
  const result=discoverKobModels({apiKeyEnv:'FIXTURE_VAULT_REF'},{
    signal:controller.signal,resolveEnv:()=>new Promise(()=>{}),
    fetchImpl:async()=>{dispatches++;throw new Error(raw);},
  });
  controller.abort(new Error('PRIVATE_RESPONSE '+raw));
  await assert.rejects(result,e=>redacted(e,'KOB_ABORTED'));assert.equal(dispatches,0);
});

test('Abort cancels response body consumption after headers, and large invalid arrays stay classified',async t=>{
  const controller=new AbortController();
  const f=await fixture(t,(req,res)=>{res.writeHead(200);res.write('{"models":[');setTimeout(()=>controller.abort(),20);});
  await assert.rejects(discoverKobModels(f.input,{...f.options,signal:controller.signal}),e=>redacted(e,'KOB_ABORTED'));
  assert.equal(f.calls.length,1);
  const g=await fixture(t,(req,res)=>json(res,200,{models:Array(130000).fill(null)}));
  await assert.rejects(discoverKobModels(g.input,g.options),e=>redacted(e,'KOB_CATALOG_INVALID'));
});
