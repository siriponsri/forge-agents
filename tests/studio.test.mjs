// AI Product Studio stateless helpers + disposable SQLite Workflow Presets →
// Mission fixture. Injected T3 stub only; no live provider or model claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {entity} from '../app/server/domain.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';
import {createGoalService} from '../app/goals/index.mjs';
import {createMissionService} from '../app/missions/index.mjs';
import {definition as missionDefinition,relative} from '../app/missions/contracts.mjs';
import {createPlaybookService} from '../app/playbooks/index.mjs';
import {brief as briefContract,decisions as decisionsContract} from '../app/playbooks/contracts.mjs';
import {getPreset} from '../app/playbooks/presets.mjs';
import {QUESTION_TREE,MAX_DECISIONS,frontier,openQuestions,settle,prune,decisionsFromBrief,glossaryFor,taskSpecFrom,inferFromPrompt,valuesOf} from '../app/studio/question-tree.mjs';
import {draftBrief,briefDecisions,missionDefinitionFrom,outputKey,briefTitle,STUDIO_PRESET_ID,isStudioBrief} from '../app/studio/brief.mjs';
import {discoverFacts} from '../app/studio/facts.mjs';
import {roundRequest,briefRequest,extractJson,validateProviderRound,validateProviderBrief,replyFor} from '../app/studio/provider.mjs';
import {defineTrainerBackend,createTrainerRegistry,defaultTrainerRegistry} from '../app/studio/backends.mjs';
import {readSyntheticCsv,syntheticHousePrices} from '../app/studio/fixtures/synthetic.mjs';
const code=c=>e=>e.code===c;
const tabularFacts={provider:{connected:false},compute:{kind:'local'},files:{counts:{tabular:1,images:0,text:0,documents:0,audio:0},examples:{tabular:[{name:'synthetic-house-prices.csv',bytes:1}]}}};
function acceptAll(prompt,facts,choose={}){
  let d={},rounds=0;
  for(let q=frontier(d,facts,prompt);q.length;q=frontier(d,facts,prompt)){
    if(++rounds>12)throw new Error('Interview did not converge');
    for(const x of q)d[x.id]=settle(x,choose[x.id]&&x.options.some(o=>o.value===choose[x.id])?{value:choose[x.id]}:{accept:true});
  }
  return {decisions:d,rounds};
}

test('each round asks the whole frontier with recommended answers; discoverable facts are never asked',()=>{
  const prompt='ทำนายราคาบ้านจากไฟล์ CSV ยอดขายบ้านในอดีต';
  const r1=frontier({},tabularFacts,prompt);
  assert.deepEqual(r1.map(q=>q.id),['task_type']);
  assert.equal(r1[0].recommended.value,'regression');assert.match(r1[0].prompt.th,/ใช่ไหม$/);assert.match(r1[0].prompt.en,/\?$/);
  const d={task_type:settle(r1[0],{accept:true})};
  const r2=frontier(d,tabularFacts,prompt);
  assert.deepEqual(r2.map(q=>q.id),['modality','success_metric','deployment_form']);
  assert.equal(r2.find(q=>q.id==='modality').recommended.value,'tabular');
  for(const q of r2)d[q.id]=settle(q,{accept:true});
  const r3=frontier(d,tabularFacts,prompt),source=r3.find(q=>q.id==='data_source');
  assert.equal(source.recommended.value,'workspace');assert.match(source.why.en,/Found 1 matching/);
  for(const q of [...r1,...r2,...r3]){assert.ok(q.options.some(o=>o.value===q.recommended.value));assert.ok(q.topic.th&&q.topic.en);}
  const ids=QUESTION_TREE.map(n=>n.id);for(const fact of ['rows','columns','row_count','provider','file_count'])assert.ok(!ids.includes(fact));
});

test('every relevant path converges within the 12-decision brief limit',()=>{
  const choices=id=>QUESTION_TREE.find(n=>n.id===id).options.map(o=>o.value);
  let paths=0;
  for(const task of choices('task_type'))for(const modality of choices('modality'))for(const compute of choices('compute_target'))for(const source of choices('data_source')){
    const {decisions}=acceptAll('x',tabularFacts,{task_type:task,modality,compute_target:compute,data_source:source});paths++;
    assert.ok(Object.keys(decisions).length<=MAX_DECISIONS,`${task}/${modality}/${compute}/${source}: ${Object.keys(decisions).length}`);
    assert.equal(openQuestions(decisions).length,0,'no relevant question was cut by the cap');
    assert.ok(decisionsContract(briefDecisions(decisions,'th')));
  }
  assert.equal(paths,8*6*5*4);
});

