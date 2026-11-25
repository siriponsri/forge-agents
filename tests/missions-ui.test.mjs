// Real React interaction against real Mission/Goals services in disposable
// SQLite. A Playwright route supplies the host mounting seam; no live provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../app/server/store.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {entity} from '../app/server/domain.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';
import {createGoalService} from '../app/goals/index.mjs';
import {createMissionService,dispatchMissionRequest} from '../app/missions/index.mjs';

test('TH/EN no-code Mission form persists decisions and canonical plan, approves without starting, and clears project drafts',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-mission-ui-engineering-')),store=await openStore(dir),workspace=path.join(dir,'workspace');await mkdir(workspace);
  const p=entity({name:'Disposable UI engineering fixture',workspace,profile:{}}),bot=entity({name:'Fixture Executor',kind:'resident'},p.id);await store.transaction(s=>{s.projects.push(p);s.bots.push(bot);});
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+3600000});let starts=0;
  const goals=createGoalService({store,t3:{startRun(){starts++;throw Error('Execution not requested by this UI test');}},authorize:authority.goalAuthorize}),missions=createMissionService({store,goals,artifacts:createArtifactService({store,dataDir:dir}),authorize:authority.goalAuthorize});
  const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await missions.close();await goals.close();await store.close();await rm(dir,{recursive:true,force:true});});
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Missions from './app/web/src/Missions.jsx';let state,language='en',projectId;const root=createRoot(document.getElementById('app'));window.renderMission=async function(project,lang){projectId=project;language=lang;state=await (await fetch('/engineering-state')).json();root.render(<Missions t={(th,en)=>language==='th'?th:en} state={state} projectId={projectId} busy={false} run={async fn=>{try{const result=await fn();await window.renderMission(projectId,language);return result;}catch(e){window.lastMissionError=e.message;throw e;}}}/>);};`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},logLevel:'silent'});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));page.setDefaultTimeout(10000);
  await page.route('http://127.0.0.1:31897/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/engineering-state'){await route.fulfill({json:store.read()});return;}
    if(url.pathname.startsWith('/api/missions/')){try{const result=await dispatchMissionRequest(missions,url.pathname.split('/').at(-1),req.postDataJSON(),owner);await route.fulfill({json:result});}catch(e){await route.fulfill({status:e.statusCode??400,json:{error:{code:e.code,message:e.message}}});}return;}
    if(url.pathname==='/api/session'){await route.fulfill({json:{csrf:'fixture-csrf'}});return;}
    await route.fulfill({contentType:'text/html',body:'<html><body><div id="app"></div></body></html>'});
  });
  await page.goto('http://127.0.0.1:31897/');
  const css=(await readFile('app/web/src/style.css','utf8')).replace("@import './themes.css';",await readFile('app/web/src/themes.css','utf8'))+'\n'+await readFile('app/web/src/mission-workspace.css','utf8');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(({id})=>window.renderMission(id,'en'),{id:p.id});
  await page.waitForFunction(()=>document.querySelector('input')||document.querySelector('#app')?.textContent).catch(()=>{});assert.deepEqual(browserErrors,[]);
  await page.getByLabel('Mission title',{exact:true}).fill('Disposable software mission');await page.getByLabel('Objective and intended user').fill('Show a readable engineering HTML page');await page.getByLabel('Deliverable name').fill('HTML page');await page.getByLabel('Project file, for example index.html').fill('index.html');await page.getByLabel('Measurable acceptance').fill('Page title equals the agreed title');await page.getByLabel('Test files for the Executor to create (one per line)').fill('page.test.mjs');
  await page.getByRole('button',{name:'Add an unresolved decision'}).click();await page.getByLabel('Decision question').fill('What language should the page use?');await page.getByLabel('Selected answer (blank while unresolved)').fill('English');await page.getByRole('button',{name:'Save & show plan'}).click();
  await page.getByRole('heading',{name:'Plan to review'}).waitFor();assert.equal(store.read().plans.length,1);assert.equal(store.read().tasks.length,1);assert.equal(store.read().plans[0].approved,false);assert.equal(starts,0);assert.equal(store.read().events.find(e=>e.type==='mission.definition').definition.decisions[0].answer,'English');
  await page.getByRole('button',{name:'Owner: approve this plan'}).click();await page.getByRole('button',{name:'Resume goal',exact:true}).waitFor();assert.equal(store.read().plans[0].approved,true);assert.equal(starts,0);
  if(process.env.FORGE_MISSION_CAPTURE_DIR){await mkdir(process.env.FORGE_MISSION_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FORGE_MISSION_CAPTURE_DIR,'missions-en-1280.png'),fullPage:true});}
  // Narrow-screen Thai form and project-switch privacy use the shipped styles.
  await page.getByRole('button',{name:'New mission',exact:true}).click();await page.getByLabel('Mission title',{exact:true}).fill('Private draft from previous project');
  const q=entity({name:'Another engineering workspace',workspace:path.join(dir,'other'),profile:{}});await mkdir(q.workspace);await store.transaction(s=>s.projects.push(q));
  await page.setViewportSize({width:375,height:1000});await page.evaluate(({id})=>window.renderMission(id,'th'),{id:q.id});await page.getByLabel('ชื่อภารกิจ',{exact:true}).waitFor();assert.equal(await page.getByLabel('ชื่อภารกิจ',{exact:true}).inputValue(),'');assert.equal(await page.getByText('Disposable software mission',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  if(process.env.FORGE_MISSION_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.FORGE_MISSION_CAPTURE_DIR,'missions-th-375.png'),fullPage:true});
  for(const width of [320,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);}
});
