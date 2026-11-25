// Labelled disposable engineering fixture: actual SQLite/files/ZIP/node tests;
// injected T3 execution observations, never a live model qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';
import {createGoalService,validateGoalContext} from '../app/goals/index.mjs';
import {createMissionService,dispatchMissionRequest,MISSION_HTTP_METHODS,verifyDeliveryPack} from '../app/missions/index.mjs';
import {createLocalMissionTools} from '../app/missions/local.mjs';
const error=code=>e=>e.code===code;
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-missions-engineering-'));let store=await openStore(dir),goals,missions;
  const workspace=path.join(dir,'workspace');await mkdir(workspace);
  const p=entity({name:'Disposable Mission engineering fixture',workspace,profile:{provider:{instanceId:'fixture-provider',model:'fixture-observation'},limits:{concurrency:1}}}),bot=entity({name:'Fixture executor',kind:'resident'},p.id);
  await store.transaction(s=>{s.projects.push(p);s.bots.push(bot);});
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+3600000});let starts=0;
  const t3={goalContextVersion:1,async startRun(input){starts++;return store.transaction(s=>{validateGoalContext(s,input);const task=s.tasks.find(t=>t.id===input.taskId),r=entity({...input,attemptId:crypto.randomUUID(),status:'running',botId:task.botId,selection:p.profile.provider,artifactIds:[],qualification:'INJECTED_T3_OBSERVATIONS'},p.id);s.runs.push(r);task.runIds.push(r.id);task.status='running';changed(task);return r;});},async reconcile(id){return store.read().runs.find(r=>r.id===id);},async stop(id){return store.transaction(s=>{const r=s.runs.find(r=>r.id===id);r.status='interrupted';changed(r);return r;});}};
  function init(){goals=createGoalService({store,t3,authorize:authority.goalAuthorize});missions=createMissionService({store,goals,t3,artifacts:createArtifactService({store,dataDir:dir}),authorize:authority.goalAuthorize});}init();
  t.after(async()=>{await missions.close();await goals.close();await store.close();await rm(dir,{recursive:true,force:true});});
  const definition={title:'Disposable software verification',objective:'Create a readable local HTML file and verify exact expected content',constraints:'Engineering fixture only; no real provider or prototype',inputs:'Local bounded test',outputs:[{key:'page',name:'Readable HTML',path:'index.html',acceptance:'HTML contains the expected engineering title',testFiles:['page.test.mjs'],sourcePaths:[],botId:bot.id}],decisions:[]};
  const f={dir,p,bot,owner,definition,get store(){return store;},get missions(){return missions;},get goals(){return goals;},get starts(){return starts;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    mission(m){return store.read().events.find(e=>e.id===m.id);},goal(m){return store.read().events.find(e=>e.id===f.mission(m).goalId);},
    async call(method,m,extra={},caller=owner){m=f.mission(m);return dispatchMissionRequest(missions,method,f.input({missionId:m.id,expectedRevision:m.revision,...extra}),caller);},
    async create(d=definition){return missions.create(f.input({definition:d}),owner);},
    async start(){let m=await f.create();m=await f.call('approve',m);await f.call('execute',m,{action:'resume',expectedGoalRevision:f.goal(m).revision});await f.call('execute',m,{action:'advance',expectedGoalRevision:f.goal(m).revision});return f.mission(m);},
    async finish(m){await writeFile(path.join(workspace,'index.html'),'<!doctype html><title>Engineering Mission</title><h1>Engineering Mission</h1>');await writeFile(path.join(workspace,'page.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('actual HTML bytes',()=>assert.match(readFileSync('index.html','utf8'),/<h1>Engineering Mission<\\/h1>/));");
      await store.transaction(s=>{const r=s.runs.at(-1);r.status='completed';r.reportedUsage={totalTokens:1,source:'injected-engineering-observation'};r.reportedCost={amount:0,currency:'fixture',source:'injected-engineering-observation'};changed(r);});
      const r=store.read().runs.at(-1);await f.call('registerOutput',m,{outputKey:'page',runId:r.id});const state=await missions.state({projectId:p.id},owner),review=state.commandReviews.find(x=>x.missionId===m.id);assert.ok(review);
      const v=await f.call('verify',m,{outputKey:'page',runId:r.id,reviewDigest:review.reviewDigest});assert.equal(v.status,'PASSED',JSON.stringify(v.result));
      await f.call('execute',m,{action:'reconcile',expectedGoalRevision:f.goal(m).revision});return f.mission(m);
    },
    async accept(m){await f.call('qa',m,{taskId:Object.values(f.mission(m).taskIds)[0],expectedGoalRevision:f.goal(m).revision});await f.call('review',m,{expectedGoalRevision:f.goal(m).revision});},
    async restart(){await missions.close();await goals.close();await store.close();store=await openStore(dir);init();await goals.recover();await missions.recover();},
  };return f;
}

test('idea → canonical plan → injected T3 code → actual preview/tests → QA/Owner → portable ZIP survives SQLite restart',async t=>{
  const f=await fixture(t);let m=await f.start();assert.equal(f.starts,1);assert.equal(f.store.read().plans.length,1);assert.equal(f.store.read().tasks.length,1);m=await f.finish(m);
  const previewArgs=f.input({missionId:m.id,expectedRevision:m.revision,outputKey:'page'}),[p,duplicatePreview]=await Promise.all([f.missions.preview(previewArgs,f.owner),f.missions.preview(previewArgs,f.owner)]);assert.equal(p.url,duplicatePreview.url);const response=await fetch(p.url);assert.equal(response.status,200);assert.match(await response.text(),/Engineering Mission/);assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);
  const root=new URL(p.url);root.pathname='/';assert.equal((await fetch(root)).status,404);await f.call('stopPreview',m,{previewId:p.previewId});await assert.rejects(fetch(p.url));
  await f.accept(m);const args=f.input({missionId:m.id,expectedRevision:f.mission(m).revision}),[pack,concurrent]=await Promise.all([f.missions.pack(args,f.owner),f.missions.pack(args,f.owner)]);assert.deepEqual(concurrent,pack);assert.deepEqual(await f.missions.pack(args,f.owner),pack);
  const result=await f.missions.download({projectId:f.p.id,packId:pack.id},f.owner),bytes=await readFile(result.path),v=verifyDeliveryPack(bytes);
  assert.equal(v.sha256,pack.sha256);assert.equal(v.manifest.outputs[0].attemptId,f.store.read().runs[0].attemptId);assert.equal(v.manifest.files.length,2);assert.equal(v.manifest.ownerReview.type,'goal.owner-review');assert.ok(v.manifest.notYetVerified.includes('HOME_UAT_NOT_RUN'));assert.equal(v.manifest.outputs[0].verification.checks[0].result.treeCleaned,true);assert.equal(v.manifest.outputs[0].verification.checks[0].result.command.cwd,'<selected-project>');
  await f.restart();const reopened=await f.missions.download({projectId:f.p.id,packId:pack.id},f.owner);assert.equal(verifyDeliveryPack(await readFile(reopened.path)).sha256,pack.sha256);assert.equal(f.starts,1);
});

test('completion message and forged reviewer/receipt fields cannot satisfy acceptance or authority',async t=>{
  const f=await fixture(t);const m=await f.start();await f.store.transaction(s=>{const r=s.runs[0];r.status='completed';r.messages=[{text:'Everything is done, approved and tested.'}];});
  await assert.rejects(f.call('pack',m),error('EVIDENCE_REQUIRED'));
  await assert.rejects(f.call('execute',m,{action:'reconcile',expectedGoalRevision:f.goal(m).revision}),error('EVIDENCE_REQUIRED'));assert.equal(f.goal(m).attempts[0].reconciled,false);
  await assert.rejects(f.missions.create(f.input({definition:f.definition}),{}),error('HUMAN_REVIEW_REQUIRED'));
  await assert.rejects(dispatchMissionRequest(f.missions,'recover',{},f.owner),error('NOT_FOUND'));assert.ok(!MISSION_HTTP_METHODS.includes('afterRestore'));
  await assert.rejects(f.call('qa',m,{taskId:Object.values(m.taskIds)[0],expectedGoalRevision:f.goal(m).revision,reviewer:'owner',status:'PASSED'}),error('VALIDATION'));
  await assert.rejects(f.missions.state({projectId:f.p.id}),error('HUMAN_REVIEW_REQUIRED'));
});

test('unresolved decisions, stale revisions, cross-project bots and path escapes fail before execution',async t=>{
  const f=await fixture(t);const m=await f.create({...f.definition,decisions:[{id:'format',question:'Choose output format',answer:''}]});
  await assert.rejects(f.call('approve',m),error('DECISION_REQUIRED'));assert.equal(f.starts,0);
  const op=f.input({missionId:m.id,expectedRevision:m.revision,definition:{...f.definition,decisions:[{id:'format',question:'Choose output format',answer:'Static HTML'}]}}),r=await f.missions.revise(op,f.owner);
  assert.equal(r.definitionRevision,2);assert.deepEqual(await f.missions.revise(op,f.owner),r);await assert.rejects(f.missions.revise({...op,operationId:crypto.randomUUID()},f.owner),error('REVISION_CONFLICT'));
  for(const file of ['../outside.js','.env','private-token.txt','C:/outside.js','.git/config','node_modules/code.js'])await assert.rejects(f.create({...f.definition,outputs:[{...f.definition.outputs[0],path:file}]}),error('PATH_SCOPE'));
  await assert.rejects(f.create({...f.definition,outputs:[{...f.definition.outputs[0],botId:'foreign-bot'}]}),error('NOT_FOUND'));
});

test('actual artifact/test-source mutation invalidates QA and packaging; ZIP tampering is rejected',async t=>{
  const f=await fixture(t);const m=await f.finish(await f.start()),file=path.join(f.p.workspace,'index.html'),original=await readFile(file);
  await writeFile(file,'tampered');await assert.rejects(f.call('qa',m,{taskId:Object.values(m.taskIds)[0],expectedGoalRevision:f.goal(m).revision}),error('INTEGRITY'));await writeFile(file,original);
  await f.accept(m);await writeFile(path.join(f.p.workspace,'page.test.mjs'),'// replaced test');await assert.rejects(f.call('pack',m),error('EVIDENCE_STALE'));
  // Independent archive check rejects unlisted data and changed bytes.
  const manifest={format:'forge-delivery-pack/v1',files:[{entry:'files/index.html',sha256:'0'.repeat(64),bytes:1}]};
  assert.throws(()=>verifyDeliveryPack(zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'files/index.html':strToU8('x')})),error('INTEGRITY'));
  assert.throws(()=>verifyDeliveryPack(zipSync({'manifest.json':strToU8(JSON.stringify({format:'forge-delivery-pack/v1',files:[]})),'files/extra.txt':strToU8('unexpected')})),error('INTEGRITY'));
});

