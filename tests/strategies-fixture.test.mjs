// REAL canonical SQLite/Git/Workspace/role/Budget services. The T3 lifecycle
// and host Workspace strategy wiring below are explicitly INJECTED, NOT LIVE.
import {fixture as workspaceFixture} from './workspaces-fixture.test.mjs';
import {createSessionRoleService} from '../app/server/session-roles.mjs';
import {createStrategyService,validateStrategyContext} from '../app/strategies/index.mjs';
import {reserveBudget,validateBudgetAdmission} from '../app/budgets/index.mjs';
import {entity,find,changed} from '../app/server/domain.mjs';
export async function fixture(t){
 const f=await workspaceFixture(t);let roles=createSessionRoleService({store:f.store,conversations:{},authorize:(_i,c)=>c===f.owner?{kind:'owner'}:null});
 const chats=[],bots=[];
 await f.store.transaction(s=>{for(const [n,task] of f.tasks.entries()){const b=entity({name:`Approved specialist ${n}`,kind:'resident',status:'active'},f.p.id),c=entity({name:`Approved session ${n}`,kind:'private',botId:b.id,messages:[]},f.p.id);s.bots.push(b);s.conversations.push(c);find(s,'tasks',task.id).botId=b.id;bots.push(b);chats.push(c);}});
 for(const [n,c]of chats.entries())await roles.assign(f.input({conversationId:c.id,botId:bots[n].id,role:n===1?'reviewer':'executor',expectedRevision:0}),f.owner);
 await f.configure({checks:['diff'],maxConcurrent:3,providerLimit:3});
 const contexts=new Map(),original=f.t3.startRun;let before;
 f.control.before=async input=>{await before?.(input);validateStrategyContext(f.store.read(),input);};
 f.t3.startRun=async input=>{
   input={...input,strategyContext:contexts.get(input.workspaceContext.workspaceId)};validateStrategyContext(f.store.read(),input);
   const r=await original(input);
   await f.store.transaction(s=>{const run=find(s,'runs',r.id);reserveBudget(s,{run,input});validateBudgetAdmission(s,{run,input});validateStrategyContext(s,run);});return r;
 };
 const workspaces={strategyContextVersion:1,start(input,caller,{strategyContext}={}){contexts.set(input.workspaceId,strategyContext);return f.service.start(input,caller);},reconcile:(...args)=>f.service.reconcile(...args),stop:(...args)=>f.service.stop(...args)};
 let service=createStrategyService({store:f.store,workspaces,sessionRoles:roles,dataDir:f.dataDir,authorize:(_i,c)=>c===f.owner?{kind:'human',role:'owner'}:null});
 t.after(async()=>{await service.close();await roles.close();});
 const h={f,get roles(){return roles;},bots,chats,workspaces,get service(){return service;},get store(){return f.store;},owner:f.owner,input:f.input,
  stage(w,n=0,extra={}){return {id:`stage-${n}`,workspaceId:w.id,conversationId:chats[n].id,dependsOn:[],purpose:'work',...extra};},
  state(){return service.state({projectId:f.p.id},f.owner);},
  latest(g){return h.state().strategies.find(x=>x.id===(g.id??g));},
  call(method,g,extra={}){g=h.latest(g);return service[method](f.input({strategyId:g.id,expectedRevision:g.revision,...extra}),f.owner);},
  create(stages,mode='fan-out-fan-in',extra={}){return service.create(f.input({mode,objective:'Owner-approved engineering allocation',stages,limits:{maxAttempts:8,maxConcurrent:2,maxMs:300000,reportedCost:{unknown:'allow',maxAmount:null,currency:null}},...extra}),f.owner);},
  setBefore(fn){before=fn;},
  async reopen(){await service.close();await roles.close();await f.restart();roles=createSessionRoleService({store:f.store,conversations:{},authorize:(_i,c)=>c===f.owner?{kind:'owner'}:null});service=createStrategyService({store:f.store,workspaces,sessionRoles:roles,dataDir:f.dataDir,authorize:(_i,c)=>c===f.owner?{kind:'human',role:'owner'}:null});await service.recover();},
 };return h;
}
