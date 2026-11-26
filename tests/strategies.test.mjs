import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './strategies-fixture.test.mjs';
import {validateStrategyContext,assertStrategySourceAvailable,dispatchStrategyRequest,mergeStrategySafety} from '../app/strategies/index.mjs';
import {createProviderCatalog} from '../app/providers/catalog.mjs';
import {entity,find} from '../app/server/domain.mjs';
import {gitText} from '../app/workspaces/git.mjs';
import {gate} from './product-session-roles-fixture.mjs';

test('fan-out uses real distinct Git Workspaces and joins exact canonical attempts; cost stays unknown',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1)]);
 g=await h.call('advance',g,{stageId:'stage-0'});g=await h.call('advance',g,{stageId:'stage-1'});assert.equal(h.f.starts,2);assert.notEqual(a.worktreePath,b.worktreePath);
 assert.equal(h.store.read().events.filter(e=>e.type==='budget.reservation').length,2);assert.equal(g.cost.actualTotal,null);
 await h.f.edit(a,{'alpha.txt':'Independent actual alpha output'});await h.f.edit(b,{'beta.txt':'Independent actual beta output'});await h.f.finish(a);await h.f.finish(b);g=await h.call('reconcile',g);
 assert.equal(g.status,'awaiting_owner');assert.equal(g.join.length,2);assert.notEqual(g.join[0].attemptId,g.join[1].attemptId);assert.equal(g.qualifications.qaAuthority,false);assert.equal(await gitText(h.f.repo,['branch','--show-current']),'owner-branch');
});
test('concurrent calls and response loss consume one dispatch and recover without replay',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1),g=await h.create([h.stage(a,0),h.stage(b,1)]),hold=gate();h.setBefore(async()=>{hold.enter();await hold.promise;});
 const input=h.input({strategyId:g.id,expectedRevision:g.revision,stageId:'stage-0'}),starting=h.service.advance(input,h.owner);await hold.entered;await h.service.advance(input,h.owner);assert.equal(h.f.starts,1);
 hold.release();await starting;h.setBefore(null);await h.reopen();await h.call('reconcile',g);await assert.rejects(h.call('advance',g,{stageId:'stage-0'}),{code:'STRATEGY_INACTIVE'});assert.equal(h.f.starts,1);
 const current=h.store.read(),restored=structuredClone(current);restored.events=restored.events.filter(e=>!e.type?.startsWith('strategy.'));restored.runs=[];restored.receipts=[];mergeStrategySafety(restored,current);assert.equal(restored.events.find(e=>e.type==='strategy.claim').restoreReviewRequired,true);assert.equal(restored.runs.length,1);
});
test('unknown before native identity remains claimed across restart and Stop never dispatches',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1)]);h.f.control.loseBefore=true;g=await h.call('advance',g,{stageId:'stage-0'});assert.equal(g.stages[0].status,'unknown');await h.reopen();g=await h.call('stop',g);assert.equal(g.status,'stopping');await h.call('reconcile',g);assert.equal(h.f.starts,1);assert.equal(h.f.stops,0);
});
test('DAG rejects cycles and releases only exact completed dependencies, retaining actual output/check refs',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1),stages=[h.stage(a,0),h.stage(b,1,{dependsOn:['stage-0']})];
 await assert.rejects(h.create([{...stages[0],dependsOn:['stage-1']},stages[1]],'dag'),{code:'STRATEGY_CYCLE'});let g=await h.create(stages,'dag');await assert.rejects(h.call('advance',g,{stageId:'stage-1'}),{code:'STRATEGY_DEPENDENCY'});
 g=await h.call('advance',g,{stageId:'stage-0'});await h.f.edit(a,{'generated.txt':'Real dependency evidence'});await h.f.finish(a);await h.f.call('check',a);g=await h.call('reconcile',g);g=await h.call('advance',g,{stageId:'stage-1'});
 const second=h.store.read().runs.at(-1);assert.equal(second.strategyContext.dependencyRefs[0].runId,g.stages[0].result.runId);assert.equal(second.strategyContext.dependencyRefs[0].checkStatus,'passed');assert.equal(second.strategyContext.dependencyRefs[0].worktreePath,a.worktreePath);
});

