import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';

test('mounted session Owner routes require browser CSRF and the native MCP remains private',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-session-http-')),app=await createApplication({dataDir:path.join(dir,'data'),machineSecretDir:path.join(dir,'machine')});t.after(()=>app.close());
  const p=entity({name:'HTTP fixture',workspace:dir,profile:{}}),b=entity({name:'Coordinator',kind:'resident',status:'active'},p.id),c=entity({name:'Role session',kind:'private',botId:b.id,messages:[]},p.id);
  await app.store.transaction(s=>{s.projects.push(p);s.bots.push(b);s.conversations.push(c);});
  const post=(route,input,headers={})=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  for(const route of ['/api/session-roles/state','/api/session-roles/assign','/api/session-orchestrator/intent','/api/session-orchestrator/start']){
    const r=await post(route,{projectId:p.id,actor:{kind:'owner'}});assert.equal(r.status,403,route);
  }
  assert.equal(app.store.read().events.filter(e=>e.type?.startsWith('session-')).length,0);
  const r=await fetch(app.url+'/api/session'),session=await r.json(),headers={Cookie:r.headers.get('set-cookie').split(';')[0],'X-Forge-CSRF':session.csrf};
  const assigned=await post('/api/session-roles/assign',{projectId:p.id,conversationId:c.id,botId:b.id,role:'orchestrator',expectedRevision:0,operationId:crypto.randomUUID()},headers);assert.equal(assigned.status,200);
  const state=await post('/api/session-roles/state',{projectId:p.id},headers);assert.equal(state.status,200);assert.equal((await state.json()).assignments[0].role,'orchestrator');
  const privateHook=await post('/api/session-roles/bindInTransaction',{projectId:p.id},headers);assert.equal(privateHook.status,404);
  const mcp=await fetch(app.url+'/mcp/session-roles',{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});assert.equal(mcp.status,401,'native bearer checked before model JSON');
  assert.equal(app.store.read().runs.length,0);
});
