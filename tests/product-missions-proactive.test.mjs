// Production HTTP/session/SQLite/local verifier/preview/ZIP. Provider execution
// observations alone are injected; this is not a live model or sandbox claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {validateGoalContext} from '../app/goals/context.mjs';
import {verifyDeliveryPack} from '../app/missions/package.mjs';

async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-product-missions-')),app=await createApplication({dataDir:path.join(dir,'data')});t.after(()=>app.close());
  const response=await fetch(app.url+'/api/session'),cookie=response.headers.get('set-cookie').split(';')[0],csrf=(await response.json()).csrf;
  const post=async(route,input,{auth=true}={})=>{
    const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-Forge-CSRF':csrf}:{})},body:JSON.stringify(input)}),data=await r.json();
    if(!r.ok)throw Object.assign(new Error(data.error.message),{status:r.status,...data.error});return data;
  };
  const project=(await post('/api/command',{type:'project.create',operationId:crypto.randomUUID(),data:{name:'Disposable integrated Mission fixture',workspace:path.join(dir,'workspace'),profile:{provider:{instanceId:'injected-fixture-provider',model:'injected-observation',options:[]}}}})).entity;
  const current=id=>app.store.read().events.find(e=>e.id===id);
  return {app,dir,post,project,cookie,current,input:extra=>({projectId:project.id,operationId:crypto.randomUUID(),...extra})};
}

