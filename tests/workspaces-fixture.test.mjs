// T3 is an explicitly injected lifecycle fixture. Git and SQLite are real.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createWorkspaceService,validateWorkspaceContext,resolveWorkspaceForRun,assertIsolatedWorkspaceAvailable} from '../app/workspaces/index.mjs';
import {git,gitText} from '../app/workspaces/git.mjs';

export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-workspaces-fixture-')),repo=path.join(dir,'user-repo'),dataDir=path.join(dir,'machine-state');
  await mkdir(repo);await git(repo,['init','-b','owner-branch']);await git(repo,['config','user.name','Fixture']);await git(repo,['config','user.email','fixture@localhost']);
  await writeFile(path.join(repo,'shared.mjs'),'export const value = 0;\n');
  await writeFile(path.join(repo,'baseline.test.mjs'),"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('baseline',()=>assert.equal(1+1,2));\n");
  await git(repo,['add','.']);await git(repo,['commit','-m','Fixture immutable base']);
  let store=await openStore(dataDir),service,starts=0,stops=0,reads=0;
  const p=entity({name:'Actual disposable engineering repo',workspace:repo,profile:{provider:{instanceId:'fixture-codex',model:'gpt-6.1-sol',options:[{id:'reasoningEffort',value:'xhigh'}]}}}),bot=entity({name:'Fixture engineer'},p.id),plan=entity({name:'Owner-approved canonical plan',approved:true},p.id);
  const tasks=[0,1,2].map(n=>entity({title:`Canonical engineering task ${n}`,description:'Real file change verified by Node tests',planId:plan.id,botId:bot.id,status:'ready',runIds:[],dependsOn:[],artifactIds:[],evidence:[]},p.id));
  await store.transaction(s=>{s.projects.push(p);s.bots.push(bot);s.plans.push(plan);s.tasks.push(...tasks);});
  const owner=Object.freeze({}),control={loseBefore:false,loseAfter:false,stopUnknown:false,ignoreContext:false,before:null};
  const t3={workspaceContextVersion:1,
    async startRun(input){
      starts++;if(control.before)await control.before(input);if(control.loseBefore)throw new Error('INJECTED_T3 transport outcome unknown');
      const resolved=await resolveWorkspaceForRun({store,input,dataDir});
      const r=await store.transaction(s=>{const c=validateWorkspaceContext(s,input);assertIsolatedWorkspaceAvailable(s,input.projectId,input);const task=s.tasks.find(x=>x.id===input.taskId);const r=entity({...input,attemptId:crypto.randomUUID(),approvalSnapshot:{taskRevision:task.revision},botId:task.botId,selection:p.profile.provider,status:'running',workspaceContext:c,fixture:'INJECTED_T3_NOT_LIVE',actualWorkspace:resolved.workspace},input.projectId);if(control.ignoreContext)delete r.workspaceContext;s.runs.push(r);task.runIds.push(r.id);task.status='running';changed(task);return r;});
      if(control.loseAfter)throw new Error('INJECTED_T3 accepted but response lost');return r;
    },
    async stop(id){stops++;if(control.stopUnknown)throw new Error('INJECTED_T3 unknown Stop');return store.transaction(s=>{const r=s.runs.find(x=>x.id===id);r.status='interrupted';changed(r);return r;});},
    async reconcile(id){reads++;return store.read().runs.find(x=>x.id===id);},
  };
  const make=()=>service=createWorkspaceService({store,dataDir,t3,authorize:({callerContext})=>callerContext===owner});make();
  t.after(async()=>{await service.close();await store.close();});
  const f={dir,repo,dataDir,p,plan,bot,tasks,t3,control,owner,
    get store(){return store;},get service(){return service;},get starts(){return starts;},get stops(){return stops;},get reads(){return reads;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    w(w){return store.read().events.find(x=>x.id===(w.id??w));},
    async configure(extra={}){return service.configure(f.input({expectedRevision:store.read().events.filter(x=>x.type==='workspace.policy').at(-1)?.revision??0,maxConcurrent:2,providerLimit:2,checks:['diff','node-test'],...extra}),owner);},
    async create(n=0){return service.create(f.input({taskId:tasks[n].id,expectedTaskRevision:store.read().tasks.find(x=>x.id===tasks[n].id).revision}),owner);},
    async call(method,w,extra={}){w=f.w(w);return service[method](f.input({workspaceId:w.id,expectedRevision:w.revision,...extra}),owner);},
    async qcall(method,q,extra={}){q=f.w(q);return service[method](f.input({integrationId:q.id,expectedRevision:q.revision,...extra}),owner);},
    async edit(w,files){w=f.w(w);for(const [name,text] of Object.entries(files)){const target=path.join(w.worktreePath,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text);}await git(w.worktreePath,['add','.']);await git(w.worktreePath,['commit','-m','Actual fixture engineering change']);return gitText(w.worktreePath,['rev-parse','HEAD']);},
    async finish(w){w=f.w(w);await store.transaction(s=>{const r=s.runs.find(r=>r.operationId===w.runOperationId);r.status='completed';changed(r);});return f.call('reconcile',w);},
    async approve(w){w=await f.call('check',w);return f.call('review',w,{head:w.checkedHead});},
    async enqueue(w){w=f.w(w);return f.call('enqueue',w,{head:w.checkedHead});},
    async prepare(q){q=f.w(q);const latest=store.read().events.filter(x=>x.type==='workspace.integration'&&x.status==='integrated').at(-1);return f.qcall('prepareIntegration',q,{targetHead:latest?.integratedHead??q.sourceHeadSha});},
    async merge(q){q=f.w(q);q=await f.qcall('approveIntegration',q,{targetHead:q.targetHead,head:q.candidateHead});return f.qcall('integrate',q,{targetHead:q.targetHead,head:q.candidateHead});},
    async restart(){await service.close();await store.close();store=await openStore(dataDir);make();await service.recover();},
  };return f;
}
