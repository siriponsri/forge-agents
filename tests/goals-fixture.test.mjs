import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {digest} from '../app/goals/contracts.mjs';
import {createGoalService,validateGoalContext} from '../app/goals/index.mjs';

export const hash=digest('actual deterministic output');
export const allow={tokens:{unknown:'allow',maxTotal:null},reportedCost:{unknown:'allow',maxAmount:null,currency:null}};
export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-goals-sqlite-'));
  let store=await openStore(dir),service,now=Date.now(),starts=0,stops=0,reads=0;
  const p=entity({name:'Goal fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'unchanged',model:'unchanged'},limits:{concurrency:1}}}),q=entity({name:'Foreign project',workspace:path.join(dir,'foreign'),profile:{}});
  await mkdir(p.workspace);await mkdir(q.workspace);
  const plan=entity({name:'Human-approved existing plan',description:'Two independent tasks',approved:true},p.id),bot=entity({name:'Executor',kind:'resident'},p.id);
  const tasks=[0,1,2].map(n=>entity({title:`Task ${n}`,description:'Canonical work',planId:plan.id,botId:bot.id,status:'ready',dependsOn:[],runIds:[],evidence:[]},p.id));
  await store.transaction(s=>{s.projects.push(p,q);s.plans.push(plan);s.bots.push(bot);s.tasks.push(...tasks);});
  const control={before:null,loseBefore:false,loseAfter:false,ignoreContext:false,foreign:false,stopUnknown:false,completeImmediately:false};
  const owner=Object.freeze({session:'real-local-owner'}),executor=Object.freeze({session:'executor'});
  const authorize=async(request,caller)=>caller===owner?{kind:'human',subject:'local-owner',role:request.action==='qa'?'qa':'owner',independent:true}:caller===executor?{kind:'human',subject:bot.id,role:request.action==='qa'?'qa':'owner',independent:true}:null;
  const t3={goalContextVersion:1,
    async startRun(input){
      starts++;if(control.before)await control.before(input);
      if(control.loseBefore)throw new Error('Injected uncertain transport; no durable response');
      const r=await store.transaction(s=>{
        const c=validateGoalContext(s,input,()=>now),task=s.tasks.find(t=>t.id===input.taskId);
        const r=entity({...input,botId:task.botId,status:control.completeImmediately?'completed':'running',artifactIds:[],fixture:'INJECTED_T3',goalContext:c},p.id);
        if(control.ignoreContext)delete r.goalContext;
        if(control.foreign)r.projectId=q.id;
        s.runs.push(r);task.runIds.push(r.id);task.status='running';changed(task);return r;
      });
      if(control.loseAfter)throw new Error('Injected lost accepted response');return r;
    },
    async reconcile(id){reads++;return store.read().runs.find(r=>r.id===id);},
    async stop(id){stops++;if(control.stopUnknown)throw new Error('Injected Stop uncertainty');return store.transaction(s=>{const r=s.runs.find(r=>r.id===id);r.status='interrupted';changed(r);return r;});},
  };
  const make=()=>service=createGoalService({store,t3,clock:()=>now,authorize});make();
  t.after(async()=>{await service.close();await store.close();});
  const f={dir,p,q,plan,bot,tasks,t3,control,owner,executor,
    get store(){return store;},get service(){return service;},get starts(){return starts;},get stops(){return stops;},get reads(){return reads;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    goal(g){return service.state({projectId:p.id}).goals.find(x=>x.id===(g.id??g));},
    async create(extra={}){
      const taskIds=extra.taskIds??[tasks[0].id];
      return service.create(f.input({planId:plan.id,objective:'Measured goal',taskIds,criteria:taskIds.map((id,n)=>({id:`criterion-${n}`,taskId:id,description:'Output bytes must match',kind:'artifactHash',sha256:hash})),policy:allow,...extra}));
    },
    call(method,g,extra={},caller){g=f.goal(g);return service[method](f.input({goalId:g.id,expectedRevision:g.revision,...extra}),caller);},
    async start(extra={}){let g=await f.create(extra);g=await f.call('resume',g);return f.call('advance',g);},
    async finish(g,{status='completed',bytes='actual deterministic output',evidence=true,usage,cost,verifier}={}){
      g=f.goal(g);const a=g.attempts.at(-1),run=store.read().runs.find(r=>r.operationId===a.operationId);
      if(evidence)await writeFile(path.join(p.workspace,`${run.id}.txt`),bytes);
      await store.transaction(s=>{
        const r=s.runs.find(r=>r.id===run.id);r.status=status;if(usage)r.reportedUsage=usage;if(cost)r.reportedCost=cost;changed(r);
        if(evidence){const a=entity({path:`${r.id}.txt`,runId:r.id,status:'ready',sha256:digest(bytes)},p.id);s.artifacts.push(a);r.artifactIds.push(a.id);}
        if(verifier)s.events.push(entity({type:'verification.result',runId:r.id,status:'PASSED',verifier,checkedAt:new Date(now).toISOString(),checks:[{status:'PASSED'}]},p.id));
      });return f.call('reconcile',g);
    },
    async restart(){await service.close();await store.close();store=await openStore(dir);make();await service.recover();return f.goal(service.state({projectId:p.id}).goals[0]);},
    tick(ms){now+=ms;},
  };return f;
}
