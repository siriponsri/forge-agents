// Actual product HTTP/T3/Context/native executors. Only the model protocol and
// provider catalog/account observations are deterministic engineering fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';
import {digest,source} from '../app/providers/common.mjs';
import {bytesDigest} from '../app/guarded-runtime/profile.mjs';
import {defaultResearchConfig} from '../app/research/index.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-frontend-generation-VD6puQ');
const researchOnly=process.env.FORGE_NATIVE_ROUTE_PURPOSE==='research';
const cohort=process.env.FORGE_NATIVE_COHORT==='1';
// Explicit qualification job: the last assembled run completed frontend, then
// failed Research native attestation with zero model egress. See the checkpoint
// handoff. Do not mistake an opt-in skip for qualification of that integration.
test('production supervised result and Research use their exact native purposes and canonical owners',{timeout:cohort?1200000:480000,skip:process.env.FORGE_RUN_PRIVATE_ROUTES_NATIVE!=='1'?'opt-in qualification with actual private native executors':!existsSync(path.join(cache,'generation.json'))&&'compiled unified package unavailable'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-product-private-routes-')),workspace=path.join(dir,'source');await mkdir(workspace);await writeFile(path.join(workspace,'README.md'),'Disposable engineering fixture\n');
  const git=args=>execFileSync('git',args,{cwd:workspace,windowsHide:true,encoding:'utf8'});
  git(['init','--quiet']);git(['add','README.md']);git(['-c','user.name=FORGE fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Disposable base']);
  let mode=researchOnly?'research':'frontend',requests=0;const bodies=[];let documentId;
  const model=createServer(async(req,res)=>{
    try{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);bodies.push({mode,body});requests++;
      const tools=body.messages.filter(m=>m.role==='tool');let call;
      if(!tools.length&&mode==='frontend')call={name:'forge_frontend_selection_read',arguments:{documentId,expectedRevision:1}};
      if(!tools.length&&mode==='research'){
        const text=body.messages.map(m=>typeof m.content==='string'?m.content:'').join('\n'),match=text.match(/FORGE RESEARCH BENCHMARK DATA[^\n]*\n(.*?)\nEND BENCHMARK DATA/s),component=text.match(/<benchmark-input[^>]*>(.*?)<\/benchmark-input>/s);assert.ok(match||component,'actual prepared benchmark reached the model');
        const rows=match?JSON.parse(match[1]).rows:JSON.parse(component[1]),totals=new Map();for(const row of rows)totals.set(row.key,(totals.get(row.key)??0)+row.value);
        const role=cohort?app.store.read().runs.at(-1).researchComponentContext.role:null;
        if(cohort){assert.ok(text.includes('REVIEWED_NATIVE_TABLE_SKILL'));assert.ok(text.includes('Aggregate immutable research input memory'));}
        call={name:'forge_guarded_edit_text',arguments:{path:'output.json',expectedRevision:bytesDigest(''),text:JSON.stringify(role==='primary'?[]:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({key,total})))}};
      }
      const delta=call?{role:'assistant',tool_calls:[{index:0,id:`actual-${mode}-${requests}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:'Engineering fixture complete.'};
      res.writeHead(200,{'Content-Type':'text/event-stream'});for(const chunk of [{delta,finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,...chunk}]})+'\n\n');res.end('data: [DONE]\n\n');
    }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{model.closeAllConnections();model.close(r);}));
  const app=await createApplication({dataDir:path.join(dir,'data'),machineSecretDir:path.join(dir,'machine'),guardedArtifactOptions:{approvedCache:cache}});t.after(()=>app.close());
  // Transparent test diagnostics: preserve the real writer, return value,
  // rollback and error. Record codes only; never prompt/credential contents.
  const transactionFailures=[],transaction=app.store.transaction.bind(app.store);
  app.store.transaction=fn=>transaction(fn).catch(error=>{transactionFailures.push(error.code??error.name);throw error;});
  const envName='FORGE_PRIVATE_FIXTURE_'+crypto.randomUUID().replaceAll('-','');process.env[envName]='INJECTED_NOT_LIVE';t.after(()=>delete process.env[envName]);
  const p=entity({name:'Native route product qualification',workspace,profile:{}}),plan=entity({name:'Approved engineering plan',approved:true},p.id),bot=entity({name:'Fixture agent',kind:'resident',status:'active'},p.id);
  const tasks=['Read the saved selection','Aggregate the immutable research input',...(cohort?['Check the immutable research input','Revise the immutable research input']:[])].map(title=>entity({title,description:'Only the explicitly bounded native purpose.',planId:plan.id,botId:bot.id,status:'ready',runIds:[],dependsOn:[],artifactIds:[],evidence:[]},p.id));
  const skill=entity({name:'Reviewed native table skill',version:'1',requires:['t3.run'],instructions:'REVIEWED_NATIVE_TABLE_SKILL: group by key and sum values; retain sorted JSON.',status:'active'},p.id);
  const doc=entity({name:'Saved selection fixture',kind:'doc',packageVersion:'1.6.1',snapshot:{id:'saved-doc',body:{dataStream:'hello\r\n',paragraphs:[{startIndex:0}],sectionBreaks:[{startIndex:6}]},documentStyle:{pageSize:{width:794,height:1123}},resources:[]}},p.id);documentId=doc.id;
  const c=entity({name:'Deterministic local protocol',kind:'provider',enabled:true,providerInstanceId:'forge_private_fixture',config:{routeId:'custom-api',accountRoute:'machine-env-api-key',generation:1,envRefs:[envName],apiKeyEnv:envName,setupStatus:'configured'},lastCheck:{version:'2.4.1',providerInstanceId:'forge_private_fixture',installed:true,enabled:true,authentication:'authenticated',status:'ready',checkedAt:Date.now()}},p.id);
  c.providerCatalog={providerInstanceId:c.providerInstanceId,identityKey:digest([c.providerInstanceId,1,c.config.routeId,c.config.accountRoute,source]),models:[{id:'forge/fixture-model',options:[]}],catalogComplete:true,stale:false,canRunChildTask:true,runtimeModes:['approval-required'],omittedModels:0,observedAt:Date.now()};p.profile.provider={instanceId:c.providerInstanceId,connectionId:c.id,connectionGeneration:1,model:'forge/fixture-model',options:[]};
  await app.store.transaction(s=>{s.projects.push(p);s.plans.push(plan);s.bots.push(bot);s.tasks.push(...tasks);s.documents.push(doc);s.connections.push(c);if(cohort)s.skills.push(skill);});
  // Catalog/account observations alone are injected. Native turn execution,
  // action mediation, receipts and independent validators remain actual.
  if(cohort)app.t3.catalog=async()=>({providers:[{providerInstanceId:c.providerInstanceId,models:[{id:'forge/fixture-model',options:[]}],canRunChildTask:true,runtimeModes:['approval-required'],catalogComplete:true,omittedModels:0}]});
  const configDir=path.join(dir,'data/providers',c.providerInstanceId,'config/opencode');await mkdir(configDir,{recursive:true});await writeFile(path.join(configDir,'opencode.json'),JSON.stringify({providers:{forge:{package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:`{env:${envName}}`},models:{'fixture-model':{modelID:'fixture-model'}}}}}));
  const response=await fetch(app.url+'/api/session'),session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const post=async(route,input)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':session.csrf},body:JSON.stringify(input)}),value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  const until=async fn=>{const end=Date.now()+240000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Native product fixture timed out: '+JSON.stringify(app.store.read().runs.map(r=>({status:r.status,error:r.error,dispatch:r.guardedDispatch}))));};
  await assert.rejects(app.t3.startRun({projectId:p.id,taskId:crypto.randomUUID(),operationId:crypto.randomUUID()}));
  let setup=await post('/api/guarded/install',{projectId:p.id,operationId:crypto.randomUUID()});await until(async()=>{setup=await post('/api/guarded/state',{projectId:p.id});assert.notEqual(setup.installation.status,'failed',JSON.stringify(setup));return setup.installation.status==='ready';});
  await post('/api/guarded/check',{projectId:p.id,operationId:crypto.randomUUID(),...(cohort?{leaseMs:900000}:{})});assert.equal(requests,0);
  let frontendRun;
  if(!researchOnly){
  const intent=await post('/api/frontend-tools/intent',{projectId:p.id,taskId:tasks[0].id,documentId:doc.id,documentRevision:1,operationId:crypto.randomUUID()});
  const starting=post('/api/frontend-tools/start',{projectId:p.id,intentId:intent.intentId,operationId:intent.operationId});starting.catch(()=>{});
  const pending=await until(async()=>{const r=app.store.read().runs.find(r=>r.frontendContext);if(!r)return null;if(['failed','unknown'].includes(r.status))throw Error(JSON.stringify(r));const result=await post('/api/frontend-tools/pending',{projectId:p.id,runId:r.id,attemptId:r.attemptId});return result.calls.find(c=>c.status==='pending')?{run:r,call:result.calls.find(c=>c.status==='pending')}:null;});
  await post('/api/frontend-tools/result',{projectId:p.id,runId:pending.run.id,attemptId:pending.run.attemptId,pendingId:pending.call.pendingId,operationId:crypto.randomUUID(),result:{status:'ok',documentId:doc.id,revision:1,selection:{start:0,end:5,text:'hello'}}});await starting;
  frontendRun=await until(()=>{const r=app.store.read().runs.find(r=>r.id===pending.run.id);return r.terminalEvent?r:null;});assert.equal(frontendRun.status,'completed',frontendRun.error);assert.equal(frontendRun.guardedContext.profile.purpose,'supervised-frontend-v1');
  assert.ok(bodies.filter(x=>x.mode==='frontend').some(x=>x.body.messages.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes('hello'))));
  }
  mode='research';
  if(cohort){
    await post('/api/context/policy',{projectId:p.id,operationId:crypto.randomUUID(),route:{providerId:c.providerInstanceId,modelId:'forge/fixture-model'},budget:{contextWindow:100000,outputReserve:1000,safetyReserve:100},source:{kind:'fixture',reference:'Deterministic loopback; no external account',observedAt:new Date().toISOString()}});
    await post('/api/memory/remember',{projectId:p.id,scope:{projectId:p.id,kind:'project',id:p.id},operationId:crypto.randomUUID(),memoryType:'semantic',title:'Immutable research input',content:'Aggregate the immutable research input. Check the immutable research input. Revise the immutable research input. Aggregate immutable research input memory: sum values per key and sort the output.'});
  }
  await post('/api/workspaces/configure',{projectId:p.id,operationId:crypto.randomUUID(),expectedRevision:0,maxConcurrent:cohort?3:1,providerLimit:cohort?3:1,checks:['diff']});
  const w=await post('/api/workspaces/create',{projectId:p.id,taskId:tasks[1].id,expectedTaskRevision:tasks[1].revision,operationId:crypto.randomUUID()});
  const config={...defaultResearchConfig(),execution:'agent',repetitions:1,policies:[cohort?'evidence-guided':'static'],ablations:[{name:'bounded-native',components:{memory:cohort,skills:cohort,adaptation:cohort,staffing:cohort,verification:cohort}}],limits:{...defaultResearchConfig().limits,maxMs:cohort?900000:300000,maxBytes:65536,maxSteps:cohort?16:8,maxAgents:cohort?3:1,unknownAccounting:'allow'}};
  const e=await post('/api/research/create',{projectId:p.id,operationId:crypto.randomUUID(),config}),trial=await post('/api/research/reserve',{projectId:p.id,operationId:crypto.randomUUID(),experimentId:e.id,repetition:0,policyIndex:0,ablationIndex:0,workspaceId:w.id,taskId:w.taskId});
  if(cohort){
    const slots=[{workspaceId:w.id,role:'primary',skillIds:[skill.id]}];
    for(let i=2;i<4;i++){const child=await post('/api/workspaces/create',{projectId:p.id,taskId:tasks[i].id,expectedTaskRevision:tasks[i].revision,operationId:crypto.randomUUID()});slots.push({workspaceId:child.id,role:i===2?'helper':'revision',skillIds:[skill.id]});}
    let result=await post('/api/research-components/run',{projectId:p.id,trialId:trial.id,slots,maxCommands:24});
    for(let n=0;n<3&&result.data.status!=='PASSED';n++){
      await until(()=>{const r=app.store.read().runs.at(-1);if(r&&['failed','unknown'].includes(r.status))throw Error(JSON.stringify({status:r.status,error:r.error,transactionFailures}));return r?.terminalEvent?r:null;});
      result=await post('/api/research-components/run',{projectId:p.id,trialId:trial.id,compositionId:result.data.compositionId,maxCommands:24});
    }
    assert.equal(result.data.status,'PASSED',JSON.stringify({result,transactionFailures}));
    const runs=app.store.read().runs.filter(r=>r.researchComponentContext);assert.deepEqual(runs.map(r=>r.researchComponentContext.role),['primary','helper','revision']);
    assert.ok(runs.every(r=>r.contextMode==='forge-prefix'&&r.researchReceipt&&r.researchComponentReceipt));
    assert.equal(app.store.read().receipts.filter(r=>r.type==='guarded.file-receipt').length,3);
    assert.equal(app.store.read().events.find(t=>t.id===trial.id).status,'PASSED');
    assert.equal(result.data.usage.cost,null);assert.equal(result.data.usage.tokens,null);
    t.diagnostic(JSON.stringify({directory:dir,nativeProtocolRequests:requests,externalProviderRequests:0,cohortRuns:runs.map(r=>r.id),actualComponentConsumption:true}));return;
  }
  const executed=await post('/api/research/execute',{projectId:p.id,trialId:trial.id,expectedRevision:trial.revision,operationId:crypto.randomUUID()});assert.notEqual(executed.status,'reconcile-required',JSON.stringify(executed));
  const nativeResearch=await until(()=>{const r=app.store.read().runs.find(r=>r.researchContext);if(r&&['failed','unknown'].includes(r.status))throw Error(JSON.stringify(r));return r?.terminalEvent?r:null;});assert.equal(nativeResearch.status,'completed',nativeResearch.error);
  const current=app.store.read().events.find(t=>t.id===trial.id),reconciled=await post('/api/research/reconcile',{projectId:p.id,trialId:trial.id,expectedRevision:current.revision,operationId:crypto.randomUUID()});assert.equal(reconciled.status,'awaiting-validation',JSON.stringify(reconciled));
  const verified=await post('/api/research/validate',{projectId:p.id,trialId:trial.id,expectedRevision:reconciled.revision,operationId:crypto.randomUUID()});assert.equal(verified.status,'PASSED',JSON.stringify({trialStatus:verified.status,transactionFailures,evidence:app.store.read().events.filter(e=>e.type==='research.evidence').map(e=>({status:e.status,checks:e.checks}))}));
  assert.equal(nativeResearch.guardedContext.profile.purpose,undefined);assert.equal(app.store.read().runs.length,researchOnly?1:2);assert.equal(app.store.read().receipts.filter(r=>r.type==='guarded.file-receipt').length,1);assert.ok((await readFile(path.join(w.worktreePath,'output.json'),'utf8')).startsWith('['));
  t.diagnostic(JSON.stringify({directory:dir,nativeProtocolRequests:requests,externalProviderRequests:0,frontendRun:frontendRun?.id??null,researchRun:nativeResearch.id}));
});
