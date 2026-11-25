// Production application/HTTP/recipe/T3/Context/AG-UI integration. The model
// protocol and schedule due time alone are injected; native executors are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';
import {digest,source} from '../app/providers/common.mjs';
import {bytesDigest} from '../app/guarded-runtime/profile.mjs';

const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-guarded-timeout30s-20261125');
test('production Guarded setup drives one approved recipe through actual native tools and AG-UI',{timeout:300000,skip:!existsSync(path.join(cache,'artifact-manifest.json'))&&'compiled native package unavailable'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-product-')),workspace=path.join(dir,'workspace');await mkdir(path.join(workspace,'allowed'),{recursive:true});await writeFile(path.join(workspace,'allowed/a.txt'),'before');
  let requests=0;const requestBodies=[];
  const model=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requestBodies.push(body);requests++;
    const calls=[['forge_guarded_read_text',{path:'allowed/a.txt'}],['forge_guarded_propose_change',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}],['forge_guarded_edit_text',{path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'after'}]],step=calls[body.messages.filter(m=>m.role==='tool').length];
    const delta=step?{role:'assistant',tool_calls:[{index:0,id:'fixture-'+requests,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{role:'assistant',content:'Bounded fixture completed.'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const chunk of [{delta,finish_reason:null},{delta:{},finish_reason:step?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,...chunk}]})+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{model.closeAllConnections();model.close(r);}));
  const app=await createApplication({dataDir:path.join(dir,'data'),machineSecretDir:path.join(dir,'machine'),guardedArtifactOptions:{approvedCache:cache}});t.after(()=>app.close());
  const envName='FORGE_GUARDED_TEST_'+crypto.randomUUID().replaceAll('-','');process.env[envName]='FIXTURE_NOT_A_REAL_ACCOUNT';t.after(()=>delete process.env[envName]);
  const p=entity({name:'Guarded production fixture',workspace,profile:{}}),plan=entity({name:'Reviewed bounded text plan',approved:true},p.id),bot=entity({name:'Bounded text editor',kind:'resident',status:'active'},p.id),task=entity({title:'Read and revise the approved existing text file',description:'Only allowed/a.txt; never use shell or other paths.',planId:plan.id,botId:bot.id,status:'ready',runIds:[],dependsOn:[]},p.id);
  const c=entity({name:'Local deterministic chat fixture',kind:'provider',enabled:true,providerInstanceId:'forge_guarded_fixture',config:{routeId:'custom-api',accountRoute:'machine-env-api-key',generation:1,envRefs:[envName],apiKeyEnv:envName,setupStatus:'configured'},lastCheck:{version:'2.4.1'}},p.id);
  c.providerCatalog={providerInstanceId:c.providerInstanceId,identityKey:digest([c.providerInstanceId,1,c.config.routeId,c.config.accountRoute,source]),models:[{id:'forge/fixture-model',options:[]}],catalogComplete:true,stale:false,observedAt:Date.now()};p.profile.provider={instanceId:c.providerInstanceId,connectionId:c.id,connectionGeneration:1,model:'forge/fixture-model',options:[]};
  await app.store.transaction(s=>{s.projects.push(p);s.plans.push(plan);s.bots.push(bot);s.tasks.push(task);s.connections.push(c);});
  const configDir=path.join(dir,'data/providers',c.providerInstanceId,'config/opencode');await mkdir(configDir,{recursive:true});await writeFile(path.join(configDir,'opencode.json'),JSON.stringify({providers:{forge:{package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:`{env:${envName}}`},models:{'fixture-model':{modelID:'fixture-model'}}}}}));
  const sessionResponse=await fetch(app.url+'/api/session'),session=await sessionResponse.json(),cookie=sessionResponse.headers.get('set-cookie').split(';')[0];
  const post=async(route,input)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':session.csrf},body:JSON.stringify(input)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  // Materialize the same default native capabilities that project.create does.
  // The deliberately absent task fails before any execution reservation/effect.
  await assert.rejects(app.t3.startRun({projectId:p.id,taskId:crypto.randomUUID(),operationId:crypto.randomUUID()}));assert.equal(app.store.read().runs.length,0);
  const denied=await fetch(app.url+'/api/guarded/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id})});assert.equal(denied.status,403);
  let setup=await post('/api/guarded/install',{projectId:p.id,operationId:crypto.randomUUID()});
  for(let i=0;setup.installation.status==='preparing'&&i<200;i++){await new Promise(r=>setTimeout(r,100));setup=await post('/api/guarded/state',{projectId:p.id});}
  assert.equal(setup.installation.status,'ready',JSON.stringify(setup));assert.equal(requests,0);assert.equal(setup.readiness,null);
  setup=await post('/api/guarded/check',{projectId:p.id,operationId:crypto.randomUUID()});assert.equal(setup.readiness.providerTurns,0);assert.equal(setup.readiness.negativeCount,17);assert.equal(requests,0);
  const definition={projectId:p.id,operationId:crypto.randomUUID(),name:'Owner accepted bounded text recipe',instructions:'Read, propose and update only the selected existing file.',planId:plan.id,taskIds:[task.id],trigger:{kind:'schedule',timezone:'UTC',localTime:'12:00',weekdays:[0,1,2,3,4,5,6],maxLatenessMs:60000},identity:{connectionIds:[c.id]},scope:{paths:['allowed'],capabilities:['read','propose','workspace.write']},budget:{maxRuns:1,maxRunMs:240000,maxTokens:null,maxCost:null,currency:null},expiresAt:Date.now()+3600000};
  let recipe=await post('/api/proactive/create',definition);
  for(const action of ['approve','enable'])recipe=await post('/api/proactive/'+action,{projectId:p.id,recipeId:recipe.id,expectedRevision:recipe.revision,operationId:crypto.randomUUID()});
  // Controlled due time only. The production scheduler owns the claim/context,
  // admission and dispatch; no fixture callback grants enforcement authority.
  await app.store.transaction(s=>{s.events.find(e=>e.id===recipe.id).nextDue={at:Date.now(),key:'2000-01-01T12:00'};});await app.proactive.tick();
  const until=Date.now()+180000;while(Date.now()<until&&!app.store.read().runs[0]?.terminalEvent){const s=app.store.read();if(s.runs[0]?.status==='failed'||!s.runs.length&&s.events.some(e=>e.type==='proactive.inbox'))break;await new Promise(r=>setTimeout(r,100));}
  const state=app.store.read(),run=state.runs[0];assert.ok(run,JSON.stringify(state.events.filter(e=>e.type==='proactive.inbox')));assert.equal(run.status,'completed',JSON.stringify({error:run.error,dispatch:run.guardedDispatch,projection:run.guardedProjection}));
  assert.equal(state.runs.length,1);assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');assert.equal(requests,4);assert.equal(state.receipts.filter(r=>r.type==='guarded.file-receipt').length,3);
  assert.equal(state.events.some(e=>e.type==='agui'&&e.runId===run.id&&e.event.type==='TOOL_CALL_RESULT'),true);assert.equal(state.events.some(e=>e.type==='agui'&&e.runId===run.id&&e.event.type==='RUN_FINISHED'),true);
  assert.equal(run.guardedProjection.turnItems.some(i=>i.status==='failed'),false,'bounded tool responses must acknowledge the same completed effects, not time out after them');
  const tools=Object.values(run.toolObservations),events=state.events.filter(e=>e.type==='agui'&&e.runId===run.id).map(e=>e.event);
  assert.equal(tools.length,3,'read, proposal and actual native file change remain visible');
  const change=tools.find(i=>i.observationKind==='file_change');assert.equal(change.path,'allowed/a.txt');assert.equal(change.resultObserved,false);
  assert.equal(events.some(e=>e.type==='TOOL_CALL_RESULT'&&e.toolCallId===change.id),false,'a file change is not an invented tool-role result');
  const argumentEvents=events.filter(e=>e.type==='TOOL_CALL_ARGS');assert.equal(argumentEvents.length,2);
  for(const event of argumentEvents)assert.equal(JSON.parse(event.delta).path,'allowed/a.txt','actual native arguments replace preliminary empty inputs');
  assert.equal(run.nativeTurnRef.strength,'weak');assert.equal(run.providerRunId,undefined);assert.equal(state.tasks.find(t=>t.id===task.id).status,'review');assert.ok(run.contextReceipt);assert.ok(run.guardedReceipt);assert.equal(JSON.stringify(state).includes('FIXTURE_NOT_A_REAL_ACCOUNT'),false);
  const replay=await app.t3.startRun({projectId:p.id,taskId:task.id,conversationId:null,operationId:run.operationId,proactiveContext:run.proactiveContext});assert.equal(replay.id,run.id);assert.equal(requests,4);
  t.diagnostic(JSON.stringify({directory:dir,nativeProtocolRequests:requests,externalProviderRequests:0,aguiTools:Object.keys(run.toolObservations??{}).length}));
});
