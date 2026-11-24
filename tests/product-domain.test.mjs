import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { command, confined } from '../app/server/domain.mjs';
import { createApplication } from '../app/server/main.mjs';
import { protocolEvents, appendProtocol } from '../app/server/agui.mjs';
import { createControlService } from '../app/server/control.mjs';
const temp=()=>mkdtemp(path.join(os.tmpdir(),'forge-engineering-fixture-'));
const op=(type,projectId,data={},extra={})=>({operationId:crypto.randomUUID(),type,projectId,data,...extra});

test('durable revisions, isolated projects, replay safety and evidence-backed board',async()=>{
  const dir=await temp();let store=await openStore(dir);
  const workspace=path.join(dir,'selected workspace');
  const project=(await command(store,op('project.create',null,{name:'Disposable engineering fixture',workspace}))).entity;
  const other=(await command(store,op('project.create',null,{name:'Independent fixture',workspace:path.join(dir,'second')}))).entity;
  const bot=(await command(store,op('bot.create',project.id,{name:'Reviewer',role:'Verify',kind:'resident'}))).entity;
  const conversation=(await command(store,op('conversation.create',project.id,{name:'Private review',botId:bot.id,kind:'private'}))).entity;
  const message=op('message.send',project.id,{conversationId:conversation.id,text:'ทดสอบข้อความ Mixed Thai/English'},{expectedRevision:1});
  const sent=await command(store,message);assert.deepEqual(await command(store,message),sent);
  assert.equal(store.read().conversations[0].messages.length,1);
  await assert.rejects(command(store,{...message,data:{...message.data,text:'changed'}}),{code:'OPERATION_REUSE'});
  await assert.rejects(command(store,op('message.send',other.id,{conversationId:conversation.id,text:'Cross project'},{expectedRevision:2})),{code:'NOT_FOUND'});
  const doc=(await command(store,op('document.create',project.id,{name:'Sheet',kind:'sheet',snapshot:{id:'book',sheets:{s:{cellData:{0:{0:{v:3}}}}}}}))).entity;
  const saved=await command(store,op('document.save',project.id,{snapshot:{id:'book',sheets:{s:{cellData:{0:{0:{v:5}}}}}},actor:'agent',summary:'A1 3 -> 5'},{id:doc.id,expectedRevision:1}));
  await assert.rejects(command(store,op('document.save',project.id,{snapshot:{id:'old'}},{id:doc.id,expectedRevision:1})),{code:'REVISION_CONFLICT'});
  assert.equal(saved.entity.history.length,1);
  const restored=await command(store,op('document.restore',project.id,{sourceRevision:1},{id:doc.id,expectedRevision:2}));assert.equal(restored.entity.snapshot.sheets.s.cellData[0][0].v,3);
  await assert.rejects(command(store,op('document.save',project.id,{snapshot:{image:'blob:temporary'}},{id:doc.id,expectedRevision:3})),{code:'RESOURCE_NOT_DURABLE'});
  const plan=(await command(store,op('plan.create',project.id,{name:'Verify local persistence',approved:false}))).entity;
  const task=(await command(store,op('task.create',project.id,{title:'Inspect durable file',planId:plan.id,botId:bot.id}))).entity;
  await assert.rejects(command(store,op('task.update',project.id,{status:'done'},{id:task.id,expectedRevision:1})),{code:'EVIDENCE_REQUIRED'});
  const done=await command(store,op('task.update',project.id,{status:'done',evidence:['fixture test result']},{id:task.id,expectedRevision:1}));assert.equal(done.entity.status,'done');
  await store.close();store=await openStore(dir);
  assert.equal(store.read().documents[0].revision,3);assert.equal(store.read().bots[0].name,'Reviewer');assert.equal(store.read().conversations[0].messages[0].text,message.data.text);
  assert.equal(store.read().projects.length,2);await store.close();
});

test('atomic rollback and serialized writers keep last acknowledged data',async()=>{
  const dir=await temp();const store=await openStore(dir);
  await assert.rejects(store.transaction(s=>{s.settings.language='en';throw new Error('simulated disk operation failure');}));assert.equal(store.read().settings.language,'th');
  await Promise.all(Array.from({length:12},(_,i)=>store.transaction(s=>{s.settings.count=(s.settings.count??0)+1;})));assert.equal(store.read().settings.count,12);
  await store.close();
});

