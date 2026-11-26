// Existing sessionRoute + session roles + canonical SQLite/Budget, with an
// explicitly INJECTED native parent lifecycle. No native/provider call claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as roleFixture} from './product-session-roles-fixture.mjs';
import {createSessionRoute} from '../app/server/session-route.mjs';
import {createStrategyService,validateStrategyContext,strategyPrompt} from '../app/strategies/index.mjs';
import {entity,find,changed} from '../app/server/domain.mjs';
import {digest as taskDigest} from '../app/server/agui.mjs';
import {reserveBudget,validateBudgetAdmission} from '../app/budgets/index.mjs';

test('supervisor uses exact sessionRoute parent, derives bounded approved child envelope, retains observed decisions and Stops each owned child',async t=>{
 const f=await roleFixture(t),plan=entity({name:'Approved dynamic coordination',approved:true},f.p.id),task=entity({title:'Decompose and synthesize reviewed child work',description:'Propose approved task decomposition through the two existing session tools; read child results before synthesizing',planId:plan.id,botId:f.bot.id,status:'ready',runIds:[],dependsOn:[]},f.p.id);
 await f.store.transaction(s=>{find(s,'runs',f.parent.id).status='completed';s.plans.push(plan);s.tasks.push(task);});let route,calls=0;
 const t3={async startRun(input){calls++;return f.store.transaction(s=>{const strategyContext=validateStrategyContext(s,input);route.validateContext(s,input);const current=find(s,'tasks',task.id),r=entity({...input,strategyContext,botId:task.botId,attemptId:crypto.randomUUID(),threadId:crypto.randomUUID(),rootNodeId:crypto.randomUUID(),selection:f.selection,sessionRole:f.roles.captureRole(s,{...input,botId:task.botId}),status:'submitting'},f.p.id);s.runs.push(r);current.runIds.push(r.id);changed(current);r.guardedReservedTaskSnapshot=taskDigest(current);route.reserve(s,{run:r,input});reserveBudget(s,{run:r,input});validateBudgetAdmission(s,{run:r,input});validateStrategyContext(s,r);return r;});},async stop(id){await f.store.transaction(s=>{find(s,'runs',id).status='interrupted';});},async reconcile(id){return find(f.store.read(),'runs',id);}};
 const auth=(_i,c)=>c===f.owner?{kind:'human',role:'owner'}:null;
 route=createSessionRoute({store:f.store,authorizeOwner:auth,policy:{observe:()=>({route:f.selection,policyGeneration:'INJECTED_POLICY',toolGeneration:'INJECTED_TOOLS'})},getGuarded:()=>({privateSnapshot:()=>null}),getT3:()=>t3,getRoles:()=>f.roles,getMcp:()=>null});
 const service=createStrategyService({store:f.store,sessionRoute:route,sessionRoles:f.roles,t3,authorize:auth});t.after(async()=>{await service.close();await route.close();});
 const input={projectId:f.p.id,operationId:crypto.randomUUID(),mode:'supervisor',objective:'Owner approved dynamic coordination',supervisor:{taskId:task.id,conversationId:f.chat.id,children:[{conversationId:f.child.id,botId:f.childBot.id}]},limits:{maxAttempts:2,maxConcurrent:1,maxMs:300000,reportedCost:{unknown:'allow',maxAmount:null,currency:null}}};
 let g=await service.create(input,f.owner);g=await service.advance({projectId:f.p.id,operationId:crypto.randomUUID(),strategyId:g.id,expectedRevision:g.revision,stageId:'parent'},f.owner);assert.equal(calls,1);const parent=find(f.store.read(),'runs',g.stages[0].result.runId);assert.ok(parent.sessionContext);assert.equal(parent.strategyContext.claimId,g.stages[0].claimId);assert.equal(parent.sessionRole.role,'orchestrator');
 // Ordinary native identities are engineering observations here. The existing
 // native attestation test belongs to the root; no fake qualification is added.
 await f.store.transaction(s=>{const r=find(s,'runs',parent.id);delete r.guardedReservedTaskSnapshot;r.status='running';r.providerRunId='INJECTED_PARENT_NATIVE_RUN';r.t3ProjectId='fixture-t3-project';r.providerInstanceId=f.selection.instanceId;});
 const membership=await f.roles.bind({projectId:f.p.id,operationId:crypto.randomUUID(),parentRunId:parent.id,childConversationId:f.child.id,childBotId:f.childBot.id},f.owner);
 // Existing canonical conversation owner reserves child effects. Add only the
 // root strategy hook at that same injected owner reservation boundary.
 const original=f.ownerLifecycle.send;f.ownerLifecycle.send=async input=>{const c=validateStrategyContext(f.store.read(),input);const r=await original(input);await f.store.transaction(s=>{const run=find(s,'runs',r.id);run.strategyContext=c;validateStrategyContext(s,run);});return find(f.store.read(),'runs',r.id);};
 const command=await f.roles.prompt({projectId:f.p.id,operationId:crypto.randomUUID(),parentRunId:parent.id,membershipId:membership.id,text:'Review this approved decomposition and return actual findings, then await synthesis.'},f.owner);
 const child=find(f.store.read(),'runs',command.childRun.id);assert.equal(child.strategyContext.parentAttemptId,parent.attemptId);assert.equal(child.strategyContext.claimId,parent.strategyContext.claimId);
 assert.match(strategyPrompt(child.strategyContext),/immutable child sessionRole/);assert.doesNotMatch(strategyPrompt(child.strategyContext),/Working role: orchestrator/);assert.match(strategyPrompt(parent.strategyContext),/Working role: orchestrator/);
 assert.throws(()=>validateStrategyContext(f.store.read(),{...child,strategyContext:undefined,sessionRoleContext:undefined}),{code:'STRATEGY_CHILD_SCOPE'});
 await f.store.transaction(s=>{s.events.push(entity({type:'agui',runId:parent.id,event:{type:'TEXT_MESSAGE_CONTENT',messageId:'INJECTED_OBSERVED_MESSAGE',delta:'Proposed task decomposition with exact approved child; synthesis awaits actual findings.'}},f.p.id));});
 g=service.state({projectId:f.p.id},f.owner).strategies[0];assert.equal(g.children.length,1);assert.match(g.supervisorResult.observations[0].event.delta,/decomposition/);
 const beyond=await f.roles.prompt({projectId:f.p.id,operationId:crypto.randomUUID(),parentRunId:parent.id,membershipId:membership.id,text:'Second attempt exceeds explicit total cap.'},f.owner);assert.equal(beyond.status,'unknown');assert.equal(f.ownerLifecycle.calls,1);
 g=service.state({projectId:f.p.id},f.owner).strategies[0];await service.stop({projectId:f.p.id,operationId:crypto.randomUUID(),strategyId:g.id,expectedRevision:g.revision},f.owner);assert.equal(find(f.store.read(),'runs',parent.id).status,'interrupted');assert.equal(find(f.store.read(),'runs',child.id).status,'interrupted');assert.equal(calls,1);assert.equal(f.ownerLifecycle.stopCalls,1);
});
