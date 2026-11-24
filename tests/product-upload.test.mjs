import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../app/server/main.mjs';
import {command} from '../app/server/domain.mjs';

test('browser upload is durable, replay-safe, project scoped and hash checked',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-upload-')),app=await createApplication({dataDir:path.join(dir,'state')});t.after(()=>app.close());
  const project=async name=>(await command(app.store,{type:'project.create',operationId:crypto.randomUUID(),data:{name,workspace:path.join(dir,name)}})).entity;
  const a=await project('one'),b=await project('two');
  const post=async body=>{const r=await fetch(app.url+'/api/artifacts/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const input={projectId:a.id,operationId:crypto.randomUUID(),name:'ไทย weights.json',kind:'model',base64:Buffer.from('{"weights":[1,2]}').toString('base64')};
  const uploaded=await post(input);assert.equal(uploaded.status,200);assert.equal(uploaded.body.status,'verified');
  const replay=await post(input);assert.equal(replay.body.id,uploaded.body.id);assert.equal(app.store.read().artifacts.length,1);
  assert.equal((await post({...input,base64:Buffer.from('changed').toString('base64')})).status,409);
  assert.equal((await post({...input,projectId:b.id})).status,409);
  assert.equal((await post({...input,operationId:crypto.randomUUID(),name:'../escape.json'})).status,400);
  assert.equal((await post({...input,operationId:crypto.randomUUID(),base64:'invalid base64'})).status,400);
  assert.equal(await readFile(uploaded.body.path,'utf8'),'{"weights":[1,2]}');
  const doc={name:'resources',kind:'doc',snapshot:{id:'test',body:{dataStream:'Thai\r\n'},image:'/api/artifacts/'+uploaded.body.id+'/download'}};
  await assert.rejects(command(app.store,{type:'document.create',projectId:b.id,operationId:crypto.randomUUID(),data:doc}),e=>e.code==='NOT_FOUND');
  await command(app.store,{type:'document.create',projectId:a.id,operationId:crypto.randomUUID(),data:doc});
  await assert.rejects(command(app.store,{type:'document.create',projectId:a.id,operationId:crypto.randomUUID(),data:{...doc,snapshot:{image:'file:///C:/secret.png'}}}),e=>e.code==='RESOURCE_NOT_DURABLE');
  assert.equal((await fetch(app.url+'/api/artifacts/'+uploaded.body.id+'/download')).status,200);
  await writeFile(uploaded.body.path,'tampered');
  assert.equal((await fetch(app.url+'/api/artifacts/'+uploaded.body.id+'/download')).status,409);
});
