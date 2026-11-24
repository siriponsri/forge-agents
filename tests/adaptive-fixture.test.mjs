// Shared disposable engineering fixture. T3 here is an injected lifecycle double;
// these tests never qualify a live model, provider, prototype or cloud target.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { entity, changed } from '../app/server/domain.mjs';
import { digest, snapshotSkill } from '../app/adaptive/records.mjs';
import { createAdaptiveService } from '../app/adaptive/index.mjs';

export async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-adaptive-engineering-fixture-'));
  let store=await openStore(dir), service;
  const p=entity({name:'Adaptive engineering fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'fixture-codex',model:'fixture-model',options:[{id:'effort',value:'xhigh'}]}}});
  const other=entity({name:'Other project',workspace:path.join(dir,'other'),profile:{}});
  await mkdir(p.workspace,{recursive:true});await mkdir(other.workspace,{recursive:true});
  const bot=entity({name:'Resident fixture bot',kind:'resident'},p.id),plan=entity({name:'Human plan',approved:true},p.id);
  const task=entity({title:'Review output',planId:plan.id,botId:bot.id,dependsOn:[],runIds:[],artifactIds:[],evidence:[]},p.id);
  const skill=entity({name:'Review',version:'1.0',instructions:'Inspect actual output and preserve evidence.',requires:['t3.run'],status:'active'},p.id);
  await store.transaction(s => {s.projects.push(p,other);s.bots.push(bot);s.plans.push(plan);s.tasks.push(task);s.skills.push(skill);});
  let turns=0,stops=0,reads=0,startHook=null;
  const t3={adaptiveContextVersion:1,
    async catalog(){return {providers:[{providerInstanceId:'fixture-codex',driverKind:'fixture',runtimeModes:['approval-required'],models:[{id:'fixture-model',options:[{id:'effort',values:['low','xhigh']}]}]}]};},
    async startRun(input){
      const run=await store.transaction(s => {
        const prior=s.runs.find(r => r.operationId === input.operationId);if(prior)return prior;
        turns++;const run=entity({...input,botId:task.botId,status:'running',threadId:`fixture-thread-${turns}`,fixture:true},p.id);s.runs.push(run);return run;
      });if(startHook)await startHook(run);return run;
    },
    async reconcile(id){reads++;return store.read().runs.find(r => r.id === id);},
    async stop(id){stops++;return store.transaction(s => {const r=s.runs.find(r => r.id === id);r.status='interrupted';changed(r);return r;});},
  };
  const services=[];
  function makeService(){service=createAdaptiveService({store,t3,connections:{call:async()=>{throw new Error('Fixture capability not executed');}}});services.push(service);return service;}
  makeService();
  t.after(async()=>{for(const svc of services)svc.shutdown();await store.close();});
  const api={dir,p,other,bot,plan,task,skill,t3,get store(){return store;},get service(){return service;},get turns(){return turns;},get stops(){return stops;},get reads(){return reads;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    setStartHook(fn){startHook=fn;},
    async restart(){service.shutdown();await store.close();store=await openStore(dir);return makeService();},
    async selected(extra={}){return service.select(api.input({taskId:task.id,...extra}));},
    async loop(extra={}){const decision=await api.selected();return service.createLoop(api.input({taskId:task.id,decisionId:decision.id,...extra}));},
    async step(loop,extra={}){return service.advance(api.input({loopId:loop.id,expectedRevision:loop.revision,...extra}));},
    async complete(loop){return store.transaction(s => {const run=s.runs.find(r => r.id === loop.attempts.at(-1).runId);run.status='completed';changed(run);return run;});},
    async artifact(run,content='actual fixture output'){
      const file=path.join(p.workspace,`${crypto.randomUUID()}.txt`);await writeFile(file,content);
      const a=entity({name:path.basename(file),path:file,status:'verified',sha256:digest(content),bytes:Buffer.byteLength(content),runId:run.id},p.id);
      await store.transaction(s=>s.artifacts.push(a));return a;
    },
    async evidenceRun(selectedSkill=skill,extra={}){
      const run=entity({taskId:task.id,botId:bot.id,status:'completed',fixture:true,adaptiveContext:{skillSnapshots:[snapshotSkill(selectedSkill)]},...extra},p.id);
      await store.transaction(s=>s.runs.push(run));const artifact=await api.artifact(run);
      return {run,artifact,checks:[{key:'output',kind:'artifactHash',runId:run.id,artifactId:artifact.id,sha256:artifact.sha256},{key:'completion',kind:'runStatus',runId:run.id}]};
    },
  };return api;
}
