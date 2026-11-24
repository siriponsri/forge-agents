// Disposable engineering fixture: real SQLite + provider catalog validation;
// the T3/provider/model lifecycle below is INJECTED, never a live provider run.
import {mkdtemp,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createProviderCatalog} from '../app/providers/catalog.mjs';
import {createAssistanceService,validateAssistanceContext} from '../app/assistance/index.mjs';

export const provenance={source:'engineering-fixture-owner-policy',recordedBy:'fixture-owner',reason:'Explicit fixture ordinals; no empirical quality or monetary claim.'};
export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-assistance-engineering-'));
  let store=await openStore(dir),now=Date.now(),service,catalogs,turns=0,stops=0,reads=0;
  const p=entity({name:'Assistance fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'legacy-project-route',model:'unchanged'}}});await mkdir(p.workspace);
  const q=entity({name:'Foreign fixture',profile:{}}),bot=entity({name:'Resident',kind:'resident'},p.id),plan=entity({name:'Human plan',description:'Bounded engineering task',approved:true},p.id);
  const task=entity({title:'Inspect fixture work',description:'Verify bounded output',status:'ready',botId:bot.id,planId:plan.id,dependsOn:[],runIds:[]},p.id);
  const c1=entity({kind:'provider',enabled:true,route:'t3',providerInstanceId:'fixture-route-a',config:{generation:1,accountRoute:'fixture-a'}},p.id),c2=entity({kind:'provider',enabled:true,route:'t3',providerInstanceId:'fixture-route-b',config:{generation:1,accountRoute:'fixture-b'}},p.id);
  for(const c of [c1,c2])c.lastCheck={checkedAt:now,providerInstanceId:c.providerInstanceId,status:'ready',installed:true,enabled:true,authentication:'authenticated'};
  await store.transaction(s=>{s.projects.push(p,q);s.bots.push(bot);s.plans.push(plan);s.tasks.push(task);s.connections.push(c1,c2);});
  const models=[
    {providerInstanceId:c1.providerInstanceId,driverKind:'injected',canRunChildTask:true,runtimeModes:['approval-required'],models:[{id:'fixture-economy',options:[{id:'effort',values:['low','high'],default:'low'}]},{id:'fixture-premium-executor',options:[]}]},
    {providerInstanceId:c2.providerInstanceId,driverKind:'injected',canRunChildTask:true,runtimeModes:['approval-required'],models:[{id:'fixture-assistant',options:[{id:'thinking',values:[true,false],default:true}]}]},
  ];
  const control={beforeStart:null,afterStart:null,loseBefore:false,loseAfter:false,ignoreContext:false,ignoreSelection:false,reconcileError:false,stopUnknown:false,catalogError:false};
  const t3={assistanceContextVersion:1,
    async catalog(){if(control.catalogError)throw new Error('Injected failed refresh');return {providers:structuredClone(models)};},
    async startRun(input){
      if(control.beforeStart)await control.beforeStart(input);
      if(control.loseBefore)throw new Error('Injected transport failure before response; no known outcome');
      const r=await store.transaction(s=>{
        const prior=s.runs.find(r=>r.operationId===input.operationId);if(prior)return prior;
        const context=validateAssistanceContext(s,input,()=>now);
        const run=entity({...input,botId:bot.id,selection:context.selection,providerInstanceId:context.selection.instanceId,status:'running',threadId:`injected-thread-${++turns}`,providerRunId:`injected-provider-run-${turns}`,fixture:'INJECTED_T3'},p.id);
        if(control.ignoreContext)delete run.assistanceContext;
        if(control.ignoreSelection)run.selection={instanceId:'ignored',model:'wrong',options:[]};
        s.runs.push(run);s.tasks.find(t=>t.id===task.id).runIds.push(run.id);return run;
      });
      if(control.afterStart)await control.afterStart(r);
      if(control.loseAfter)throw new Error('Injected accepted response lost');return r;
    },
    async reconcile(id){reads++;if(control.reconcileError)throw new Error('Injected disconnected read');return store.read().runs.find(r=>r.id===id);},
    async stop(id){stops++;if(control.stopUnknown)throw new Error('Injected stop unknown');return store.transaction(s=>{const r=s.runs.find(r=>r.id===id);r.status='interrupted';changed(r);return r;});},
  };
  const providers={catalog:i=>catalogs.state(i),validateSelection:i=>catalogs.validate(i)};
  function make(){catalogs=createProviderCatalog({store,t3,clock:()=>now});service=createAssistanceService({store,providers,t3,clock:()=>now});}
  make();for(const c of [c1,c2])await catalogs.refresh({projectId:p.id,connectionId:c.id});
  t.after(async()=>{await service.close();await catalogs.settle();await store.close();});
  const policy={qualityWeight:2,costWeight:3,unknownCost:'allow-ranked-last',provenance,classifications:[
    {connectionId:c1.id,model:'fixture-economy',roles:['executor'],sizeRank:1,qualityRank:3,costRank:1,options:[{id:'effort',value:'high'}],provenance},
    {connectionId:c1.id,model:'fixture-premium-executor',roles:['executor'],sizeRank:2,qualityRank:6,costRank:5,provenance},
    {connectionId:c2.id,model:'fixture-assistant',roles:['asst'],sizeRank:3,qualityRank:7,costRank:null,provenance},
  ]};
  const api={dir,p,q,bot,plan,task,c1,c2,t3,models,providers,policy,control,get store(){return store;},get service(){return service;},get turns(){return turns;},get stops(){return stops;},get reads(){return reads;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    tick(ms){now+=ms;},
    async configure(value=policy){return service.configure(api.input({expectedPolicyId:service.state({projectId:p.id}).policy?.id??null,policy:value}));},
    async select(extra={}){return service.select(api.input({taskId:task.id,...extra}));},
    async loop(extra={}){await api.configure();const d=await api.select(extra.constraints?{constraints:extra.constraints}:{});return service.createLoop(api.input({taskId:task.id,decisionId:d.id,...extra}));},
    advance(l,extra={}){return service.advance(api.input({loopId:l.id,expectedRevision:l.revision,...extra}));},
    reconcile(l){return service.reconcile(api.input({loopId:l.id}));},
    transition(l,extra={}){return service.transition(api.input({loopId:l.id,expectedRevision:l.revision,...extra}));},
    async complete(l,status='completed',extra={}){await store.transaction(s=>{const r=s.runs.find(r=>r.operationId===l.attempts.at(-1).operationId);Object.assign(r,{status,...extra});changed(r);});return api.reconcile(l);},
    async refresh(){for(const c of [c1,c2]){await store.transaction(s=>{s.connections.find(x=>x.id===c.id).lastCheck.checkedAt=now;});await catalogs.refresh({projectId:p.id,connectionId:c.id});}},
    async restart(){await service.close();await catalogs.settle();await store.close();store=await openStore(dir);make();await service.recover();return service;},
  };return api;
}
