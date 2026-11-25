// Disposable engineering fixture: real SQLite, files, Mission/Goals, Memory and
// node verifier; injected T3 observations only. No live provider/model claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity,changed} from '../app/server/domain.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';
import {createGoalService,validateGoalContext} from '../app/goals/index.mjs';
import {createMissionService} from '../app/missions/index.mjs';
import {createMemoryService} from '../app/memory/index.mjs';
import {projection} from '../app/memory/contracts.mjs';
import {createAdaptiveService} from '../app/adaptive/index.mjs';
import {createPlaybookService,dispatchPlaybookRequest,PLAYBOOK_HTTP_METHODS} from '../app/playbooks/index.mjs';
const error=code=>e=>e.code===code;
const brief={objective:'Produce a readable engineering HTML file',inputsScope:'Disposable local inputs only',acceptance:'The file contains the engineering title and passes its explicit test',interfacesDependencies:'HTML and node:test; no external service',risksDecisions:'Stop on failed checks. No provider execution from preset selection.'};
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-playbooks-engineering-'));let store=await openStore(dir),goals,missions,memory,adaptive,playbooks;
  const workspace=path.join(dir,'workspace');await mkdir(workspace);
  const p=entity({name:'Disposable playbooks fixture',workspace,profile:{provider:{instanceId:'engineering-provider',model:'injected-engineering-model'},limits:{concurrency:1}}}),other=entity({name:'Isolated project',workspace:path.join(dir,'other')}),bot=entity({name:'Engineering executor',kind:'resident'},p.id);
  await store.transaction(s=>{s.projects.push(p,other);s.bots.push(bot);});
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+3600000});let starts=0,loseMission=false,loseMemory=false,failBeforeMemory=false;
  const t3={goalContextVersion:1,async startRun(input){starts++;return store.transaction(s=>{validateGoalContext(s,input);const task=s.tasks.find(t=>t.id===input.taskId),r=entity({...input,attemptId:crypto.randomUUID(),status:'running',botId:task.botId,selection:p.profile.provider,artifactIds:[],qualification:'INJECTED_T3_ENGINEERING_OBSERVATION'},p.id);s.runs.push(r);task.runIds.push(r.id);task.status='running';changed(task);return r;});},async reconcile(id){return store.read().runs.find(r=>r.id===id);},async stop(){throw new Error('Fixture stop is not used');}};
  async function init(){
    goals=createGoalService({store,t3,authorize:authority.goalAuthorize});missions=createMissionService({store,goals,t3,artifacts:createArtifactService({store,dataDir:dir}),authorize:authority.goalAuthorize});adaptive=createAdaptiveService({store,t3});
    memory=await createMemoryService({store,dataDir:dir,authorize:authority.authorize,adaptive});
    playbooks=createPlaybookService({store,missions:{async create(...args){const r=await missions.create(...args);if(loseMission){loseMission=false;throw new Error('Injected lost Mission response');}return r;}},memory:{async remember(...args){if(failBeforeMemory){failBeforeMemory=false;throw new Error('Injected Memory unavailable before commit');}const r=await memory.remember(...args);if(loseMemory){loseMemory=false;throw new Error('Injected lost Memory response');}return r;}},adaptive,authorize:authority.goalAuthorize});
  }await init();
  async function close(){await playbooks.close();await memory.close();await missions.close();await goals.close();await store.close();}
  t.after(async()=>{await close();await rm(dir,{recursive:true,force:true});});
  const f={p,other,owner,bot,dir,get store(){return store;},get playbooks(){return playbooks;},get memory(){return memory;},get starts(){return starts;},get missions(){return missions;},get goals(){return goals;},
    input(extra={}){return {projectId:p.id,operationId:crypto.randomUUID(),...extra};},
    current(w){return store.read().events.find(e=>e.id===w.id);},
    async create(extra={}){return playbooks.create(f.input({presetId:'software-delivery',title:'Engineering delivery',brief,decisions:[],...extra}),owner);},
    async call(method,w,extra={},caller=owner){w=f.current(w);return dispatchPlaybookRequest(playbooks,method,f.input({workflowId:w.id,expectedRevision:w.revision,...extra}),caller);},
    definition(extra={}){return {title:'Engineering delivery',objective:brief.objective,inputs:brief.inputsScope,constraints:brief.risksDecisions,outputs:[{key:'html',name:'Engineering HTML',path:'index.html',acceptance:brief.acceptance,testFiles:['output.test.mjs'],sourcePaths:[],botId:bot.id,dependsOn:[]}],decisions:[],...extra};},
    async materialize(w){return f.call('materialize',w,{definition:f.definition()});},
    async verified(w){
      const link=await f.materialize(w);let m=f.current({id:link.missionId});
      const mcall=(method,extra={})=>missions[method](f.input({missionId:m.id,expectedRevision:f.current(m).revision,...extra}),owner);
      const goal=()=>f.current({id:f.current(m).goalId});
      await mcall('approve');await mcall('execute',{action:'resume',expectedGoalRevision:goal().revision});await mcall('execute',{action:'advance',expectedGoalRevision:goal().revision});
      await writeFile(path.join(p.workspace,'index.html'),'<!doctype html><title>Engineering</title><h1>Engineering</h1>');
      await writeFile(path.join(p.workspace,'output.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('actual output bytes',()=>assert.match(readFileSync('index.html','utf8'),/<h1>Engineering<\\/h1>/));");
      await store.transaction(s=>{const r=s.runs.at(-1);r.status='completed';r.reportedUsage={totalTokens:1,source:'injected'};r.reportedCost={amount:0,currency:'fixture',source:'injected'};changed(r);});
      const r=store.read().runs.at(-1);const output=await mcall('registerOutput',{outputKey:'html',runId:r.id});
      const command=(await missions.state({projectId:p.id},owner)).commandReviews[0];await mcall('verify',{outputKey:'html',runId:r.id,reviewDigest:command.reviewDigest});
      await mcall('execute',{action:'reconcile',expectedGoalRevision:goal().revision});
      const v=store.read().events.filter(e=>e.type==='verification.result').at(-1);assert.equal(v.status,'PASSED');
      return {runId:r.id,attemptId:r.attemptId,artifactId:output.artifactId,verificationId:v.id};
    },
    review(w,evidence,extra={}){return f.call('review',w,{evidence:[evidence],findings:[{label:'observation',text:'The explicit local verifier checked these exact HTML bytes.',evidenceIndexes:[0]}],...extra});},
    loseNextMission(){loseMission=true;},loseNextMemory(){loseMemory=true;},failBeforeMemory(){failBeforeMemory=true;},
    async restart(){await close();store=await openStore(dir);await init();await goals.recover();await missions.recover();},
  };return f;
}

test('compiled presets and five-part brief persist in actual SQLite; selection creates zero execution or tasks',async t=>{
  const f=await fixture(t),presets=await f.playbooks.presets({projectId:f.p.id},f.owner);assert.equal(presets.presets.length,5);assert.deepEqual(new Set(presets.presets.map(p=>p.pattern)),new Set(['Loop','Graph','Dynamic']));
  const args=f.input({presetId:'software-delivery',title:'Engineering',brief,decisions:[]}),w=await f.playbooks.create(args,f.owner);assert.equal(w.briefRevision,1);assert.equal(w.missionId,null);
  assert.equal(f.starts,0);assert.equal(f.store.read().tasks.length,0);assert.equal(f.store.read().plans.length,0);assert.equal(f.store.read().runs.length,0);
  await f.restart();assert.deepEqual(await f.playbooks.create(args,f.owner),w);const state=await f.playbooks.state({projectId:f.p.id},f.owner);assert.equal(state.briefs[0].brief.objective,brief.objective);assert.equal(state.workflows[0].preset.source.kind,'forge-original');
  await assert.rejects(f.playbooks.create({...args,title:'changed'},f.owner),error('OPERATION_REUSE'));
});

test('Owner-only strict allowlist and project separation reject forged authority and cross-project linkage',async t=>{
  const f=await fixture(t),w=await f.create();assert.deepEqual(PLAYBOOK_HTTP_METHODS,['presets','state','create','revise','materialize','review','proposeLesson']);
  for(const method of ['state','presets'])await assert.rejects(f.playbooks[method]({projectId:f.p.id},{kind:'human',role:'owner',subject:'forged'}),error('HUMAN_REVIEW_REQUIRED'));
  await assert.rejects(dispatchPlaybookRequest(f.playbooks,'afterRestore',{},f.owner),error('NOT_FOUND'));
  await assert.rejects(dispatchPlaybookRequest(f.playbooks,'create',f.input({presetId:'software-delivery',title:'bad',brief,decisions:[],actor:{role:'owner'}}),f.owner),error('VALIDATION'));
  await assert.rejects(f.call('materialize',w,{projectId:f.other.id,definition:f.definition()}),error('NOT_FOUND'));
  assert.deepEqual((await f.playbooks.state({projectId:f.other.id},f.owner)).workflows,[]);
  for(const key of Object.keys(brief))await assert.rejects(f.create({brief:{...brief,[key]:''}}),error('VALIDATION'));
  await assert.rejects(f.create({presetId:'archive-script'}),error('VALIDATION'));assert.equal(f.starts,0);
});

test('unresolved decisions and stale brief revisions block materialization; reviewed draft links canonical Mission exactly once',async t=>{
  const f=await fixture(t),decisions=[{id:'format',question:'Output format?',answer:''}],w=await f.create({decisions});
  await assert.rejects(f.materialize(w),error('DECISION_REQUIRED'));
  const choices=[{...decisions[0],answer:'HTML'}],args=f.input({workflowId:w.id,expectedRevision:w.revision,title:w.title,brief,decisions:choices}),revised=await f.playbooks.revise(args,f.owner);
  assert.equal(revised.briefRevision,2);assert.deepEqual(await f.playbooks.revise(args,f.owner),revised);
  await assert.rejects(f.playbooks.revise({...args,operationId:crypto.randomUUID()},f.owner),error('REVISION_CONFLICT'));
  await assert.rejects(f.materialize(w),error('BRIEF_MISMATCH'));
  const input=f.input({workflowId:w.id,expectedRevision:revised.revision,definition:f.definition({decisions:choices})}),[a,b]=await Promise.all([f.playbooks.materialize(input,f.owner),f.playbooks.materialize(input,f.owner)]);
  assert.deepEqual(a,b);const s=f.store.read(),m=s.events.find(e=>e.id===a.missionId);assert.equal(m.type,'mission.definition');assert.equal(m.status,'draft');assert.equal(m.goalId,null);assert.equal(s.plans[0].approved,false);assert.equal(s.tasks.length,1);assert.equal(s.events.filter(e=>e.type==='goal.goal').length,0);assert.equal(f.starts,0);
  await f.restart();assert.deepEqual(await f.playbooks.materialize(input,f.owner),a);assert.equal(f.store.read().tasks.length,1);
});

test('lost Mission response reservation survives restart and exact retry never duplicates plans, tasks or runs',async t=>{
  const f=await fixture(t),w=await f.create(),input=f.input({workflowId:w.id,expectedRevision:w.revision,definition:f.definition()});f.loseNextMission();
  await assert.rejects(f.playbooks.materialize(input,f.owner),/Injected lost Mission/);assert.equal(f.store.read().tasks.length,1);assert.ok(f.current(w).pending);
  await assert.rejects(f.call('revise',w,{title:w.title,brief,decisions:[]}),error('RECONCILE_REQUIRED'));
  await f.restart();const a=await f.playbooks.materialize(input,f.owner);assert.equal(f.current(w).pending,null);assert.equal(f.store.read().plans.length,1);assert.equal(f.store.read().tasks.length,1);assert.equal(f.starts,0);assert.equal(a.missionId,f.current(w).missionId);
});

test('recovering a lost Mission-create response preserves a subsequent explicit Mission approval without dispatch',async t=>{
  const f=await fixture(t),w=await f.create(),input=f.input({workflowId:w.id,expectedRevision:w.revision,definition:f.definition()});f.loseNextMission();await assert.rejects(f.playbooks.materialize(input,f.owner));
  const m=f.store.read().events.find(e=>e.type==='mission.definition');await f.missions.approve(f.input({missionId:m.id,expectedRevision:m.revision}),f.owner);
  const result=await f.playbooks.materialize(input,f.owner);assert.equal(result.missionId,m.id);assert.equal(f.store.read().plans.length,1);assert.equal(f.store.read().plans[0].approved,true);assert.equal(f.store.read().events.filter(e=>e.type==='goal.goal').length,1);assert.equal(f.starts,0);
});

test('exact review records and procedural draft lessons survive SQLite restart without forging QA or promoting skills',async t=>{
  const f=await fixture(t),w=await f.create(),e=await f.verified(w),r=await f.review(w,e);assert.equal(r.reviewVersion,1);assert.equal(r.evidence[0].ref.attemptId,e.attemptId);assert.equal(r.evidence[0].provider.model,'injected-engineering-model');assert.ok(r.evidence[0].sourceFiles.some(f=>f.path==='output.test.mjs'));
  assert.equal(f.store.read().events.filter(e=>e.type==='goal.qa'||e.type==='goal.owner-review').length,0);assert.equal(f.store.read().tasks[0].status==='done',false);
  const input=f.input({workflowId:w.id,expectedRevision:f.current(w).revision,reviewId:r.id,title:'Check actual output before handoff',procedure:'For local HTML delivery, verify the registered output bytes with the explicit node test before requesting independent QA.'}),a=await f.playbooks.proposeLesson(input,f.owner),b=await f.playbooks.proposeLesson(input,f.owner);assert.deepEqual(a,b);assert.equal(a.lessonStatus,'draft');
  const m=projection(f.store.read()).records.get(a.memoryId);assert.equal(m.memoryType,'procedural');assert.equal(m.lessonStatus,'draft');assert.equal(m.verification.status,'unverified');assert.equal(m.executable,false);assert.equal(m.sourceRefs.length,3);assert.deepEqual(m.shares,[]);assert.equal(f.store.read().skills.length,0);
  assert.equal((await f.playbooks.state({projectId:f.p.id},f.owner)).reviews[0].evidenceStatus,'current');
  await f.restart();assert.deepEqual(await f.playbooks.proposeLesson(input,f.owner),a);assert.equal(projection(f.store.read()).records.size,1);assert.equal(f.starts,1);
  assert.equal((await f.playbooks.state({projectId:f.other.id},f.owner)).lessons.length,0);assert.equal((await f.playbooks.state({projectId:f.p.id},f.owner)).reviews[0].evidenceStatus,'stale'); // Goals recovery records a new exact revision.
});

test('changed artifact bytes, test source revisions and forged attempt/verifier links cannot support new lessons',async t=>{
  const f=await fixture(t),w=await f.create(),e=await f.verified(w);
  await assert.rejects(f.review(w,{...e,attemptId:'forged-attempt'}),error('EVIDENCE_SCOPE'));
  await assert.rejects(f.review(w,e,{findings:[{label:'PASSED',text:'QA accepted',evidenceIndexes:[0]}]}),error('VALIDATION'));
  const r=await f.review(w,e),lesson=()=>f.call('proposeLesson',w,{reviewId:r.id,title:'Do the checks',procedure:'Inspect bounded source checksums before handing off.'});
  const file=path.join(f.p.workspace,'index.html'),original=await readFile(file);await writeFile(file,'changed');await assert.rejects(lesson(),error('EVIDENCE_STALE'));assert.equal(projection(f.store.read()).records.size,0);await writeFile(file,original);
  const source=path.join(f.p.workspace,'output.test.mjs'),originalSource=await readFile(source);await writeFile(source,'// changed verifier code');await assert.rejects(lesson(),error('EVIDENCE_STALE'));await writeFile(source,originalSource);
  await f.store.transaction(s=>{const v=s.events.find(x=>x.id===e.verificationId);v.checkedAt=new Date(Date.now()+1000).toISOString();changed(v);});await assert.rejects(lesson(),error('EVIDENCE_STALE'));
  assert.equal((await f.playbooks.state({projectId:f.p.id},f.owner)).reviews[0].evidenceStatus,'stale');
});

test('lost Memory response reconciles the same draft after restart with no duplicate memory or skill writes',async t=>{
  const f=await fixture(t),w=await f.create(),e=await f.verified(w),r=await f.review(w,e),input=f.input({workflowId:w.id,expectedRevision:f.current(w).revision,reviewId:r.id,title:'One draft procedure',procedure:'Run the selected local verifier against exact registered bytes.'});f.loseNextMemory();
  await assert.rejects(f.playbooks.proposeLesson(input,f.owner),/Injected lost Memory/);assert.equal(projection(f.store.read()).records.size,1);
  await f.restart();const result=await f.playbooks.proposeLesson(input,f.owner);assert.equal(result.lessonStatus,'draft');assert.equal(f.current(w).pending,null);assert.equal(projection(f.store.read()).records.size,1);assert.equal(f.store.read().skills.length,0);assert.equal(f.starts,1);
});

test('stale reserved lesson with no committed memory becomes a durable no-effect outcome and releases the brief for revision',async t=>{
  const f=await fixture(t),w=await f.create(),e=await f.verified(w),r=await f.review(w,e),input=f.input({workflowId:w.id,expectedRevision:f.current(w).revision,reviewId:r.id,title:'Bounded procedure',procedure:'Check the exact selected output before delivery.'});f.failBeforeMemory();
  await assert.rejects(f.playbooks.proposeLesson(input,f.owner),/Injected Memory unavailable before commit/);assert.ok(f.current(w).pending);assert.equal(projection(f.store.read()).records.size,0);
  await writeFile(path.join(f.p.workspace,'index.html'),'changed after reservation');await assert.rejects(f.playbooks.proposeLesson(input,f.owner),error('EVIDENCE_STALE'));assert.equal(f.current(w).pending,null);
  const replay=await f.playbooks.proposeLesson(input,f.owner);assert.equal(replay.status,'stale');assert.equal(projection(f.store.read()).records.size,0);
  assert.equal((await f.call('revise',w,{title:w.title,brief,decisions:[]})).briefRevision,2);assert.equal(f.starts,1);
});

test('forgetting an already committed draft before lost-response recovery cannot resurrect memory text or strand the brief',async t=>{
  const f=await fixture(t),w=await f.create(),e=await f.verified(w),r=await f.review(w,e),input=f.input({workflowId:w.id,expectedRevision:f.current(w).revision,reviewId:r.id,title:'Forget this draft',procedure:'Inspect the exact selected file before handoff.'});f.loseNextMemory();await assert.rejects(f.playbooks.proposeLesson(input,f.owner));
  const m=[...projection(f.store.read()).records.values()][0];await f.memory.forget(f.input({scope:m.scope,id:m.id,expectedRevision:m.revision}),f.owner);
  const result=await f.playbooks.proposeLesson(input,f.owner);assert.equal(result.lessonStatus,'unavailable');assert.equal(f.current(w).pending,null);assert.equal(projection(f.store.read()).records.size,0);
  const lesson=f.store.read().events.find(e=>e.type==='playbook.lesson');assert.equal(lesson.payload.procedure,undefined);assert.equal(lesson.request,undefined);assert.equal(typeof lesson.payload.procedureSha256,'string');
  assert.deepEqual(await f.playbooks.proposeLesson(input,f.owner),result);assert.equal(f.store.read().skills.length,0);
});

test('restore fences pending effects and requires a newly reviewed brief; lifecycle methods are never HTTP methods',async t=>{
  const f=await fixture(t),w=await f.create(),input=f.input({workflowId:w.id,expectedRevision:w.revision,definition:f.definition()});f.loseNextMission();await assert.rejects(f.playbooks.materialize(input,f.owner));
  await f.playbooks.suspendForRestore();await assert.rejects(f.playbooks.state({projectId:f.p.id},f.owner),error('RESTORING'));await f.playbooks.afterRestore();f.playbooks.cancelRestore();
  await assert.rejects(f.playbooks.materialize(input,f.owner),error('OUTCOME_UNKNOWN'));assert.equal(f.store.read().plans.length,1);
  await assert.rejects(f.materialize(w),error('OWNER_REVIEW_REQUIRED'));const r=await f.call('revise',w,{title:w.title,brief,decisions:[]});assert.equal(r.restoreReviewRequired,false);assert.equal(r.briefRevision,2);assert.equal(f.starts,0);
});
