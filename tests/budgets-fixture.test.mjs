import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity} from '../app/server/domain.mjs';
import {createBudgetService,reserveBudget} from '../app/budgets/index.mjs';
export const usd=(minorUnits,scale=2)=>({minorUnits,scale,currency:'USD'});
export const code=code=>e=>e.code===code;
export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-budget-SQLite-'));let store=await openStore(dir),stops=[],control={};
  const owner=Object.freeze({privateFixtureOwner:true});
  const authorize=(request,caller)=>caller===owner?{kind:'human',role:'owner',subject:'fixture-owner'}:null;
  const t3={async stop(id){stops.push(id);if(control.stopUnknown)throw Object.assign(new Error('Injected lost Stop acknowledgement'),{code:'INJECTED_STOP_UNKNOWN'});await store.transaction(s=>{s.runs.find(r=>r.id===id).status='interrupted';});}};
  const make=()=>createBudgetService({store,t3,authorize});let service=make();
  await store.transaction(s=>{s.projects.push(entity({name:'Budget engineering fixture'}));const p=s.projects[0];s.projects.push(entity({name:'Other fixture project'}));s.bots.push(entity({name:'Assigned fixture bot'},p.id),entity({name:'Second fixture bot'},p.id),entity({name:'Foreign fixture bot'},s.projects[1].id));});
  const projectId=store.read().projects[0].id,botId=store.read().bots[0].id;
  t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,projectId,botId,owner,authorize,t3,control,stops,get store(){return store;},get service(){return service;},
    async configure(patch={}){const bot=patch.botId??null,policies=(await service.state({projectId},owner)).policies,p=policies.find(p=>p.botId===bot);return service.configure({operationId:crypto.randomUUID(),projectId,botId:bot,expectedRevision:p?.policyRevision??0,enabled:true,unknown:'allow',period:'lifetime',limit:usd(100),reserve:usd(60),...patch},owner);},
    async start(patch={},now){return store.transaction(s=>{const r=entity({botId,attemptId:crypto.randomUUID(),providerInstanceId:'fixture-provider',selection:{instanceId:'fixture-provider',model:'fixture-observed-model'},status:'running',operationId:crypto.randomUUID(),...patch},projectId);s.runs.push(r);reserveBudget(s,{run:r,...(now===undefined?{}:{now})});return r;});},
    async finish(run,status='completed'){await store.transaction(s=>{s.runs.find(r=>r.id===run.id).status=status;});return service.reconcile({projectId});},
    observation(run,patch={}){return {projectId,botId:run.botId??null,runId:run.id,attemptId:run.attemptId,providerInstanceId:run.providerInstanceId,model:run.selection.model,source:'injected-native-fixture-cumulative',sourceReceiptId:crypto.randomUUID(),sequence:1,cost:usd(30),usage:{totalTokens:10},final:false,...patch};},
    async state(){return service.state({projectId},owner);},
    async reopen(){await store.close();store=await openStore(dir);service=make();return service;},
  };
}
