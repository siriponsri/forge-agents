// Built App over production HTTP/SQLite. Actual local tests, preview and ZIP;
// only provider execution observations are injected, with usage left unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';
import {command,entity,changed} from '../app/server/domain.mjs';
import {validateGoalContext} from '../app/goals/context.mjs';
import {verifyDeliveryPack} from '../app/missions/package.mjs';

test('built App Mission journey uses real Owner forms, local tests, preview, QA and ZIP; new surfaces work at desktop and Thai mobile',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'forge-completion-ui-')),app=await createApplication({dataDir:path.join(directory,'state')});
  let browser;t.after(async()=>{await browser?.close();await app.close();});
  const project=(await command(app.store,{operationId:crypto.randomUUID(),type:'project.create',data:{name:'Integrated engineering qualification',workspace:path.join(directory,'workspace'),profile:{provider:{instanceId:'injected-fixture-route',model:'injected-observation',options:[]}}}})).entity;
  let starts=0;
  app.t3.startRun=async input=>{
    starts++;await writeFile(path.join(project.workspace,'index.html'),'<!doctype html><title>Verified FORGE fixture</title><h1>Evidence before delivery</h1>');
    await writeFile(path.join(project.workspace,'output.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('recorded output',()=>assert.ok(readFileSync('index.html','utf8').includes('Evidence before delivery')));");
    return app.store.transaction(s=>{validateGoalContext(s,input);const task=s.tasks.find(x=>x.id===input.taskId),r=entity({...input,botId:task.botId,attemptId:crypto.randomUUID(),selection:project.profile.provider,status:'completed',artifactIds:[],qualification:'INJECTED_PROVIDER_OBSERVATION'},project.id);s.runs.push(r);task.runIds.push(r.id);changed(task);return r;});
  };
  app.t3.reconcile=async id=>app.store.read().runs.find(r=>r.id===id);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const nav=async name=>{
    const navigation=page.locator('.sidebar nav');
    if(!await navigation.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();
    const route=navigation.getByRole('button',{name,exact:true,includeHidden:true});
    const group=route.locator('xpath=ancestor::details[1]');
    if(await group.count() && !await group.evaluate(element=>element.open))await group.locator('summary').click();
    await route.click();
  };
  await page.addInitScript(({projectId})=>{if(window!==window.top)return;localStorage.setItem('forge.language','en');localStorage.setItem('forge.theme','dark-modern');localStorage.setItem('forge.project',projectId);},{projectId:project.id});
  await page.goto(app.url);await nav('Missions & delivery');
  await page.getByLabel('Mission title',{exact:true}).fill('From brief to verified delivery');
  await page.getByLabel('Objective and intended user').fill('A readable static engineering page with executable acceptance');
  await page.getByLabel('Deliverable name').fill('Verified page');
  await page.getByLabel('Project file, for example index.html').fill('index.html');
  await page.getByLabel('Measurable acceptance').fill('The page contains Evidence before delivery');
  await page.getByLabel('Test files for the Executor to create (one per line)').fill('output.test.mjs');
  await page.getByRole('button',{name:'Save & show plan',exact:true}).click();
  await page.getByRole('button',{name:'Owner: approve this plan',exact:true}).click();assert.equal(starts,0);
  await page.getByRole('button',{name:'Resume goal',exact:true}).click();
  await page.getByRole('button',{name:'Start next task',exact:true}).click();
  await page.locator('select[name="runId"] option').nth(1).waitFor({state:'attached'});
  const runId=app.store.read().runs[0].id;await page.getByLabel('Completed run',{exact:true}).selectOption(runId);
  await page.getByRole('button',{name:'Register file bytes',exact:true}).click();
  await page.getByLabel('Owner reviewed these files and this command',{exact:true}).check();
  await page.getByRole('button',{name:'Run reviewed tests',exact:true}).click();
  await page.getByRole('button',{name:'Open local preview',exact:true}).click();
  await page.frameLocator('iframe[title="Mission output preview"]').getByRole('heading',{name:'Evidence before delivery'}).waitFor();
  await page.getByRole('button',{name:'Reconcile existing run',exact:true}).click();
  await page.getByRole('button',{name:'Review run evidence & pass QA',exact:true}).click();
  await page.getByRole('button',{name:'Owner: accept delivery',exact:true}).click();
  await page.getByRole('button',{name:'Build Delivery Pack ZIP',exact:true}).click();
  const downloadLink=page.locator('.mission-pack-list a').first();await downloadLink.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),downloadLink.click()]);
  const bytes=await readFile(await download.path());assert.equal(verifyDeliveryPack(bytes).manifest.outputs[0].runId,runId);assert.equal(starts,1);
  const captureDir=path.join(directory,'captures');await mkdir(captureDir);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(captureDir,'missions-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop preview',exact:true}).click();
  for(const [navigation,title,file] of [['Parallel workspaces','Parallel workspaces','parallel'],['Proactive workflows','Proactive workflows','proactive'],['Usage & budgets','Budgets & usage','budgets'],['Workflow presets','Workflow presets','workflows'],['Research Lab','Research Lab','research']]){
    await nav(navigation);await page.getByRole('heading',{name:title,exact:true}).waitFor();
    if(navigation==='Parallel workspaces'){await page.getByLabel('Maximum parallel attempts').fill('2');await page.getByRole('button',{name:'Save limits',exact:true}).click();}
    await page.screenshot({path:path.join(captureDir,file+'-desktop.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.getByLabel('Language',{exact:true}).selectOption('th');await page.setViewportSize({width:375,height:900});
  for(const [label,title,file] of [['ภารกิจและการส่งมอบ','ภารกิจและชุดส่งมอบ','missions'],['พื้นที่งานแยก','พื้นที่ทำงานคู่ขนาน','parallel'],['เวิร์กโฟลว์อัตโนมัติ','งานเชิงรุก','proactive'],['การใช้งานและงบ','งบประมาณและการใช้งาน','budgets'],['รูปแบบการทำงาน','รูปแบบการทำงาน','workflows'],['ห้องวิจัยและประเมินผล','ห้องวิจัยและประเมินผล','research']]){
    await nav(label);await page.getByRole('heading',{name:title,exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,file+' overflow');
    await page.screenshot({path:path.join(captureDir,file+'-mobile.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(directory,'evidence.json'),JSON.stringify({qualification:'PRODUCTION_APP_SQLITE_LOCAL_TESTS_PREVIEW_ZIP_INJECTED_PROVIDER_OBSERVATIONS',providerTurns:0,starts,errors,captures:12,platform:process.platform},null,2));
  console.log('FORGE completion UI evidence:',directory);
});
