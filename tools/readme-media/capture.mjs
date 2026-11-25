// Disposable engineering data only. Never connects to a provider or Owner project.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createApplication} from '../../app/server/main.mjs';
import {entity, changed} from '../../app/server/domain.mjs';
import {validateGoalContext} from '../../app/goals/context.mjs';
import {verifyDeliveryPack} from '../../app/missions/package.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const output=path.resolve(root,'docs/media');
const scratch=path.resolve(root,'tools/readme-media/dist');
await mkdir(scratch,{recursive:true});
const tempRoot=process.platform==='win32'?'C:\\':os.tmpdir();
const session=await mkdtemp(path.join(tempRoot,'FORGE-MEDIA-STATE-'));
// A deliberately public-neutral path: safe to show in the project form/recording.
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim();
const sourceDirty=dirty.split('\n').filter(line=>line&&!/ (docs\/media\/|tools\/readme-media\/|docs\/worker-readme-media\.md|tests\/readme-media[^/]*)/.test(line));
assert.deepEqual(sourceDirty,[],'Capture requires unchanged production source');
const workspace=await mkdtemp(path.join(tempRoot,'FORGE-MEDIA-'));
await mkdir(path.join(output,'sources'),{recursive:true});
await mkdir(path.join(output,'screenshots'),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,browser,page,context,video,baseTime,csrf,project,executor;
let providerStarts=0,prepared=false;
const errors=[],receipts={},shots=[],segments=[];
const exact={exact:true};
const click=name=>page.getByRole('button',{name,...exact}).click();
const fill=(label,value)=>page.getByLabel(label,exact).fill(value);
const state=()=>app.store.read();
async function wait(fn){for(let i=0;i<200;i++){const value=fn(state());if(value)return value;await page.waitForTimeout(100);}throw Error('Expected durable state not observed');}
async function post(route,data){
  const response=await page.request.post(app.url+route,{headers:{'X-Forge-CSRF':csrf},data});
  const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;
}
const command=async(type,projectId,data,record)=>(await post('/api/command',{type,projectId,data,operationId:crypto.randomUUID(),...(record?{id:record.id,expectedRevision:record.revision}:{})})).entity;
async function nav(name){
  const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
  const route=page.getByRole('navigation').getByRole('button',{name,exact:true,includeHidden:true});
  const group=route.locator('xpath=ancestor::details[1]');
  if(await group.count()&&!await group.evaluate(element=>element.open))await group.locator('summary').click();
  await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
}
// Documentation annotations are the ONLY added DOM. No app state is simulated.
// A persistent qualification line travels with every source frame and crop.
async function caption(step,qualification='Local engineering fixture · no provider calls · HOME_UAT_NOT_RUN'){
  await page.evaluate(({step,qualification})=>{
    let bar=document.getElementById('readme-capture-caption');
    if(!bar){bar=document.createElement('aside');bar.id='readme-capture-caption';bar.setAttribute('aria-label','Documentation recording caption');document.body.append(bar);}
    Object.assign(bar.style,{position:'fixed',left:'0',right:'0',bottom:'0',zIndex:'2147483647',background:'#10141b',color:'#f1f5f9',borderTop:'2px solid #68a7ff',padding:'10px 20px',font:'600 20px Manrope, sans-serif',pointerEvents:'none',lineHeight:'1.5'});
    bar.replaceChildren();const title=document.createElement('div');title.textContent=step;
    const note=document.createElement('div');note.textContent=qualification;note.style.cssText='font-size:16px;font-weight:400;color:#bac8da';bar.append(title,note);
  },{step,qualification});
  const shown=(performance.now()-baseTime)/1000;
  await page.waitForTimeout(1600);
  return shown;
}
const providerNote='INJECTED provider observations · no model call · real local files/tests/preview/ZIP · usage unknown';
async function shot(name,alt,qualification){
  await page.evaluate(()=>document.fonts.ready);
  const text=await page.locator('body').innerText();
  for(const privateString of [os.homedir(),os.homedir().replaceAll('\\','/'),'mcp-bearer.secret'])assert.ok(!text.toLowerCase().includes(privateString.toLowerCase()),'Private path appeared in capture '+name);
  const filename='screenshots/'+name+'.png';
  await page.screenshot({path:path.join(output,filename),fullPage:false});
  const source='sources/'+name+'-full.png';
  await page.screenshot({path:path.join(output,source),fullPage:true});
  shots.push({filename,source,alt,caption:alt,qualification,viewport:page.viewportSize(),fullPage:false});
  await page.waitForTimeout(1300);
}
function begin(name,qualification){const segment={name,startSeconds:(performance.now()-baseTime)/1000,qualification,steps:[]};segments.push(segment);return segment;}
async function step(segment,text,qualification=segment.qualification){segment.steps.push(text);const shown=await caption(`${segment.steps.length}. ${text}`,qualification);if(segment.steps.length===1)segment.startSeconds=shown+0.15;}
async function end(segment){await page.waitForTimeout(1000);segment.endSeconds=(performance.now()-baseTime)/1000;}
try{
  app=await createApplication({dataDir:path.join(session,'state'),machineSecretDir:path.join(session,'vault'),port:0});
  receipts.health=(await(await fetch(app.url+'/api/health')).json()).status;
  assert.equal(receipts.health,'ready');
  // Reject every non-loopback browser request, including accidental provider setup.
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,recordVideo:{dir:path.join(session,'video'),size:{width:1440,height:1000}}});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(['data:','blob:','about:'].includes(u.protocol)||['127.0.0.1','localhost','[::1]'].includes(u.hostname))return route.continue();
    throw Error('External browser request prohibited: '+u.origin);
  });
  page=await context.newPage();baseTime=performance.now();video=page.video();page.setDefaultTimeout(25000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('forge.language','en');localStorage.setItem('forge.theme','dark-modern');});
  const sessionResponse=await page.request.get(app.url+'/api/session');csrf=(await sessionResponse.json()).csrf;
  const start=begin('start-forge','Built production App · actual localhost readiness and project creation · launcher/clean install not recorded');
  await page.goto(app.url+'/app');
  await step(start,'Open the ready local app and create a project');
  await click('Create first project');await fill('Project name','README engineering workspace');await fill('Workspace directory',workspace);
  await page.getByRole('dialog').getByRole('button',{name:'Create project',exact:true}).click();
  project=await wait(s=>s.projects[0]);
  await step(start,'Select the saved project and open its workspace');
  await page.getByLabel('Current project',exact).selectOption(project.id);
  await page.getByRole('heading',{name:'Workspace overview',exact:true}).waitFor();
  await shot('overview','FORGE workspace overview after actual local project creation. Disposable engineering records; no provider run.',start.qualification);
  await end(start);
  executor=await command('bot.create',project.id,{name:'Executor · fixture',role:'Inspect the approved engineering task',kind:'resident'});
  await command('bot.create',project.id,{name:'Reviewer · fixture',role:'Review actual evidence',kind:'resident'});
  await nav('Bot team');await caption('Team identities saved in the project');
  await shot('team','Resident Executor and Reviewer identities saved through production HTTP in the engineering project; no model execution.','Actual local bot records; no provider calls');

  // Only provider observations are injected. The source bytes are deterministic
  // engineering inputs, explicitly not model-authored output or a product pilot.
  project=await command('project.update',null,{profile:{...project.profile,provider:{instanceId:'injected-fixture-route',model:'INJECTED observation - no model call',options:[]}}},project);
  await writeFile(path.join(workspace,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><title>FORGE engineering evidence</title><style>body{background:#10141b;color:#eef3fa;font:20px system-ui;padding:48px}p{color:#b5c2d5}small{color:#7dacff}</style><small>DISPOSABLE ENGINEERING FILE</small><h1>Evidence before delivery</h1><p>Real local preview of registered, checksum-verified bytes.</p><p>No model was called. This is not an Owner product.</p></html>');
  await writeFile(path.join(workspace,'output.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('registered engineering page has acceptance text',()=>assert.ok(readFileSync('index.html','utf8').includes('Evidence before delivery')));\n");
  app.t3.startRun=async input=>{
    providerStarts++;
    return app.store.transaction(s=>{validateGoalContext(s,input);const task=s.tasks.find(x=>x.id===input.taskId),run=entity({...input,botId:task.botId,attemptId:crypto.randomUUID(),selection:project.profile.provider,status:'completed',artifactIds:[],qualification:'INJECTED_PROVIDER_OBSERVATION'},project.id);s.runs.push(run);task.runIds.push(run.id);changed(task);return run;});
  };
  app.t3.reconcile=async id=>state().runs.find(r=>r.id===id);
  const mission=begin('software-mission',providerNote);
  await nav('Missions & delivery');
  await step(mission,'Describe the output and measurable acceptance');
  await fill('Mission title','Verify a local engineering page');await fill('Objective and intended user','Qualify the software delivery flow with a deterministic engineering file. No model-authored code.');
  await fill('Deliverable name','Verified engineering page');await fill('Project file, for example index.html','index.html');await fill('Measurable acceptance','The page contains Evidence before delivery');await fill('Test files for the Executor to create (one per line)','output.test.mjs');
  await click('Save & show plan');
  await step(mission,'Review and approve the canonical plan');
  await shot('mission-plan','Mission and canonical plan awaiting Owner approval. Provider completion will be injected; deterministic file and local verification are real.',providerNote);
  await click('Owner: approve this plan');assert.equal(providerStarts,0);
  await click('Resume goal');await click('Start next task');
  await page.locator('select[name="runId"] option').nth(1).waitFor({state:'attached'});
  const run=state().runs[0];receipts.missionRun={id:run.id,taskId:run.taskId,attemptId:run.attemptId,qualification:run.qualification};
  await step(mission,'Inspect the injected run, then register the actual file');
  await page.getByLabel('Completed run',exact).selectOption(run.id);await click('Register file bytes');
  await page.getByLabel('Owner reviewed these files and this command',exact).check();
  await step(mission,'Run the reviewed local Node test and open the real preview');
  await click('Run reviewed tests');await click('Open local preview');
  await page.frameLocator('iframe[title="Mission output preview"]').getByRole('heading',{name:'Evidence before delivery'}).waitFor();
  await page.locator('iframe[title="Mission output preview"]').evaluate(frame=>frame.scrollIntoView({block:'center'}));
  await page.waitForTimeout(700);
  await shot('mission-preview','Registered engineering HTML rendered in the real local preview after an actual passing Node test. Provider run is injected; no model call or usage metric.',providerNote);
  await click('Reconcile existing run');await click('Review run evidence & pass QA');
  await step(mission,'Review QA evidence, accept delivery, and build the ZIP');
  await click('Owner: accept delivery');await click('Build Delivery Pack ZIP');
  const link=page.locator('.mission-pack-list a').first();await link.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
  const zip=await readFile(await download.path());const verified=verifyDeliveryPack(zip);
  assert.equal(verified.manifest.outputs[0].runId,run.id);
  receipts.delivery={sha256:hash(zip),bytes:zip.length,verified:true,outputRunId:run.id};
  receipts.tests=state().events.filter(e=>e.type==='mission.test').map(e=>({id:e.id,status:e.status,outputId:e.outputId,treeCleaned:e.result.treeCleaned,logSha256:e.result.logSha256,log:e.result.log,command:{executable:'node',args:e.result.command.args,maxMs:e.result.command.maxMs},sourceFiles:e.sourceFiles}));
  assert.equal(receipts.tests.at(-1).status,'PASSED');
  await page.getByRole('heading',{name:'Accept & deliver',exact:true}).scrollIntoViewIfNeeded();
  await shot('delivery','Actual accepted Delivery Pack download with checksums after local tests and QA. Provider execution observation is injected; source is a deterministic engineering file.',providerNote);
  await click('Stop preview');await end(mission);
  await nav('Plan & tasks');await caption('The Mission uses these canonical Plan tasks',providerNote);
  await shot('plan','Canonical Plan view for the actual engineering Mission task. Provider observation is injected; no live model run.',providerNote);
  const dependencyPlan=await command('plan.create',project.id,{name:'Engineering dependency review',description:'Saved task dependencies only; these tasks are not executed.'});
  const prerequisite=await command('task.create',project.id,{planId:dependencyPlan.id,title:'Inspect verified output bytes',status:'backlog',botId:executor.id});
  const dependent=await command('task.create',project.id,{planId:dependencyPlan.id,title:'Review publication notes after inspection',status:'backlog',dependsOn:[prerequisite.id]});
  await page.getByLabel('Plan',exact).selectOption(dependencyPlan.id);
  await caption('Canonical dependency graph · saved tasks only; no execution');
  await shot('dependencies','Actual persisted canonical task dependency graph. Both engineering tasks remain in backlog; no execution or provider call is claimed.','Real local task/dependency records; not executed');
  assert.deepEqual(state().tasks.find(t=>t.id===dependent.id).dependsOn,[prerequisite.id]);
  receipts.dependencies={planId:dependencyPlan.id,prerequisiteTaskId:prerequisite.id,dependentTaskId:dependent.id,executed:false};

  // Exercise CPU before introducing an uncertain writer observation. This keeps
  // the real production workspace fence intact throughout the graph capture.
  await command('notebook.create',project.id,{name:'Local CPU evidence',code:"print('Actual local CPU execution: 2 + 3 =', 2 + 3)",language:'python'});
  await nav('Compute targets');await click('Start new job');await page.getByLabel('Actual job logs',exact).filter({hasText:'Actual local CPU execution: 2 + 3 = 5'}).waitFor();assert.equal(state().jobs.at(-1).status,'completed');
  await caption('Compute · actual local Python job and observed output');await shot('compute','Compute view after actual local CPU notebook execution; observed Python output is 2 + 3 = 5. No cloud resources or provider calls.','Real local Python compute only; remote/cloud targets NOT_RUN');
  receipts.compute={jobId:state().jobs.at(-1).id,status:state().jobs.at(-1).status,outputVerified:true};

  const room=await command('conversation.create',project.id,{name:'Evidence review · fixture',kind:'team'});
  const note=await post('/api/artifacts/upload',{operationId:crypto.randomUUID(),projectId:project.id,name:'engineering-notes.txt',kind:'file',base64:Buffer.from('Disposable engineering evidence. No provider called.').toString('base64')});
  let graphRun;
  await app.store.transaction(s=>{
    graphRun=entity({kind:'conversation',conversationId:room.id,botId:executor.id,attemptId:crypto.randomUUID(),operationId:crypto.randomUUID(),status:'unknown',qualification:'INJECTED_PROVIDER_OBSERVATION',selection:{instanceId:'fixture',model:'INJECTED observation - no model call',options:[]},connection:{status:'disconnected'},toolObservations:{read:{id:'fixture-read-source',name:'read source · fixture',status:'completed',argumentsComplete:true,resultObserved:false}},messages:[],artifactIds:[note.id]},project.id);s.runs.push(graphRun);
  });
  const graphNote='INJECTED agent/run/tool observations · no model call · tool outcome unconfirmed · actual canonical IDs';
  const graph=begin('chat-workspace',graphNote);
  await nav('Conversations');await page.getByRole('button',{name:/Evidence review · fixture/}).click();
  await step(graph,'Select a team room and keep a local draft');await fill('Message','Inspect the recorded evidence before continuing.');
  await shot('chat','Group Chat with an unsent engineering draft. Run/tool observations injected for the following graph; no provider message sent.',graphNote);
  await click('Workspace');await page.getByRole('region',{name:'Visualization Workspace',exact:true}).waitFor();
  await step(graph,'Switch to Workspace and inspect the selected Executor run');
  await page.getByRole('button',{name:/Called agent · Executor/}).click();
  await click('Fit readable');
  await shot('workspace','Node–Edge Workspace and selected Executor details, using actual canonical fixture run/bot/attempt IDs. Agent and tool observations injected, no live model call; tool result unconfirmed.',graphNote);
  await page.getByRole('button',{name:'Read recovery snapshot',exact:true}).scrollIntoViewIfNeeded();
  await shot('run-evidence','Selected Executor evidence and existing run controls with actual canonical run/attempt identity. Provider/agent observations are injected; no model called and no Stop or approval action is claimed.',graphNote);
  await step(graph,'Read the persisted recovery snapshot without replaying execution');
  await click('Read recovery snapshot');await page.getByText('Persisted recovery snapshot',exact).waitFor();
  await page.getByText('Persisted recovery snapshot',exact).scrollIntoViewIfNeeded();
  receipts.recovery={runId:graphRun.id,readOnlySnapshotObserved:true};
  await shot('recovery','Actual read-only recovery snapshot for the injected canonical fixture run. No provider called and no effects replayed.',graphNote);
  await step(graph,'Inspect the tool whose result remains unconfirmed');
  await page.getByRole('button',{name:/Tool · read source · fixture/}).click();
  await page.getByText('Tool call observed; its result has not been confirmed.',exact).waitFor();
  await page.getByText('Tool call observed; its result has not been confirmed.',exact).scrollIntoViewIfNeeded();
  await shot('tool-evidence','Selected fixture tool identity with outcome unconfirmed. Agent/run/tool observations are injected; no provider call or successful tool result is claimed.',graphNote);
  await step(graph,'Return to Chat with the draft preserved');await click('Chat');assert.equal(await page.getByLabel('Message',exact).inputValue(),'Inspect the recorded evidence before continuing.');await end(graph);
  receipts.graph={runId:graphRun.id,attemptId:graphRun.attemptId,botId:executor.id,toolId:'fixture-read-source',toolResultObserved:false,draftPreserved:true};
  await click('Workspace');await page.setViewportSize({width:390,height:900});
  await click('Show list');
  await page.locator('.agent-node-list').scrollIntoViewIfNeeded();
  await caption('Mobile Workspace · same canonical engineering records',graphNote);
  await shot('workspace-mobile','390px mobile Workspace linear inspection list, the accessible alternative to the graph, using the same canonical engineering records. All provider/agent/tool observations injected; no live model call.',graphNote);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.setViewportSize({width:1440,height:1000});

  const officeNote='Actual Univer edit/save/reopen + native report engines · manually requested bounded edits · no model call';
  const office=begin('office-report',officeNote);
  await nav('Docs & sheets');
  const documents=[];
  for(const [kind,name,text] of [['sheet','Engineering workbook','Check\tResult\nLocal test\tPassed'],['doc','Engineering notes','Evidence before delivery. This native document was saved and reopened locally.']]){
    await step(office,`Create ${kind==='sheet'?'a workbook':'a document'} and enter a bounded native edit`);
    await click('+ Create document');await fill('Document name',name);await page.getByLabel('Kind',exact).selectOption(kind);await click('Create & open');
    await page.locator('.univer-container canvas').first().waitFor();
    await click('Bounded agent edit');await page.getByLabel('Actor bot',exact).selectOption(executor.id);
    if(kind==='sheet')await fill('Cell range (up to 1000 cells)','A1:B2');
    await fill(kind==='sheet'?'Values / formulas: tab-separated columns, newline-separated rows':'Text to insert in the paragraph',text);
    await click('Apply & save');
    let doc=await wait(s=>s.documents.find(d=>d.name===name&&d.revision===2));
    if(kind==='sheet')assert.equal(doc.snapshot.sheets.sheet1.cellData[1][1].v,'Passed');else assert.equal(doc.snapshot.body.dataStream,text+'\r\n');
    await step(office,`Reopen the saved ${kind==='sheet'?'workbook':'document'} revision`);
    await click('Reopen latest revision');await page.locator('.univer-container canvas').first().waitFor();await page.waitForTimeout(900);
    await page.evaluate(()=>window.scrollTo(0,0));
    await shot(kind==='sheet'?'sheets':'docs',`Actual mounted Univer ${kind} with readable engineering content after bounded Facade edit, durable save, and reopen. The edit was manually requested; no model called.`,officeNote);
    documents.push(doc);receipts[kind]={documentId:doc.id,revision:doc.revision,snapshotSha256:hash(JSON.stringify(doc.snapshot)),savedTextVerified:true,reopened:true};
  }
  const engineRoot=process.env.FORGE_MEDIA_REPORT_ENGINES??path.join(process.env.LOCALAPPDATA??'','FORGE','report-engine-research');
  const wordcraft=path.join(engineRoot,'wordcraft-0.18.1','wordcraft-0.18.1-windows-x64-portable','wordcraft-cli.exe');
  const pdfcraft=path.join(engineRoot,'pdfcraft-0.22.0','pdfcraft-0.22.0-windows-x64-portable','pdfcraft-cli.exe');
  const enginesExist=await Promise.all([wordcraft,pdfcraft].map(p=>stat(p).then(()=>true,()=>false)));
  if(enginesExist.every(Boolean)){
    // Real local setup, same input as shipped GUI; private paths never enter video.
    const health=await post('/api/reports/configure',{wordcraft:{path:wordcraft},pdfcraft:{path:pdfcraft},fonts:[{family:'Tahoma',version:'Windows font hashes',paths:[path.join(process.env.WINDIR,'Fonts','tahoma.ttf'),path.join(process.env.WINDIR,'Fonts','tahomabd.ttf')],license:'local system font; not redistributed'}]});
    assert.equal(health.ready,true);
    await nav('Report Studio');
    await step(office,'Save a ReportSpec from the actual saved Sheets range');
    await fill('Source name','Engineering report source');await fill('Report title','FORGE local verification');await fill('Heading','Evidence before delivery');await fill('Text','Generated locally from a saved, versioned ReportSpec. No external account or model call.');
    await page.getByText('Import from Docs or a Sheets range',exact).click();
    await page.getByLabel('Source document',exact).selectOption(documents[0].id);await fill('Import range','A1:B2');await page.getByLabel('Report formulas',exact).selectOption('cached-values');await click('Preview import');await click('Add this content to report source');
    await click('Save report source');await wait(s=>s.reports.length===1);
    await step(office,'Generate real DOCX and PDF with the qualified native engines');await click('Generate DOCX & PDF');
    const job=await wait(s=>s.jobs.find(j=>j.owner==='reports'&&['ready','failed','unknown'].includes(j.status)));assert.equal(job.status,'ready',JSON.stringify(job.error));
    await shot('report-studio','Actual native WordCraft DOCX/PDF report generation from saved ReportSpec and imported Univer sheet revision. No external account or provider call.',officeNote);
    await step(office,'Preview the rendered PDF and verify both downloadable files');
    await page.getByRole('button',{name:'Preview PDF',exact:true}).first().click();
    const rendered=page.getByRole('dialog').getByRole('img',{name:'Rendered report page'});await rendered.waitFor();await rendered.evaluate(img=>img.decode());assert.ok(await rendered.evaluate(img=>img.naturalWidth>0));
    await shot('report-preview','Decoded native PDF page preview of the actual locally generated report, with the saved Sheets table. No provider call.',officeNote);
    const reportArtifacts=state().artifacts.filter(a=>a.jobId===job.id);
    receipts.report={jobId:job.id,status:job.status,sourceRevision:job.frozenSource?.revision,outputs:[]};
    for(const artifact of reportArtifacts){const response=await page.request.get(app.url+`/api/artifacts/${artifact.id}/download`);assert.ok(response.ok());const bytes=await response.body();assert.equal(hash(bytes),artifact.sha256);if(artifact.kind==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');if(artifact.kind==='docx')assert.equal(bytes.subarray(0,2).toString(),'PK');receipts.report.outputs.push({kind:artifact.kind,bytes:bytes.length,sha256:hash(bytes)});}
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  }else receipts.report={status:'NOT_RUN',gap:'Qualified pinned native report engines unavailable; no simulated report screenshot produced.'};
  await end(office);

  await nav('Memory Studio');await click('Central Owner memory');await fill('Owner title','Engineering review preference');await fill('Owner content','Use only explicitly granted memory revisions and inspect real evidence before delivery.');await click('Save privately');await page.getByText('Not shared with any project.',exact).waitFor();
  await page.getByLabel('Share with project',exact).selectOption(project.id);await click('Share this revision with selected project');
  await wait(s=>s.events.some(e=>e.type==='owner-memory.grant'&&e.status==='active'));
  await caption('Central Owner memory · explicit grant to the named engineering project');
  await shot('owner-memory','Central Owner source memory after actual private save and explicit grant to the named engineering project. No automatic cross-project read and no model call.','Actual local central memory + explicit named-project grant; disposable engineering content');
  receipts.memory={privateBeforeGrant:true,explicitGrantEvent:state().events.find(e=>e.type==='owner-memory.grant'&&e.status==='active')?.id};
  await nav('Artifacts');await caption('Artifacts · verified bytes from the actual local workflow');
  await shot('artifacts','Actual artifact catalog containing uploaded engineering notes and real native report outputs. No cloud storage or model execution.','Actual local artifacts and verified download hashes; external storage NOT_RUN');
  await nav('Overview');await page.setViewportSize({width:390,height:900});await caption('Mobile overview · actual saved project records',providerNote);
  await shot('overview-mobile','390px mobile workspace overview of actual saved engineering project records. Run observations injected; no model call or usage metrics.',providerNote);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(providerStarts,1);assert.deepEqual(errors,[]);
  receipts.provider={calls:0,injectedStartObservations:providerStarts,usage:'UNKNOWN'};
  const port=app.server.address().port;await app.close();app=await createApplication({dataDir:path.join(session,'state'),machineSecretDir:path.join(session,'vault'),port});
  for(const doc of documents)assert.equal(state().documents.find(x=>x.id===doc.id).revision,doc.revision);
  receipts.restart={actualServiceCloseReopen:true,savedOfficeRevisionsVerified:true};
  await context.close();context=null;
  await video.saveAs(path.join(output,'sources','walkthroughs.webm'));
  const build={mode:'production',command:'npm.cmd run build',package:JSON.parse(await readFile('package.json','utf8')).version,vite:'7.3.8',lockfileSha256:hash(await readFile('package-lock.json')),indexHtmlSha256:hash(await readFile('app/web/dist/index.html'))};
  const manifest={status:'PREPARED_MEDIA_NOT_FINAL_RELEASE_VERIFICATION',preparedRevision:revision,capturedAt:new Date().toISOString(),sourceDirty:sourceDirty.length>0,documentationChangesPresent:!!dirty,platform:process.platform,architecture:process.arch,node:process.version,browser:{name:'Chromium',version:browser.version()},theme:'Dark Modern',fonts:['Manrope','IBM Plex Sans Thai'],model:{id:'gpt-6.1-sol',effort:'xhigh',source:'inherited T3 Codex harness runtime_info; no model switching or product model invocation'},tools:['existing lockfile Playwright 1.65.1','production Vite build','real SQLite/HTTP/browser session/CSRF','existing ffmpeg','existing Pillow'],command:'npm.cmd run build && node tools/readme-media/capture.mjs && python tools/readme-media/render.py && python tools/readme-media/verify.py',providerCalls:0,homeUat:'HOME_UAT_NOT_RUN',liveAccounts:'NOT_RUN',nativeGuardedAutomation:'NOT_QUALIFIED; actual native supervisor not qualified',limitations:['Engineering fixture; not Owner product data or a pilot.','Provider/agent/run/tool observations injected only where labelled. Mission source files are predetermined engineering input, not model-authored code.','No fake usage, latency, cost, or model success is displayed. Unknown remains unknown.','Capture annotations add numbered instructions and qualification only; original App UI/state is otherwise unchanged.','Engine configuration uses local authenticated HTTP; private executable paths never enter video.','Start clip covers ready App/project creation, not Windows launcher or clean installation.','Browser fixture interactions do not qualify macOS, mobile relay, live providers, remote compute or Owner home UAT.'],screenshots:shots,walkthroughs:segments.map(s=>({...s,source:'sources/walkthroughs.webm',filename:s.name+'.gif',alt:s.steps.join(' → ')+'. '+s.qualification,editing:'Real Chromium recording; selected contiguous interval, 2x speed, 5 fps, 1008px width. No frame interpolation. Gaps between walkthrough intervals omitted.'})),receipts,browserErrors:errors};
  manifest.build=build;
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  prepared=true;
  console.log(JSON.stringify({result:'PREPARED',revision,screenshots:shots.length,walkthroughs:segments.length,providerCalls:0}));
}catch(error){await page?.screenshot({path:path.join(scratch,'failure.png'),fullPage:true}).catch(()=>{});console.error('Capture failed; private diagnostic is retained under tools/readme-media/dist.');throw error;}
finally{
  await context?.close().catch(()=>{});await browser?.close();await app?.close();
  // Delete only the exact disposable workspace made by this invocation.
  assert.ok(path.basename(workspace).startsWith('FORGE-MEDIA-'));
  await rm(workspace,{recursive:true,force:true});
  assert.equal(path.dirname(session),path.resolve(tempRoot));
  assert.ok(path.basename(session).startsWith('FORGE-MEDIA-STATE-'));
  await rm(session,{recursive:true,force:true});
  if(prepared){const file=path.join(output,'manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));manifest.receipts.cleanup={browserClosed:!browser.isConnected(),applicationServerClosed:!app.server.listening,exactDisposableWorkspaceRemoved:true,privateStateVaultVideoTempRemoved:true,previewStopped:true};await writeFile(file,JSON.stringify(manifest,null,2)+'\n');}
}