test('an actual failed Workspace check blocks DAG release even when its native run completed',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1,{dependsOn:['stage-0']})],'dag');g=await h.call('advance',g,{stageId:'stage-0'});await h.f.edit(a,{'bad-diff.txt':'Actual trailing whitespace   \n'});await h.f.finish(a);await h.f.call('check',a);g=await h.call('reconcile',g);assert.equal(g.stages[0].result.checkStatus,'failed');assert.equal(g.stages[1].eligible,false);await assert.rejects(h.call('advance',g,{stageId:'stage-1'}),{code:'STRATEGY_DEPENDENCY'});assert.equal(h.f.starts,1);
});
test('generator/verifier keeps separate roles and real checks/feedback without granting QA success',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0,{purpose:'generator'}),h.stage(b,1,{purpose:'verifier',dependsOn:['stage-0']})],'generator-verifier');
 g=await h.call('advance',g,{stageId:'stage-0'});await h.f.edit(a,{'result.txt':'Actual generated result'});await h.f.finish(a);await h.f.call('check',a);g=await h.call('reconcile',g);g=await h.call('advance',g,{stageId:'stage-1'});
 await h.f.edit(b,{'findings.txt':'Reproduced generated result check in separate approved workspace'});await h.f.finish(b);await h.f.call('check',b);g=await h.call('reconcile',g);const feedback=await h.call('feedback',g,{stageId:'stage-1',text:'Owner read reproducible findings against exact generator and verifier references'});
 assert.equal(feedback.result.checkStatus,'passed');assert.notEqual(g.stages[0].result.runId,g.stages[1].result.runId);assert.equal(g.status,'awaiting_owner');assert.equal(h.store.read().tasks.some(t=>t.status==='done'),false);
});
test('candidates require explicit scoped Owner selection with actual Workspace evidence; selection never merges',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0,{purpose:'candidate'}),h.stage(b,1,{purpose:'candidate'})],'independent-candidates',{rubric:['Reproducible output']});const original=await gitText(h.f.repo,['rev-parse','HEAD']);
 await assert.rejects(h.call('select',g,{stageId:'stage-0',reason:'Self-report',rubricEvidence:[]}),{code:'STRATEGY_SELECTION'});
 for(const [n,w]of [[0,a],[1,b]]){g=await h.call('advance',g,{stageId:`stage-${n}`});await h.f.edit(w,{[`candidate-${n}.txt`]:'Independent actual output'});await h.f.finish(w);await h.f.call('check',w);g=await h.call('reconcile',g);}
 await assert.rejects(h.service.select(h.input({strategyId:g.id,expectedRevision:g.revision,stageId:'stage-0',reason:'Forged actor',rubricEvidence:[]}),{kind:'human',role:'owner'}),{code:'STRATEGY_OWNER_REQUIRED'});
 await assert.rejects(h.call('select',g,{stageId:'stage-0',reason:'No forged check',rubricEvidence:[{criterion:'Reproducible output',checkId:'fake',note:'Model says passed'}]}),{code:'STRATEGY_EVIDENCE'});
 const selection=await h.call('select',g,{stageId:'stage-0',reason:'Owner inspected exact check',rubricEvidence:[{criterion:'Reproducible output',checkId:g.stages[0].result.checkId,note:'Passed actual diff check on committed candidate head'}]});assert.equal(selection.automaticMerge,false);assert.equal(await gitText(h.f.repo,['rev-parse','HEAD']),original);assert.equal(h.store.read().events.some(e=>e.type==='workspace.integration'),false);
});
test('router records actual role/catalog/capability decision and blocks unavailable or stale routes',async t=>{
 const h=await fixture(t),a=await h.f.create(0);await assert.rejects(h.create([h.stage(a,0,{purpose:'specialist'})],'router-specialists'),{code:'STRATEGY_NEEDS_SETUP'});
 const c=entity({kind:'provider',enabled:true,providerInstanceId:'fixture-codex',config:{routeId:'codex',generation:1},lastCheck:{status:'ready',authentication:'authenticated'}},h.f.p.id);await h.store.transaction(s=>{s.connections.push(c);find(s,'projects',h.f.p.id).profile.provider={instanceId:c.providerInstanceId,connectionId:c.id,model:'fixture-model',options:[]};});
 const catalog=createProviderCatalog({store:h.store,t3:{catalog:async()=>({providers:[{providerInstanceId:c.providerInstanceId,models:[{id:'fixture-model',options:[]}],canRunChildTask:true,runtimeModes:['approval-required']}]})}});await catalog.refresh({projectId:h.f.p.id,connectionId:c.id});
 // Workspace pins settings; create a fresh unused allocation after route change.
 const b=await h.f.create(1);let g=await h.create([h.stage(b,1,{purpose:'specialist'})],'router-specialists',{requiredCapabilities:['t3.run']});assert.equal(g.routeDecision.selection.model,'fixture-model');assert.equal(g.routeDecision.role.role,'reviewer');
 await h.store.transaction(s=>{find(s,'connections',c.id).providerCatalog.stale=true;});await assert.rejects(h.call('advance',g,{stageId:'stage-1'}),{code:'STRATEGY_NEEDS_SETUP'});assert.equal(h.f.starts,0);
});
test('unconditional guards reject stripped claims, held-task bypass, role drift and final Stop races',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1)]);assert.throws(()=>assertStrategySourceAvailable(h.store.read(),h.f.p.id,{taskId:a.taskId}),{code:'STRATEGY_HELD'});
 const hold=gate();h.setBefore(async()=>{hold.enter();await hold.promise;});const starting=h.call('advance',g,{stageId:'stage-0'});await hold.entered;const claim=h.store.read().events.find(e=>e.type==='strategy.claim');
 assert.throws(()=>validateStrategyContext(h.store.read(),{projectId:h.f.p.id,taskId:a.taskId,operationId:claim.context.operationId,workspaceContext:{workspaceId:a.id}}),{code:'STRATEGY_CONTEXT'});
 g=await h.call('stop',g);hold.release();g=await starting;assert.equal(h.store.read().runs.length,0);assert.equal(g.stopRequested,true);assert.equal(h.f.starts,1);
 assert.throws(()=>dispatchStrategyRequest(h.service,'recover',{},h.owner),{code:'NOT_FOUND'});assert.throws(()=>dispatchStrategyRequest(h.service,'state',{projectId:h.f.p.id,actor:'Owner'},h.owner),{code:'STRATEGY_INPUT'});
});

