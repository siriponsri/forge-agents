// Qualification fixture: real SQLite and harmless local file effect through an
// explicitly injected T3 owner. This is not live provider/mobile evidence.
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createProactiveService,validateProactiveContext,validateProactiveAction,proactiveEnforcementRequest,validateProactiveEnforcement} from '../app/proactive/index.mjs';
import {digest} from '../app/proactive/contracts.mjs';
import {validateGoalContext} from '../app/goals/context.mjs';
import {validateAssistanceContext} from '../app/assistance/context.mjs';
import {validateRelayAdmission} from '../app/relay/admission.mjs';

export const code=c=>e=>e.code===c;
export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-proactive-sqlite-'));
  let store=await openStore(dir),service,now=Date.parse('2026-11-25T01:59:00Z'),starts=0,stops=0,reconciles=0;
  const owner=Object.freeze({privateSession:'fixture-owner'}),eventCaller=Object.freeze({privateSession:'verified-local-event-transport'});
  const project=entity({name:'Bounded proactive engineering fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'injected-only',model:'fixture'},limits:{concurrency:1}}});await mkdir(project.workspace);
  const plan=entity({name:'Existing approved plan',description:'Harmless local evidence files',approved:true},project.id),bot=entity({name:'Existing bot',kind:'resident',capabilities:['read','propose']},project.id);
  const tasks=[0,1,2,3].map(n=>entity({title:`Engineering fixture ${n}`,description:'A bounded local task',planId:plan.id,botId:bot.id,status:'ready',dependsOn:[],runIds:[],artifactIds:[],evidence:[]},project.id));
  const connection=entity({name:'Injected connection',kind:'provider',enabled:true,providerInstanceId:'injected-only',config:{fixture:true}},project.id);
  await store.transaction(s=>{s.projects.push(project);s.plans.push(plan);s.bots.push(bot);s.tasks.push(...tasks);s.connections.push(connection);});
  const control={before:null,after:null,guardEffect:false,enforcementMode:'mediated-actions',nativeActions:'blocked',unqualified:false,failBefore:false,failAfter:false,ignoreContext:false,foreign:false,stopUnknown:false,completeImmediately:false,eventIdentity:null};
  const authorize=async(_request,caller)=>caller===owner?{kind:'human',role:'owner',subject:'fixture-private-owner'}:null;
  const authenticateEvent=async(request,caller)=>caller===eventCaller?{projectId:request.projectId,source:'local-fixture',subject:'verified-owner-transport',eventType:'fixture.ready',...control.eventIdentity}:null;
  const t3={proactiveContextVersion:1,proactiveEnforcementVersion:1,
    qualifyProactive(s,request){if(control.unqualified)return null;return {version:1,projectId:request.projectId,taskId:request.taskId,envelopeDigest:request.envelopeDigest,identitySnapshot:request.identitySnapshot,scopeDigest:digest(request.scope),mode:control.enforcementMode,nativeActions:control.nativeActions,normalizedActions:'guarded',evidenceId:'INJECTED_T3_OWNER:no-native-tools:normalized-guard-v1',expiresAt:s.events.find(x=>x.type==='proactive.version'&&x.digest===request.envelopeDigest).definition.expiresAt};},
    async startRun(input){
      starts++;if(control.before)await control.before(input);
      if(control.failBefore)throw new Error('Injected transport loss before any receipt; outcome cannot be assumed');
      const run=await store.transaction(s=>{
        const proactiveContext=validateProactiveContext(s,input,()=>now);validateGoalContext(s,input,()=>now);validateAssistanceContext(s,input,()=>now);validateRelayAdmission(s,input);
        validateProactiveEnforcement(s,input,t3.qualifyProactive(s,proactiveEnforcementRequest(s,input,()=>now)),()=>now);
        const task=s.tasks.find(x=>x.id===input.taskId),r=entity({...input,proactiveContext,botId:task.botId,status:'running',artifactIds:[],fixture:'INJECTED_T3_OWNER'},input.projectId);
        if(control.ignoreContext)delete r.proactiveContext;if(control.foreign)r.projectId='foreign';
        s.runs.push(r);task.runIds.push(r.id);task.status='running';changed(task);return r;
      });
      // Actual harmless bytes, labelled owner injection. No model/provider call.
      if(control.guardEffect)validateProactiveAction(store.read(),{projectId:project.id,runId:run.id,capability:'workspace.write',path:`${run.id}.txt`},()=>now);
      await writeFile(path.join(project.workspace,`${run.id}.txt`),`INJECTED_T3_OWNER ${run.operationId}\n`);
      await store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);const a=entity({path:`${r.id}.txt`,runId:r.id,status:'ready',fixture:'INJECTED_T3_OWNER'},project.id);s.artifacts.push(a);r.artifactIds.push(a.id);if(control.completeImmediately)r.status='completed';changed(r);});
      if(control.after)await control.after(input);
      if(control.failAfter)throw new Error('Injected response loss after durable local effect');return {id:'untrusted-response-id'};
    },
    async reconcile(id){reconciles++;return store.read().runs.find(r=>r.id===id);},
    async stop(id){stops++;if(control.stopUnknown)throw Object.assign(new Error('Injected Stop uncertainty'),{code:'STOP_UNKNOWN'});return store.transaction(s=>{const r=s.runs.find(r=>r.id===id);r.status='interrupted';changed(r);return r;});},
  };
  const make=()=>service=createProactiveService({store,t3,authorize,authenticateEvent,clock:()=>now});make();
  t.after(async()=>{await service.close();await store.close();});
  const f={dir,project,plan,bot,tasks,connection,owner,eventCaller,control,t3,
    get store(){return store;},get service(){return service;},get starts(){return starts;},get stops(){return stops;},get reconciles(){return reconciles;},get now(){return now;},
    input(extra={}){return {projectId:project.id,operationId:crypto.randomUUID(),...extra};},
    state(){return service.state({projectId:project.id});},
    recipe(r){return f.state().recipes.find(x=>x.id===(r.id??r));},
    definition(extra={}){return {name:'Bounded fixture recipe',instructions:'Read and propose only within the existing approved task.',planId:plan.id,taskIds:tasks.map(t=>t.id),trigger:{kind:'schedule',timezone:'Asia/Bangkok',localTime:'09:00',weekdays:[0,1,2,3,4,5,6],maxLatenessMs:60000},identity:{connectionIds:[connection.id]},scope:{paths:['.'],capabilities:['read','propose']},budget:{maxRuns:4,maxRunMs:300000,maxTokens:null,maxCost:null,currency:null},expiresAt:now+7*86400000,...extra};},
    async create(extra={}){return service.create(f.input(f.definition(extra)),owner);},
    async call(method,r,extra={},caller=owner){r=f.recipe(r);return service[method](f.input({recipeId:r.id,expectedRevision:r.revision,...extra}),caller);},
    async enable(extra={}){let r=await f.create(extra);r=await f.call('approve',r);return f.call('enable',r);},
    async due(){now+=60000;await service.tick();return f.state().occurrences.at(-1);},
    event(r,eventId='event-1',extra={},caller=eventCaller){return service.ingestEvent({projectId:project.id,recipeId:r.id,eventId,occurredAt:now,...extra},caller);},
    async finish(o,{status='completed',tokens,cost,estimate,subscription}={}){
      await store.transaction(s=>{const r=s.runs.find(r=>r.operationId===o.operationId);r.status=status;if(tokens!==undefined)r.reportedUsage={totalTokens:tokens,source:'fixture-reported'};if(cost)r.reportedCost=cost;if(estimate)r.estimatedCost=estimate;if(subscription)r.subscriptionUsage=subscription;changed(r);});
      await service.tick();return f.state().occurrences.find(x=>x.id===o.id);
    },
    async bytes(o){return readFile(path.join(project.workspace,`${o.runId}.txt`),'utf8');},
    async restart({crash=false}={}){if(!crash)await service.close();await store.close();store=await openStore(dir);make();await service.recover();return f.state();},
    advance(ms){now+=ms;},
  };return f;
}
export const eventTrigger={kind:'event',timezone:'Asia/Bangkok',source:'local-fixture',subject:'verified-owner-transport',eventType:'fixture.ready',maxAgeMs:60000};