test('HTTP startup, job execution, verified artifacts, backup and process restart',async t=>{
  const dir=await temp();let app=await createApplication({dataDir:dir});
  t.after(()=>app.close());
  const post=async(p,input)=>{const r=await fetch(app.url+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error.message),data.error);return data;};
  const health=await (await fetch(app.url+'/api/health')).json();assert.equal(health.product,'FORGE');
  const project=(await post('/api/command',op('project.create',null,{name:'Job fixture',workspace:path.join(dir,'job workspace')}))).entity;
  const notebook=(await post('/api/command',op('notebook.create',project.id,{name:'Harmless Python fixture',code:"print('FORGE real Python execution')\n",language:'python'}))).entity;
  const input={operationId:crypto.randomUUID(),projectId:project.id,notebookId:notebook.id};
  const job=await post('/api/jobs/start',input);assert.equal((await post('/api/jobs/start',input)).id,job.id);
  let observed;for(let n=0;n<50;n++){observed=app.store.read().jobs.find(j=>j.id===job.id);if(['completed','failed'].includes(observed.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(observed.status,'completed',observed.error);assert.match(observed.logs,/FORGE real Python execution/);
  await writeFile(path.join(project.workspace,'receipt.txt'),'verified bytes');
  const artifact=await post('/api/artifacts/register',{projectId:project.id,path:'receipt.txt',kind:'evidence'});
  assert.equal(await (await fetch(app.url+`/api/artifacts/${artifact.id}/download`)).text(),'verified bytes');
  await writeFile(path.join(project.workspace,'receipt.txt'),'changed bytes');const corrupt=await fetch(app.url+`/api/artifacts/${artifact.id}/download`);assert.equal(corrupt.status,409);
  const backup=await post('/api/storage/backup',{});assert.equal(backup.sha256.length,64);
  const cross=await fetch(app.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://foreign.invalid'},body:JSON.stringify(op('settings.update',null,{language:'en'}))});assert.equal(cross.status,403);
  await assert.rejects(confined(project.workspace,'../forge.sqlite'),{code:'PATH_SCOPE'});
  await app.close();app=await createApplication({dataDir:dir});
  assert.equal(app.store.read().projects[0].id,project.id);assert.equal(app.store.read().jobs[0].status,'completed');
  await writeFile(backup.path,'tampered snapshot');await assert.rejects(post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision}),{code:'INTEGRITY'});
  await app.close();
});

test('protocol validation, observation replay, desktop ownership and capability routing',async()=>{
  const store=await openStore(await temp());
  const project=(await command(store,op('project.create',null,{name:'Controller fixture',workspace:await temp()}))).entity;
  const target=(await command(store,op('desktopTarget.create',project.id,{name:'Separate fixture target',kind:'native',capabilities:['click']}))).entity;
  let effects=0;const ctl=createControlService({store,connections:{call:async()=>{effects++;return {status:'completed'};}}});
  await ctl.acquire({projectId:project.id,targetId:target.id,controllerId:'a'});
  await assert.rejects(ctl.acquire({projectId:project.id,targetId:target.id,controllerId:'b'}),{code:'TARGET_BUSY'});
  await ctl.action({projectId:project.id,targetId:target.id,controllerId:'a',name:'click',operationId:'fixture'});
  await ctl.stop({projectId:project.id,targetId:target.id,controllerId:'owner',takeover:true});
  await assert.rejects(ctl.action({projectId:project.id,targetId:target.id,controllerId:'a',name:'click'}),{code:'CONTROLLER_REQUIRED'});assert.equal(effects,1);
  const run={id:'run-fixture',projectId:project.id};
  await store.transaction(s=>{appendProtocol(s,run,{type:'RUN_STARTED',threadId:'t3-thread-fixture',runId:run.id});appendProtocol(s,run,{type:'CUSTOM',name:'forge.state.revision',value:{revision:2}});});
  assert.equal(protocolEvents(store.read(),run.id).length,2);assert.equal(protocolEvents(store.read(),run.id).length,2);assert.equal(effects,1);
  assert.throws(()=>appendProtocol(store.read(),run,{type:'NOT_AN_AGUI_EVENT'}));await store.close();
});