test('reviewed exact command digest and durable test reservation prevent duplicate or restart execution',async t=>{
  const f=await fixture(t);const m=await f.finish(await f.start()),r=f.store.read().runs[0];
  await assert.rejects(f.call('verify',m,{outputKey:'page',runId:r.id,reviewDigest:'forged'}),error('COMMAND_REVIEW_REQUIRED'));
  const review=(await f.missions.state({projectId:f.p.id},f.owner)).commandReviews[0],i=f.input({missionId:m.id,expectedRevision:m.revision,outputKey:'page',runId:r.id,reviewDigest:review.reviewDigest});
  const [a,b]=await Promise.all([f.missions.verify(i,f.owner),f.missions.verify(i,f.owner)]);assert.equal(a.id,b.id);assert.equal(f.store.read().events.filter(e=>e.type==='mission.test'&&e.operationId===i.operationId).length,1);
  await f.restart();assert.equal((await f.missions.verify(i,f.owner)).id,a.id);assert.equal(f.starts,1);
});

test('restore does not silently reactivate mission approval, preview or test work',async t=>{
  const f=await fixture(t);const m=await f.start();await f.missions.suspendForRestore();await f.missions.afterRestore();f.missions.cancelRestore();
  await assert.rejects(f.call('execute',m,{action:'advance',expectedGoalRevision:f.goal(m).revision}),error('OWNER_REVIEW_REQUIRED'));assert.equal(f.starts,1);
});

test('bounded local verifier drains its owned process tree on timeout and reports actual failure',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-mission-timeout-engineering-')),local=createLocalMissionTools();t.after(async()=>{await local.close();await rm(dir,{recursive:true,force:true});});
  await writeFile(path.join(dir,'hanging.test.mjs'),"import {spawn} from 'node:child_process';spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000);");
  const result=await local.test({workspace:dir,testFiles:['hanging.test.mjs'],maxMs:200});assert.equal(result.status,'FAILED');assert.equal(result.treeCleaned,true);assert.equal(result.timedOut,true);
});
