import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openResearchModelGateway} from '../app/research-native/model-gateway.mjs';
import {openStore} from '../app/server/store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('private actual egress gateway: bounded attempts, failure and authority',async t=>{
  let calls=0,mode='ok',allowed=true,admissions=0,failures=0,held;
  const server=createServer(async(req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer UPSTREAM_PRIVATE');for await(const _ of req){}if(mode==='held'){held?.();return;}if(mode==='error'){res.writeHead(503);res.end();return;}if(mode==='redirect'){res.writeHead(302,{Location:'https://invalid.example'});res.end();return;}res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: [DONE]\n\n');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const provider={id:'openai',model:'fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'UPSTREAM_PRIVATE',transport:'http'}};
  const gateways=[];const dir=await mkdtemp(path.join(os.tmpdir(),'forge-research-egress-db-')),store=await openStore(dir);
  const make=async(maxSteps=2,deadlineAt=Date.now()+30000)=>{
    let writer=Promise.resolve();
    const gateway=await openResearchModelGateway({provider,withFence:(_id,fn)=>{const p=writer.then(fn);writer=p.catch(()=>{});return p;},authorizeRequest:({runId,attemptId,priorAttempts})=>{assert.equal(runId,'run');assert.equal(attemptId,'attempt');assert.equal(priorAttempts,admissions);if(!allowed)throw new Error('INJECTED_OWNER_DENIAL');admissions++;return {maxSteps,deadlineAt,requestDigest:'a'.repeat(64)};},onFailure:()=>{failures++;}});gateways.push(gateway);return gateway;
  };
  const send=(g,{method='POST',body={model:'fixture',stream:true},url='/chat/completions',key=g.provider.settings.apiKey}={})=>fetch(g.provider.settings.baseURL+url,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  try{
    await t.test('prebinding, foreign auth/path/model, rebind and late authority denial send nothing',async()=>{
      admissions=0;const g=await make();assert.equal((await send(g)).status,403);g.bind({runId:'run',attemptId:'attempt'});assert.throws(()=>g.bind({runId:'foreign',attemptId:'attempt'}));
      for(const options of [{key:'UPSTREAM_PRIVATE'},{url:'/models'},{method:'GET'},{body:{model:'foreign',stream:true}}])assert.equal((await send(g,options)).status,403);
      allowed=false;assert.equal((await send(g)).status,403);allowed=true;assert.equal(calls,0);
    });
    await t.test('successful continuation is allowed with maxRetries zero; third real attempt blocked',async()=>{
      admissions=0;const g=await make();g.bind({runId:'run',attemptId:'attempt'});
      for(let i=0;i<2;i++){const response=await send(g);assert.equal(response.status,200);assert.match(await response.text(),/DONE/);}
      const third=await send(g);assert.equal(third.status,403);assert.equal(calls,2);assert.equal(g.snapshot().attempts,2);
    });
    await t.test('actual SQLite writer never receives or serializes an upstream Promise',async()=>{
      const g=await openResearchModelGateway({provider,withFence:(_id,fn)=>store.transaction(fn),authorizeRequest:()=>({maxSteps:1,deadlineAt:Date.now()+30000,requestDigest:'a'.repeat(64)}),onFailure:()=>{}});gateways.push(g);g.bind({runId:'run',attemptId:'attempt'});const response=await send(g);assert.equal(response.status,200);assert.match(await response.text(),/DONE/);assert.equal(g.snapshot().failed,false);
    });
    await t.test('503 and redirects never trigger another upstream attempt',async()=>{
      for(const failure of ['error','redirect']){mode=failure;admissions=0;const before=calls,g=await make();g.bind({runId:'run',attemptId:'attempt'});assert.equal((await send(g)).status,403);assert.equal((await send(g)).status,403);assert.equal(calls,before+1);assert.equal(g.snapshot().failed,true);}mode='ok';assert.equal(failures,2);
    });
    await t.test('absolute deadline aborts held upstream and retains uncertainty',async()=>{
      mode='held';admissions=0;const g=await make(2,Date.now()+150);g.bind({runId:'run',attemptId:'attempt'});const response=await send(g);assert.equal(response.status,403);assert.equal(g.snapshot().failed,true);assert.equal((await send(g)).status,403);mode='ok';
    });
    await t.test('Stop closes held upstream without waiting for a provider response',async()=>{
      mode='held';admissions=0;const g=await make();g.bind({runId:'run',attemptId:'attempt'});const seen=new Promise(r=>{held=r;});const response=send(g).catch(()=>null);await seen;await g.close();await response;assert.equal(g.snapshot().closed,true);mode='ok';
    });
  }finally{await Promise.all(gateways.map(g=>g.close()));await store.close();await rm(dir,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));}
});
