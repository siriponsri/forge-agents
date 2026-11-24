import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../app/server/store.mjs';
import { createMemoryService, makeScopeAuthorizer } from '../app/memory/index.mjs';

export async function fixture(t,options={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-memory-'));
  let store=await openStore(dir),service;
  await store.transaction(s=>{s.projects.push({id:'p',name:'fixture'},{id:'q',name:'other'});s.runs.push({id:'run',projectId:'p',status:'completed',revision:1});s.tasks.push({id:'task',projectId:'p',revision:1});s.skills.push({id:'skill',projectId:'p',revision:1,status:'active',version:'1'});});
  const project={projectId:'p',kind:'project',id:'p'},other={projectId:'q',kind:'project',id:'q'};
  const session={projectId:'p',kind:'session',id:'session'},task={projectId:'p',kind:'task',id:'task'};
  const callers=new WeakMap(),caller={},reader={},otherCaller={},sessionCaller={},taskCaller={};
  const actions=['read','write','share','export','rebuild','configure','setup','proposeLesson','verify','sensitive'];
  for(const [handle,scopes,allowed]of [[caller,[project,session,task],actions],[reader,[project],['read']],[otherCaller,[other],actions],[sessionCaller,[session],['read']],[taskCaller,[task],['read']]])callers.set(handle,{subject:'fixture',grants:scopes.map(scope=>({scope,actions:allowed}))});
  const authorize=makeScopeAuthorizer(handle=>callers.get(handle));
  let clock='2026-11-24T00:00:00.000Z';
  const create=()=>createMemoryService({store,dataDir:dir,authorize,now:()=>clock,...options});
  service=await create();
  const f={dir,store,service,caller,reader,otherCaller,sessionCaller,taskCaller,project,other,session,task,callers,authorize,setTime:v=>{clock=v;},
    input:(extra={})=>({projectId:'p',scope:project,...extra}),
    remember:(extra={})=>service.remember({operationId:randomUUID(),projectId:'p',scope:project,memoryType:'semantic',title:'Fixture memory',content:'Restart recovery ความจำภาษาไทย',...extra},caller),
    async restart(){await service.close();await store.close();store=await openStore(dir);service=await create();f.store=store;f.service=service;},
  };
  t.after(async()=>{await service.close();await store.close();await rm(dir,{recursive:true,force:true});});return f;
}
