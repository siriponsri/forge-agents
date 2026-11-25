// Actual Git worktrees, SQLite, Workspace, Adaptive, catalog validator, Budget and
// independent artifact validator. T3 execution/host forwarding are INJECTED, NOT LIVE.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture as workspaceFixture} from './workspaces-fixture.test.mjs';
import {createAdaptiveService} from '../app/adaptive/index.mjs';
import {createProviderCatalog} from '../app/providers/catalog.mjs';
import {createBudgetService} from '../app/budgets/index.mjs';
import {createResearchService,defaultResearchConfig} from '../app/research/index.mjs';
import {createResearchComponentService,validateResearchComponentContext,resolveResearchAllocation} from '../app/research-components/index.mjs';
import {entity} from '../app/server/domain.mjs';

export async function fixture(t,{components={},policy='evidence-guided',maxAgents=3,maxSteps=12,maxRetries=1,unknownAccounting='block',complete=true,report=true,wrongPrimary=false,maxTokens=null,maxCost=null,maxMs=30000}={}){
  const f=await workspaceFixture(t),owner=f.owner,control={complete,report,wrongPrimary,loseBefore:false,loseAfter:false,ignoreContext:false,beforePrompt:null},messages=[];
  const authorizeOwner=(_r,c)=>c===owner?{kind:'human',role:'owner',subject:'INJECTED_COMPONENT_FIXTURE_OWNER'}:null;
  const connection=entity({kind:'provider',enabled:true,providerInstanceId:f.p.profile.provider.instanceId,config:{generation:1,routeId:'injected'},lastCheck:{providerInstanceId:f.p.profile.provider.instanceId,installed:true,enabled:true,authentication:'authenticated',status:'ready',checkedAt:Date.now()}},f.p.id);
  const skill=entity({name:'Explicit table skill',version:'1.0',instructions:'REVIEWED_TABLE_SKILL_V1: group each input row by key and sum all values.',requires:['t3.run'],status:'active'},f.p.id);
  await f.store.transaction(s=>{s.connections.push(connection);s.skills.push(skill);});
  f.t3.catalog=async()=>({providers:[{providerInstanceId:f.p.profile.provider.instanceId,models:[{id:f.p.profile.provider.model,options:[{id:'reasoningEffort',values:['xhigh'],default:'xhigh'}]}],canRunChildTask:true,runtimeModes:['approval-required'],omittedModels:0,catalogComplete:true,checkedAt:new Date().toISOString()}]});
  let component,adaptive,providers,budget,host;
  const originalStart=f.t3.startRun.bind(f.t3);
  f.t3.startRun=async raw=>{
    if(control.loseBefore)throw new Error('INJECTED_OWNER_ACK_UNKNOWN_BEFORE_RESERVATION');
    const input={...raw,...host};validateResearchComponentContext(f.store.read(),input);
    let run=await originalStart(input);
    run=await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id),a=s.events.find(e=>e.id===input.researchComponentContext.allocationId);r.selection=a.selection;r.providerInstanceId=a.selection.instanceId;if(control.ignoreContext)delete r.researchComponentContext;return r;});
    if(control.beforePrompt)await control.beforePrompt(run,f);
    const prompt=await component.preparePrompt({run,baseMessage:`Canonical approved task ${run.taskId}.`});messages.push({runId:run.id,role:run.researchComponentContext.role,message:prompt.message});
    await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.researchComponentReceipt=component.validatePrompt(s,r,prompt.message);});
    if(control.complete){
      const rows=JSON.parse(prompt.message.match(/<benchmark-input[^>]*>(.*?)<\/benchmark-input>/s)[1]),totals=new Map();for(const row of rows)totals.set(row.key,(totals.get(row.key)??0)+row.value);
      const output=control.wrongPrimary&&run.researchComponentContext.role==='primary'?[]:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({key,total}));
      await writeFile(path.join(run.actualWorkspace,'output.json'),JSON.stringify(output));
      run=await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.status='completed';return r;});
      if(control.report)await usage(run);
    }
    if(control.loseAfter)throw new Error('INJECTED_OWNER_ACK_UNKNOWN_AFTER_RESERVATION');return run;
  };
  function make(){
    const catalog=createProviderCatalog({store:f.store,t3:f.t3});providers={catalog:catalog.state,validateSelection:catalog.validate};
    adaptive=createAdaptiveService({store:f.store,t3:f.t3});budget=createBudgetService({store:f.store,t3:f.t3,authorize:authorizeOwner});
    // EXPLICIT INJECTED LEAD HOST SEAM. Production marker is absent until root wiring.
    const workspaces={researchComponentContextVersion:1,
      start(i,c,internal){host=internal;return f.service.start(i,c,{researchContext:internal.researchContext});},
      stop:(...args)=>f.service.stop(...args),reconcile:(...args)=>f.service.reconcile(...args)};
    component=createResearchComponentService({store:f.store,dataDir:f.dataDir,workspaces,adaptive,providers,authorizeOwner});return catalog;
  }
  await make().refresh({projectId:f.p.id,connectionId:connection.id});
  await f.configure({maxConcurrent:3,providerLimit:3});const workspaces=[];for(let n=0;n<3;n++)workspaces.push(await f.create(n));
  const research=createResearchService({store:f.store,dataDir:f.dataDir,authorizeOwner,executionOwner:{version:1,dispatch(){},reconcile(){},stop(){},telemetry(){},validate(){}}});
  const config={...defaultResearchConfig(),execution:'agent',repetitions:1,policies:[policy],ablations:[{name:'injected-composition',components:{memory:false,skills:true,adaptation:true,staffing:true,verification:true,...components}}],limits:{maxMs,maxSteps,maxBytes:65536,maxRetries,maxAgents,maxTokens,maxCost,unknownAccounting}};
  const experiment=await research.create(f.input({config}),owner),trial=await research.reserve(f.input({experimentId:experiment.id,repetition:0,policyIndex:0,ablationIndex:0,workspaceId:workspaces[0].id,taskId:workspaces[0].taskId}),owner);
  const slots=workspaces.map((w,n)=>({workspaceId:w.id,role:['primary','helper','revision'][n],skillIds:[skill.id]}));
  async function usage(run,{tokens=7,cost=1,currency='USD',final=true,sequence=1}={}){return budget.observe({projectId:f.p.id,botId:run.botId,runId:run.id,attemptId:run.attemptId,providerInstanceId:run.selection.instanceId,model:run.selection.model,source:'INJECTED_EXISTING_OWNER_USAGE_NOT_LIVE',sourceReceiptId:crypto.randomUUID(),sequence,cost:cost===null?null:{minorUnits:cost,scale:2,currency},usage:tokens===null?null:{totalTokens:tokens},final});}
  t.after(async()=>{await component.close();adaptive.shutdown();await research.close();});
  return {f,owner,trial,experiment,slots,skill,connection,messages,control,get service(){return component;},get providers(){return providers;},
    input(extra={}){return f.input({trialId:trial.id,...extra});},
    prepare(){return component.prepare(this.input({slots}),owner);},
    advance(){return component.advance(this.input(),owner);},
    state(){return component.state({projectId:f.p.id,trialId:trial.id},owner);},
    async validateAll(){const state=await this.state();for(const x of state.attempts.filter(x=>x.run?.status==='completed'&&!x.evidence))await component.validate(this.input({allocationId:x.allocation.id}),owner);return this.state();},
    usage,
    async restart(){await component.close();adaptive.shutdown();await f.restart();make();await component.recover(owner);},
    resolve(a,extra={}){return resolveResearchAllocation(f.store.read(),{projectId:f.p.id,trialId:trial.id,workspaceId:a.workspaceId,runOperationId:a.operationId,...extra});},
  };
}