test('prompt inference, overrides, pruning, glossary and task spec stay deterministic',()=>{
  assert.equal(inferFromPrompt('chatbot ตอบคำถามลูกค้าภาษาไทย').taskType,'generation');
  assert.equal(inferFromPrompt('detect cracks in photos').modality,'images');
  assert.equal(inferFromPrompt('พยากรณ์ยอดขายเดือนหน้า').taskType,'forecasting');
  assert.equal(inferFromPrompt('something vague').inferredTask,false);
  const q=frontier({},null,'x')[0];
  assert.deepEqual(settle(q,{text:'  ทำนายว่าลูกค้าจะยกเลิกไหม '}),{value:'custom',text:'ทำนายว่าลูกค้าจะยกเลิกไหม',label:{th:'ทำนายว่าลูกค้าจะยกเลิกไหม',en:'ทำนายว่าลูกค้าจะยกเลิกไหม'},source:'override',topic:q.topic});
  assert.throws(()=>settle(q,{value:'not-an-option'}));assert.throws(()=>settle(q,{text:'   '}));
  const {decisions}=acceptAll('ทำนายราคาบ้านจากไฟล์ CSV',tabularFacts,{compute_target:'cloud_gpu'});
  assert.equal(valuesOf(decisions).budget,'up_to_5');
  const changed={...decisions,compute_target:{...decisions.compute_target,value:'local_cpu'}};
  const pruned=prune(changed);assert.ok(!('budget' in pruned)&&!('data_upload' in pruned));assert.ok('evaluation' in pruned);
  const g=glossaryFor(decisions);assert.ok(g.some(x=>x.key==='holdout'&&x.term.th==='ข้อมูลชุดวัดผล'&&x.avoid.en.includes('test data')));
  assert.deepEqual(taskSpecFrom(decisions).taskType,'regression');assert.equal(taskSpecFrom(pruned).budget,'zero');
});

