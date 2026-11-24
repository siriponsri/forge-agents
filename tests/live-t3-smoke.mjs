// Explicit engineering qualification; never included in npm test or user startup.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { createT3Service } from '../app/server/t3.mjs';
import { command } from '../app/server/domain.mjs';
import { protocolEvents } from '../app/server/agui.mjs';
const dir=process.env.FORGE_T3_SMOKE_DIR??path.join(os.tmpdir(),'forge-t3-bridge-qualified');
const store=await openStore(dir),t3=createT3Service({dataDir:dir,store});
const op=(type,projectId,data)=>command(store,{operationId:crypto.randomUUID(),type,projectId,data});
try{
  const ready=await t3.start();console.log({readiness:ready});
  const catalog=await t3.catalog();const provider=catalog.providers?.find(p=>p.providerInstanceId==='codex');
  console.log({providerReady:provider?.canRunChildTask,modelListed:provider?.models.some(m=>m.id==='gpt-6.1-sol')});
  if(!provider?.canRunChildTask||!provider?.models.some(m=>m.id==='gpt-6.1-sol'))throw new Error('LIVE_NOT_RUN: selected provider/model unavailable in this separate FORGE runtime');
  const workspace=path.join(dir,'disposable-coding-fixture');await mkdir(workspace,{recursive:true});
  let project=store.read().projects.find(p=>p.workspace===workspace);
  if(!project)project=(await op('project.create',null,{name:'Disposable FORGE harness engineering fixture',workspace,profile:{provider:{instanceId:'codex',model:'gpt-6.1-sol',options:[{id:'reasoningEffort',value:'xhigh'}]},compute:{kind:'local'}}})).entity;
  const plan=(await op('plan.create',project.id,{name:'Read-only bridge verification',approved:true})).entity;
  const task=(await op('task.create',project.id,{title:'Reply FORGE_ENGINEERING_BRIDGE_OK',description:'Do not edit or create files, run commands or call tools. Reply only FORGE_ENGINEERING_BRIDGE_OK. This is a disposable FORGE integration check, not a product project.',planId:plan.id})).entity;
  const run=await t3.startRun({operationId:crypto.randomUUID(),projectId:project.id,taskId:task.id});console.log({runId:run.id,threadId:run.threadId,status:run.status,error:run.error});
  if(!run.threadId)throw new Error(run.error);
  let observed;
  for(let i=0;i<24;i++){observed=await t3.reconcile(run.id);if(['completed','failed','cancelled','interrupted'].includes(observed.status))break;await new Promise(r=>setTimeout(r,1000));}
  const evidence={observedAt:new Date().toISOString(),kind:'live-T3-provider-engineering-fixture',model:'gpt-6.1-sol',options:{reasoningEffort:'xhigh'},runId:run.id,threadId:run.threadId,providerRunId:run.providerRunId,status:observed.status,messages:observed.messages,protocolEvents:protocolEvents(store.read(),run.id)};
  await writeFile(path.join(dir,'qualification.json'),JSON.stringify(evidence,null,2));
  console.log({status:observed.status,replyObserved:observed.messages.some(i=>i.type==='assistant_message'&&i.text?.includes('FORGE_ENGINEERING_BRIDGE_OK')),protocolEventTypes:evidence.protocolEvents.map(e=>e.type),evidencePath:path.join(dir,'qualification.json')});
  if(observed.status==='running')await t3.stop(run.id);
  if(observed.status!=='completed')process.exitCode=1;
}finally{await t3.shutdown();await store.close();}