test('reported-cost unknown and concurrent ceilings block continuation; lost accepted response stops only exact retained attempt',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1)],'fan-out-fan-in',{limits:{maxAttempts:2,maxConcurrent:1,maxMs:300000,reportedCost:{unknown:'block',maxAmount:null,currency:null}}});
 h.f.control.loseAfter=true;g=await h.call('advance',g,{stageId:'stage-0'});h.f.control.loseAfter=false;assert.equal(h.f.starts,1);assert.ok(g.stages[0].result.runId);await assert.rejects(h.call('advance',g,{stageId:'stage-1'}),{code:'STRATEGY_LIMIT'});
 await h.f.finish(a);g=await h.call('reconcile',g);await assert.rejects(h.call('advance',g,{stageId:'stage-1'}),{code:'STRATEGY_COST_UNKNOWN'});
 await h.store.transaction(s=>{find(s,'runs',g.stages[0].result.runId).reportedCost={amount:1,currency:'THB',source:'INJECTED_CANONICAL_USAGE'};});g=await h.call('advance',g,{stageId:'stage-1'});assert.equal(h.f.starts,2);const stopped=await h.call('stop',g);assert.equal(stopped.status,'stopped');assert.equal(h.f.stops,1);assert.equal(find(h.store.read(),'runs',g.stages[0].result.runId).status,'completed');assert.doesNotThrow(()=>assertStrategySourceAvailable(h.store.read(),h.f.p.id,{taskId:a.taskId}));
});

test('role changes during asynchronous setup fail final admission, without native effect or new allocation',async t=>{
 const h=await fixture(t),a=await h.f.create(0),b=await h.f.create(1);let g=await h.create([h.stage(a,0),h.stage(b,1)]);const hold=gate();h.setBefore(async()=>{hold.enter();await hold.promise;});const starting=h.call('advance',g,{stageId:'stage-0'});await hold.entered;
 await h.roles.assign(h.input({conversationId:h.chats[0].id,botId:h.bots[0].id,role:'tester',expectedRevision:1}),h.owner);hold.release();g=await starting;assert.equal(h.store.read().runs.length,0);assert.equal(g.stages[0].status,'unknown');await assert.rejects(h.call('advance',g,{stageId:'stage-0'}),{code:'STRATEGY_RECONCILE'});assert.equal(h.f.starts,1);
});

test('restore lifecycle drains, denies mutations and reopens without reviving an allocation or timer',async t=>{
 const h=await fixture(t),a=await h.f.create(0),g=await h.create([h.stage(a,0)],'dag');await h.service.beforeRestore();
 await assert.rejects(h.call('advance',g,{stageId:'stage-0'}),{code:'RESTORE_IN_PROGRESS'});assert.throws(()=>dispatchStrategyRequest(h.service,'afterRestore',{},h.owner),{code:'NOT_FOUND'});
 await h.store.transaction(s=>{mergeStrategySafety(s,structuredClone(s));});await h.service.afterRestore();assert.equal(h.latest(g).restoreReviewRequired,true);await assert.rejects(h.call('advance',g,{stageId:'stage-0'}),{code:'STRATEGY_INACTIVE'});assert.equal(h.f.starts,0);
});
