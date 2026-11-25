// Real React events against the real SQLite budget service. Playwright routes
// stand in for lead-owned HTTP mounting, NOT a live/native provider receipt feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {dispatchBudgetRequest} from '../app/budgets/index.mjs';
import {fixture,usd} from './budgets-fixture.test.mjs';

test('actual TH/EN BudgetStudio saves exact Owner money, reports unknowns, fences stale drafts and resets project scope',async t=>{
  const f=await fixture(t),r=await f.start();
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import BudgetStudio from './app/web/src/BudgetStudio.jsx';const root=createRoot(document.getElementById('app'));window.renderBudget=async function(projectId,language='en'){const state=await (await fetch('/engineering-state')).json();root.render(<BudgetStudio t={(th,en)=>language==='th'?th:en} projectId={projectId} state={state} busy={false} run={async fn=>{try{return await fn();}catch{return null;}}}/>);};`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},logLevel:'silent'});
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],writes=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:31917/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/engineering-state'){await route.fulfill({json:f.store.read()});return;}
    if(url.pathname==='/api/session'){await route.fulfill({json:{csrf:'engineering-fixture-session'}});return;}
    if(url.pathname.startsWith('/api/budgets/')){
      const method=url.pathname.split('/').at(-1),input=req.postDataJSON();if(method!=='state')writes.push(input);
      try{await route.fulfill({json:await dispatchBudgetRequest(f.service,method,input,f.owner)});}catch(e){await route.fulfill({status:e.statusCode??400,json:{error:{code:e.code,message:e.message}}});}return;
    }
    await route.fulfill({contentType:'text/html',body:'<html data-theme="dark-modern"><meta charset="utf-8"><body style="margin:0"><div id="app" style="padding:16px"></div></body></html>'});
  });
  await page.goto('http://127.0.0.1:31917/');
  const css=(await readFile('app/web/src/style.css','utf8')).replace("@import './themes.css';",await readFile('app/web/src/themes.css','utf8'))+'\n'+await readFile('app/web/src/budgets.css','utf8');
  await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(id=>window.renderBudget(id),f.projectId);
  await page.getByRole('heading',{name:'Budgets & usage',exact:true}).waitFor();await page.getByLabel('Reported spending stop threshold').waitFor();
  assert.equal(await page.getByRole('row').filter({hasText:r.id}).getByText('Unknown',{exact:true}).count()>=1,true);assert.equal(writes.length,0);
  await page.getByLabel('Budget enforcement').selectOption('true');await page.getByLabel('When pricing is unknown').selectOption('allow');await page.getByLabel('Reported spending stop threshold').fill('1.00');await page.getByLabel('Capacity reserved per start').fill('0.20');
  await page.getByRole('button',{name:'Save policy',exact:true}).click();await page.waitForFunction(()=>document.querySelector('legend')?.textContent.includes('Revision 1'));
  assert.deepEqual(writes[0].limit,usd(100));assert.deepEqual(writes[0].reserve,usd(20));assert.equal(writes[0].expectedRevision,0);assert.equal(f.store.read().runs.length,1,'saving never starts another turn');
  await f.service.observe(f.observation(r,{cost:usd(40)}));await page.getByRole('button',{name:'Refresh report'}).click();await page.getByRole('row').filter({hasText:r.id}).getByText('USD 0.40',{exact:true}).waitFor();
  await f.configure({limit:usd(200),reserve:usd(20)});await page.getByRole('button',{name:'Refresh report'}).click();await page.getByRole('alert').filter({hasText:'Policy changed'}).waitFor();
  await page.getByLabel('Reported spending stop threshold').fill('1.50');await page.getByRole('button',{name:'Save policy',exact:true}).click();await page.getByRole('alert').filter({hasText:'REVISION_CONFLICT'}).waitFor();assert.equal((await f.state()).policies[0].limit.minorUnits,200);
  await page.getByRole('button',{name:'Load current policy'}).click();assert.equal(await page.getByLabel('Reported spending stop threshold').inputValue(),'2.00');
  if(process.env.FORGE_BUDGET_CAPTURE_DIR){await mkdir(process.env.FORGE_BUDGET_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FORGE_BUDGET_CAPTURE_DIR,'budgets-en-1280.png'),fullPage:true});}
  // Project switch remounts the scoped component: drafts and receipt IDs cannot
  // leak across projects. This uses actual shipped CSS at narrow widths.
  await page.getByLabel('Reported spending stop threshold').fill('PRIVATE-DRAFT');
  const other=f.store.read().projects[1].id;await page.setViewportSize({width:375,height:1000});await page.evaluate(id=>window.renderBudget(id,'th'),other);
  await page.getByRole('heading',{name:'งบประมาณและการใช้งาน',exact:true}).waitFor();await page.getByLabel('เพดานค่าใช้จ่ายที่สั่งหยุด').waitFor();
  assert.equal(await page.getByLabel('เพดานค่าใช้จ่ายที่สั่งหยุด').inputValue(),'');assert.equal(await page.getByText(r.id,{exact:true}).count(),0);
  for(const width of [320,375,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`no page overflow at ${width}px`);}
  if(process.env.FORGE_BUDGET_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.FORGE_BUDGET_CAPTURE_DIR,'budgets-th-768.png'),fullPage:true});
  assert.deepEqual(errors,[]);
});