test('brief and Mission drafts satisfy the real Workflow Presets and Mission contracts; paths stay confined',()=>{
  const prompt='ทำนายราคาบ้านจากไฟล์ CSV';const {decisions}=acceptAll(prompt,tabularFacts);
  const backends=defaultTrainerRegistry().compatible(taskSpecFrom(decisions));
  for(const lang of ['th','en']){
    const b=briefContract(draftBrief({prompt,decisions,facts:tabularFacts,lang,backends,comments:['เพิ่มกราฟ']})),saved=decisionsContract(briefDecisions(decisions,lang));
    assert.match(b.interfacesDependencies,lang==='th'?/ยังไม่เปิดใช้ในรุ่นนี้/:/not enabled in this build/);
    assert.match(b.risksDecisions,lang==='th'?/ความเห็นของคุณ: เพิ่มกราฟ/:/Your comment: เพิ่มกราฟ/);
    const def=missionDefinition(missionDefinitionFrom({title:briefTitle(prompt),brief:b,decisions:saved,workflowId:'0f5e2c1a-1111-2222',lang}));
    assert.equal(def.objective,b.objective);assert.deepEqual(def.decisions,saved);assert.deepEqual(def.outputs.map(o=>o.key),['data','train','evaluate','deploy']);
    for(const o of def.outputs){assert.equal(relative(o.path),o.path);assert.match(o.path,/^studio\/0f5e2c1a1111\//);}
    assert.deepEqual(decisionsFromBrief(saved),Object.fromEntries(Object.entries(decisions).map(([k,v])=>[k,{...v,source:'saved'}])));
  }
  assert.equal(outputKey('../../.git/x'),'gitx');assert.equal(outputKey('..'),'product');
  assert.throws(()=>relative('studio/../.env'),code('PATH_SCOPE'));assert.throws(()=>relative('C:/Windows/x'),code('PATH_SCOPE'));assert.throws(()=>relative('studio/node_modules/x'),code('PATH_SCOPE'));
  assert.ok(getPreset(STUDIO_PRESET_ID));assert.equal(isStudioBrief({decisions:briefDecisions(decisions)}),true);
});

test('facts come from canonical state only and never from secrets',()=>{
  const p={id:'p1',profile:{provider:{connectionId:'c1',model:'m'},compute:{kind:'colab'}}};
  const state={projects:[p],connections:[{id:'c1',projectId:'p1',name:'Codex',enabled:true}],artifacts:[{projectId:'p1',status:'verified',name:'a.CSV',bytes:3},{projectId:'p1',status:'verified',name:'x.png',bytes:3},{projectId:'p2',status:'verified',name:'b.csv'},{projectId:'p1',status:'pending',name:'c.csv'}]};
  const f=discoverFacts(state,'p1');
  assert.deepEqual(f.provider,{connected:true,name:'Codex',model:'m'});assert.equal(f.compute.kind,'colab');assert.equal(f.files.counts.tabular,1);assert.equal(f.files.counts.images,1);
  assert.equal(discoverFacts(state,'missing'),null);assert.equal(discoverFacts({...state,connections:[]},'p1').provider.connected,false);
});

test('provider output is bounded and validated; nothing is trusted as free JSON',()=>{
  const settledDecisions={task_type:{value:'regression',label:{th:'ก',en:'a'},topic:{th:'ประเภทงาน',en:'Task type'}}};
  const text=roundRequest({prompt:'ทำนายราคา',facts:tabularFacts,decisions:settledDecisions,seed:frontier(settledDecisions,tabularFacts,'ทำนายราคา'),round:2});
  assert.match(text,/WHOLE current frontier/);assert.match(text,/"yes" accepts/);assert.match(text,/modality/);
  assert.match(briefRequest({prompt:'x',brief:{objective:'o'},comment:'เพิ่ม',decisions:settledDecisions}),/"brief"/);
  const good={done:false,questions:[{id:'compute_target',topic:{th:'เครื่องประมวลผล',en:'Compute'},prompt:{th:'เทรนบน Colab ใช่ไหม',en:'Train on Colab?'},options:[{value:'colab',label:{th:'Colab',en:'Colab'}},{value:'local_cpu',label:{th:'เครื่องนี้',en:'This computer'}}],recommended:'colab'}]};
  const parsed=validateProviderRound(extractJson('ok\n```json\n'+JSON.stringify(good)+'\n```'),{settled:settledDecisions});
  assert.equal(parsed.questions[0].recommended.value,'colab');assert.equal(parsed.questions[0].source,'provider');
  for(const bad of [
    {done:false,questions:[]},
    {questions:[{...good.questions[0],recommended:'gpu'}]},
    {questions:[{...good.questions[0],id:'task_type'}]},
    {questions:[{...good.questions[0],id:'Bad Id'}]},
    {questions:Array.from({length:9},(_,i)=>({...good.questions[0],id:`q${i}`}))},
    {questions:[{...good.questions[0],prompt:{th:'x\u0001',en:'y'}}]},
  ])assert.throws(()=>validateProviderRound(bad,{settled:settledDecisions}),code('PROVIDER_OUTPUT'));
  assert.throws(()=>extractJson('no json here'),code('PROVIDER_OUTPUT'));
  const full=Object.fromEntries(Array.from({length:MAX_DECISIONS},(_,i)=>[`d${i}`,{value:'x'}]));assert.equal(validateProviderRound(good,{settled:full}).done,true);
  assert.deepEqual(Object.keys(validateProviderBrief({brief:{objective:'a',inputsScope:'b',acceptance:'c',interfacesDependencies:'d',risksDecisions:'e'}})).length,5);
  assert.throws(()=>validateProviderBrief({brief:{objective:'a',evil:'x'}}),code('PROVIDER_OUTPUT'));
  const room={messages:[{role:'assistant',runId:'r1',text:'{"done":true}'},{role:'assistant',runId:'r0',text:'old'}]};
  assert.deepEqual(replyFor(room,{id:'r1',status:'completed'}),{status:'ready',text:'{"done":true}'});
  assert.equal(replyFor(room,{id:'r1',status:'running'}).status,'waiting');assert.equal(replyFor(room,{id:'r2',status:'completed'}).status,'failed');assert.equal(replyFor(room,{id:'r1',status:'failed',error:{message:'x'}}).status,'failed');
});

test('trainer backends are descriptors; the quick baseline is declared, not wired',()=>{
  const reg=defaultTrainerRegistry();
  assert.deepEqual(reg.compatible({taskType:'regression',modality:'tabular',compute:'local_cpu'}),[{id:'local-quick-baseline',label:reg.list()[0].label,status:'declared',supported:true}]);
  assert.equal(reg.compatible({taskType:'generation',modality:'text'})[0].supported,false);
  assert.throws(()=>reg.get('local-quick-baseline').run({}),code('TRAINER_PENDING'));assert.throws(()=>reg.get('nope'),code('TRAINER_NOT_FOUND'));
  assert.throws(()=>defineTrainerBackend({id:'x'}),TypeError);
  const b={id:'vision-lora',label:{th:'ก',en:'a'},supports:()=>{throw new Error('x');},plan:()=>({}),run:()=>{},artifacts:()=>[]};
  assert.throws(()=>createTrainerRegistry([b,b]),TypeError);assert.equal(createTrainerRegistry([b]).compatible({})[0].supported,false);
});

test('synthetic sample dataset is seeded, labelled and reproducible',async()=>{
  const a=syntheticHousePrices({rows:50,seed:7}),b=syntheticHousePrices({rows:50,seed:7}),c=syntheticHousePrices({rows:50,seed:8});
  assert.equal(a,b);assert.notEqual(a,c);assert.match(a.split('\n')[0],/^area_sqm,bedrooms,age_years,district,price_thb$/);
  const committed=await readFile(new URL('../app/studio/fixtures/synthetic-house-prices.csv',import.meta.url),'utf8');
  assert.equal(committed,await readSyntheticCsv());assert.equal(committed.trim().split('\n').length,201);
});

test('Studio brief → Workflow Presets → unapproved Mission → Owner approval through missions.approve',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-studio-engineering-')),store=await openStore(dir),workspace=path.join(dir,'workspace');await mkdir(workspace);
  const p=entity({name:'Disposable Studio fixture',workspace,profile:{provider:{instanceId:'engineering-provider',model:'injected-engineering-model'},compute:{kind:'local'},limits:{concurrency:1}}});
  await store.transaction(s=>{s.projects.push(p);});
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+3600000});
  const t3={goalContextVersion:1,async startRun(){throw new Error('Studio fixture never starts work');},async reconcile(){},async stop(){}};
  const goals=createGoalService({store,t3,authorize:authority.goalAuthorize}),missions=createMissionService({store,goals,t3,artifacts:createArtifactService({store,dataDir:dir}),authorize:authority.goalAuthorize});
  const playbooks=createPlaybookService({store,missions,authorize:authority.goalAuthorize});
  t.after(async()=>{await playbooks.close();await missions.close();await goals.close();await store.close();await rm(dir,{recursive:true,force:true});});
  const input=extra=>({projectId:p.id,operationId:crypto.randomUUID(),...extra});
  const prompt='ทำนายราคาบ้านจากไฟล์ CSV',facts=discoverFacts(store.read(),p.id);
  // Round 1 answered → brief created; later rounds → brief revised. Same records the GUI writes.
  let d={};const r1=frontier(d,facts,prompt);for(const q of r1)d[q.id]=settle(q,{accept:true});
  let w=await playbooks.create(input({presetId:STUDIO_PRESET_ID,title:briefTitle(prompt),brief:draftBrief({prompt,decisions:d,facts}),decisions:briefDecisions(d)}),owner);
  for(let q=frontier(d,facts,prompt);q.length;q=frontier(d,facts,prompt)){for(const x of q)d[x.id]=settle(x,{accept:true});const cur=store.read().events.find(e=>e.id===w.id);
    w=await playbooks.revise(input({workflowId:w.id,expectedRevision:cur.revision,title:briefTitle(prompt),brief:draftBrief({prompt,decisions:d,facts}),decisions:briefDecisions(d)}),owner);}
  const s=store.read(),cur=s.events.find(e=>e.id===w.id),b=s.events.find(e=>e.id===cur.briefId);
  assert.ok(isStudioBrief(b));assert.deepEqual(valuesOf(decisionsFromBrief(b.decisions)),valuesOf(d));
  await assert.rejects(playbooks.revise(input({workflowId:w.id,expectedRevision:cur.revision-1,title:'x',brief:b.brief,decisions:b.decisions}),owner),code('REVISION_CONFLICT'));
  const m=await playbooks.materialize(input({workflowId:w.id,expectedRevision:cur.revision,definition:missionDefinitionFrom({title:b.title,brief:b.brief,decisions:b.decisions,workflowId:w.id})}),owner);
  let mission=store.read().events.find(e=>e.id===m.missionId);const plan=store.read().plans.find(x=>x.id===m.planId);
  assert.equal(mission.status,'draft');assert.equal(plan.approved,false);assert.equal(Object.keys(mission.taskIds).length,4);
  await assert.rejects(missions.approve(input({missionId:mission.id,expectedRevision:mission.revision}),null),code('HUMAN_REVIEW_REQUIRED'));
  await missions.approve(input({missionId:mission.id,expectedRevision:mission.revision}),owner);
  mission=store.read().events.find(e=>e.id===m.missionId);
  assert.equal(mission.status,'approved');assert.equal(store.read().plans.find(x=>x.id===m.planId).approved,true);
  assert.equal(store.read().events.filter(e=>e.type.startsWith('studio.')).length,0,'Studio adds no planning records of its own');
});