test('production Mission routes retain unknown usage and require actual tests/QA/Owner before verified download',async t=>{
  const f=await fixture(t),{app,post,project,current}=f;let starts=0;
  app.t3.startRun=async input=>{starts++;return app.store.transaction(s=>{validateGoalContext(s,input);const task=s.tasks.find(x=>x.id===input.taskId),r=entity({...input,botId:task.botId,attemptId:crypto.randomUUID(),status:'completed',selection:project.profile.provider,artifactIds:[],qualification:'INJECTED_PROVIDER_OBSERVATION_NO_USAGE_REPORTED'},project.id);s.runs.push(r);task.runIds.push(r.id);changed(task);return r;});};
  app.t3.reconcile=async id=>app.store.read().runs.find(r=>r.id===id);
  await assert.rejects(post('/api/missions/state',{projectId:project.id},{auth:false}),{code:'BROWSER_SESSION_REQUIRED'});
  await assert.rejects(post('/api/missions/recover',{}),{code:'NOT_FOUND'});
  const definition={title:'Verified engineering delivery',objective:'A static page backed by actual tests',constraints:'Disposable qualification; no provider or prototype',inputs:'Known engineering bytes',outputs:[{key:'page',name:'Static page',path:'index.html',acceptance:'Contains the expected heading',testFiles:['page.test.mjs'],sourcePaths:[],botId:null,dependsOn:[]}],decisions:[]};
  let m=await post('/api/missions/create',f.input({definition}));
  const call=async(method,extra={})=>{m=current(m.id);return post('/api/missions/'+method,f.input({missionId:m.id,expectedRevision:m.revision,...extra}));};
  await call('approve');m=current(m.id);assert.equal(starts,0);assert.equal(app.store.read().plans.find(p=>p.id===m.planId).approved,true);
  const execute=action=>call('execute',{action,expectedGoalRevision:current(m.goalId).revision});
  await execute('resume');await execute('advance');assert.equal(starts,1);
  const run=app.store.read().runs[0];
  await writeFile(path.join(project.workspace,'index.html'),'<!doctype html><title>FORGE engineering fixture</title><h1>Verified delivery</h1>');
  await writeFile(path.join(project.workspace,'page.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('actual output',()=>assert.ok(readFileSync('index.html','utf8').includes('<h1>Verified delivery</h1>')));");
  await assert.rejects(call('pack'),{code:'EVIDENCE_REQUIRED'});
  await call('registerOutput',{outputKey:'page',runId:run.id});
  const state=await post('/api/missions/state',{projectId:project.id}),review=state.commandReviews.find(x=>x.missionId===m.id);
  const tested=await call('verify',{outputKey:'page',runId:run.id,reviewDigest:review.reviewDigest});assert.equal(tested.status,'PASSED',JSON.stringify(tested));assert.equal(tested.result.treeCleaned,true);
  const preview=await call('preview',{outputKey:'page'}),previewResponse=await fetch(preview.url);assert.match(await previewResponse.text(),/Verified delivery/);assert.match(previewResponse.headers.get('content-security-policy'),/connect-src 'none'/);
  await call('stopPreview',{previewId:preview.previewId});await assert.rejects(fetch(preview.url));
  await execute('reconcile');let g=current(m.goalId);assert.equal(g.usage.tokens.total,null);assert.equal(g.status,'blocked');assert.equal(g.blocker.code,'TOKENS_UNKNOWN');
  await call('qa',{taskId:m.taskIds.page,expectedGoalRevision:g.revision});g=current(g.id);
  await call('review',{expectedGoalRevision:g.revision});assert.equal(current(g.id).status,'completed');
  const pack=await call('pack'),url=`${app.url}/api/missions/${pack.id}/download?projectId=${project.id}`;
  assert.equal((await fetch(url)).status,403,'Download requires an existing authenticated browser session');
  const download=await fetch(url,{headers:{Cookie:f.cookie}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);
  const verified=verifyDeliveryPack(Buffer.from(await download.arrayBuffer()));assert.equal(verified.sha256,pack.sha256);assert.equal(verified.manifest.outputs[0].runId,run.id);
  assert.equal(starts,1);assert.equal(app.store.read().runs[0].reportedCost,undefined,'Unknown cost is never synthesized as a free fixture run');
});

test('production Proactive Owner setup sends unqualified native routes to Inbox before any start and restore invalidates grants',async t=>{
  const f=await fixture(t),{app,post,project,current}=f;
  const create=async(type,data)=>(await post('/api/command',{type,operationId:crypto.randomUUID(),projectId:project.id,data})).entity;
  const plan=await create('plan.create',{name:'Reviewed proactive fixture',approved:true}),task=await create('task.create',{title:'Read existing fixture',planId:plan.id,status:'ready'});
  await assert.rejects(post('/api/proactive/state',{projectId:project.id},{auth:false}),{code:'BROWSER_SESSION_REQUIRED'});
  await assert.rejects(post('/api/proactive/ingestEvent',{}),{code:'NOT_FOUND'});
  let recipe=await post('/api/proactive/create',f.input({name:'Scoped read fixture',instructions:'Read and propose only',planId:plan.id,taskIds:[task.id],trigger:{kind:'schedule',timezone:'Asia/Bangkok',localTime:'09:00',weekdays:[0,1,2,3,4,5,6],maxLatenessMs:60000},identity:{connectionIds:[]},scope:{paths:['.'],capabilities:['read','propose']},budget:{maxRuns:1,maxRunMs:30000,maxTokens:null,maxCost:null,currency:null},expiresAt:Date.now()+3600000}));
  const call=async method=>{recipe=current(recipe.id);return post('/api/proactive/'+method,f.input({recipeId:recipe.id,expectedRevision:recipe.revision}));};
  recipe=await call('approve');recipe=await call('enable');
  await app.store.transaction(s=>{const r=s.events.find(e=>e.id===recipe.id);r.nextDue={...r.nextDue,at:Date.now()-1};});
  await app.proactive.tick();const state=await post('/api/proactive/state',{projectId:project.id});
  assert.equal(app.store.read().runs.length,0);assert.ok(state.inbox.some(i=>i.code==='NATIVE_ENFORCEMENT_UNQUALIFIED'));
  assert.equal(app.t3.qualifyProactive(app.store.read(),{}),null);
  const backup=await post('/api/storage/backup',{});
  await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});
  assert.equal(current(recipe.id).grant,null);assert.equal(current(recipe.id).status,'needs_approval');
  assert.equal(app.store.read().runs.length,0);
});

test('production Budget Owner routes configure exact money while native observation and release remain private',async t=>{
  const {post,project}=await fixture(t);
  await assert.rejects(post('/api/budgets/state',{projectId:project.id},{auth:false}),{code:'BROWSER_SESSION_REQUIRED'});
  for(const method of ['observe','confirmNotDispatched','reconcile','__proto__'])await assert.rejects(post('/api/budgets/'+method,{}),{code:'NOT_FOUND'});
  const input={projectId:project.id,operationId:crypto.randomUUID(),botId:null,expectedRevision:0,enabled:true,unknown:'block',period:'month',limit:{minorUnits:10000,scale:2,currency:'USD'},reserve:{minorUnits:250,scale:2,currency:'USD'}};
  const policy=await post('/api/budgets/configure',input);assert.equal(policy.policyRevision,1);assert.deepEqual(policy.limit,input.limit);
  assert.deepEqual(await post('/api/budgets/configure',input),policy);
  await assert.rejects(post('/api/budgets/configure',{...input,operationId:crypto.randomUUID()}),{code:'REVISION_CONFLICT'});
  const report=await post('/api/budgets/state',{projectId:project.id});assert.ok(JSON.stringify(report).includes('USD'));
});

test('production SuperUser preset and brief create one canonical Mission draft without execution or approval',async t=>{
  const {post,app,project}=await fixture(t);
  await assert.rejects(post('/api/playbooks/state',{projectId:project.id},{auth:false}),{code:'BROWSER_SESSION_REQUIRED'});
  await assert.rejects(post('/api/playbooks/afterRestore',{}),{code:'NOT_FOUND'});
  const presets=await post('/api/playbooks/presets',{projectId:project.id});assert.ok(JSON.stringify(presets).includes('software-delivery'));
  const objective='A verified engineering page';
  const workflow=await post('/api/playbooks/create',{operationId:crypto.randomUUID(),projectId:project.id,presetId:'software-delivery',title:'Reviewed software brief',brief:{objective,inputsScope:'Selected workspace only',acceptance:'Local Node test passes against real bytes',interfacesDependencies:'No external dependencies',risksDecisions:'No API spend or new runtime'},decisions:[]});
  assert.equal(app.store.read().plans.length,0);assert.equal(app.store.read().runs.length,0);
  const input={projectId:project.id,operationId:crypto.randomUUID(),workflowId:workflow.id,expectedRevision:workflow.revision,definition:{title:'Software draft',objective,inputs:'Known bytes',constraints:'No outward effects',decisions:[],outputs:[{key:'page',name:'Verified page',path:'index.html',acceptance:'Expected heading',testFiles:['output.test.mjs'],sourcePaths:[],botId:null,dependsOn:[]}]}};
  const linked=await post('/api/playbooks/materialize',input);assert.deepEqual(await post('/api/playbooks/materialize',input),linked);
  assert.equal(app.store.read().plans.length,1);assert.equal(app.store.read().plans[0].approved,false);assert.equal(app.store.read().runs.length,0);assert.equal(app.store.read().skills.length,0);
  const backup=await post('/api/storage/backup',{});await post('/api/storage/restore',{id:backup.id,expectedRevision:app.store.read().revision});
  const state=await post('/api/playbooks/state',{projectId:project.id});assert.equal(state.workflows[0].restoreReviewRequired,true);
});
