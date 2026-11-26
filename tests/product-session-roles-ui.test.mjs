// Actual React events + shipped CSS + real SQLite role/Budget service.
// Routes substitute only the lead-owned HTTP/CSRF mounting; native lifecycle
// is the explicitly injected owner in the fixture. No account calls or turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fixture} from './product-session-roles-fixture.mjs';
import {dispatchSessionRoleRequest} from '../app/server/session-roles.mjs';

test('TH-default/EN UI fences stale role drafts, approves scoped children, recovers a lost response once, stops, and resets project drafts',async t=>{
  const f=await fixture(t),root=path.dirname(path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true}).trim()));
  const bundle=await build({stdin:{contents:`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import SessionRoles from './app/web/src/SessionRoles.jsx';const root=createRoot(document.getElementById('app'));function Harness({projectId,language}){const [state,setState]=useState(null),[busy,setBusy]=useState(false);const read=async()=>setState(await(await fetch('/engineering-state')).json());useEffect(()=>{void read();},[projectId]);const run=async fn=>{setBusy(true);try{const result=await fn();await read();return result;}catch{return null;}finally{setBusy(false);}};return <SessionRoles projectId={projectId} state={state} busy={busy} run={run} {...(language?{t:(th,en)=>language==='en'?en:th}:{})}/>;}window.renderRoles=(projectId,language)=>root.render(<Harness {...{projectId,language}}/>);`,resolveDir:process.cwd(),loader:'jsx'},nodePaths:[path.join(root,'node_modules')],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},logLevel:'silent'});
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],requests=[];let losePrompt=true,reads=0;
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:31919/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/engineering-state'){await route.fulfill({json:f.store.read()});return;}
    if(url.pathname==='/api/session'){await route.fulfill({json:{csrf:'engineering-session'}});return;}
    if(url.pathname.startsWith('/api/session-roles/')){
      const method=url.pathname.split('/').at(-1),input=req.postDataJSON();if(method==='state')reads++;else requests.push({method,input});
      try{const result=await dispatchSessionRoleRequest(f.roles,method,input,f.owner);if(method==='prompt'&&losePrompt){losePrompt=false;await route.abort('failed');}else await route.fulfill({json:result});}
      catch(e){await route.fulfill({status:e.statusCode??400,json:{error:{code:e.code,message:e.message}}});}return;
    }
    await route.fulfill({contentType:'text/html',body:'<html data-theme="dark-modern"><meta charset="utf-8"><body><div id="app" style="padding:16px;max-width:1180px;margin:auto"></div></body></html>'});
  });
  await page.goto('http://127.0.0.1:31919/');
  const fontCss=await Promise.all(['manrope/latin-400','manrope/latin-500','manrope/latin-600','manrope/latin-700','ibm-plex-sans-thai/thai-400','ibm-plex-sans-thai/thai-500','ibm-plex-sans-thai/thai-600'].map(async font=>{const file=path.join(root,'node_modules','@fontsource',font+'.css');let css=await readFile(file,'utf8');for(const match of [...css.matchAll(/url\(([^)]+)\)/g)]){const bytes=await readFile(path.resolve(path.dirname(file),match[1].replace(/["']/g,'')));css=css.replace(match[0],`url(data:font/woff2;base64,${bytes.toString('base64')})`);}return css;}));
  const css=fontCss.join('\n')+(await readFile('app/web/src/style.css','utf8')).replace("@import './themes.css';",await readFile('app/web/src/themes.css','utf8'));await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(id=>window.renderRoles(id),f.p.id);await page.getByRole('heading',{name:'บทบาทของรอบการทำงาน',exact:true}).waitFor();
  await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();assert.equal(requests.length,0,'opening/refeshing the UI never executes a child');
  await page.evaluate(id=>window.renderRoles(id,'en'),f.p.id);await page.getByRole('heading',{name:'Session roles',exact:true}).waitFor();
  await page.getByLabel('Conversation',{exact:true}).selectOption(f.child.id);await page.getByLabel('Session bot').selectOption(f.childBot.id);
  await f.assign(f.child.id,f.childBot.id,'reviewer',1);await page.getByRole('button',{name:'Refresh state',exact:true}).click();await page.getByRole('alert').filter({hasText:'Role changed'}).waitFor();
  await page.getByRole('button',{name:'Load current role',exact:true}).click();assert.equal(await page.getByLabel('Role',{exact:true}).inputValue(),'reviewer');
  await page.getByLabel('Role',{exact:true}).selectOption('tester');await page.getByRole('button',{name:'Save role',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
  assert.equal(requests.find(x=>x.method==='assign').input.expectedRevision,2);
  await page.getByLabel('Parent orchestrator run').selectOption(f.parent.id);const childOption=f.roles.state({projectId:f.p.id},f.owner).assignments.find(a=>a.conversationId===f.child.id);await page.getByLabel('Bound child session').selectOption(childOption.id);
  await page.getByRole('button',{name:'Approve child link',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
  const link=f.roles.state({projectId:f.p.id},f.owner).memberships.find(m=>m.usable);assert.ok(link);await page.getByLabel('Approved child',{exact:true}).selectOption(link.id);await page.getByLabel('Child prompt',{exact:true}).fill('Bounded UI engineering fixture advice.');
  await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.getByRole('region',{name:'Uncertain command'}).waitFor();assert.equal(f.ownerLifecycle.calls,1);assert.equal(f.ownerLifecycle.effects.length,1);
  await page.getByRole('button',{name:'Check same operation',exact:true}).click();await page.getByRole('region',{name:'Uncertain command'}).waitFor({state:'detached'});
  const prompts=requests.filter(x=>x.method==='prompt');assert.equal(prompts.length,2);assert.deepEqual(prompts[0].input,prompts[1].input);assert.equal(f.ownerLifecycle.calls,1);
  await page.getByRole('button',{name:'Stop prompt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');assert.equal(f.ownerLifecycle.stopCalls,1);
  await page.getByRole('button',{name:'Reconcile',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
  if(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR){await mkdir(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR,'session-roles-en-1280.png'),fullPage:true});}
  assert.ok(reads<20,'unstable App.run props must not trigger an infinite refresh loop');
  for(const width of [320,375,414,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`no page overflow at ${width}px`);}
  await page.evaluate(id=>window.renderRoles(id),f.p.id);await page.getByRole('heading',{name:'บทบาทของรอบการทำงาน',exact:true}).waitFor();
  if(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR){await page.setViewportSize({width:375,height:1000});await page.screenshot({path:path.join(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR,'session-roles-th-375.png'),fullPage:true});await page.setViewportSize({width:768,height:1000});await page.evaluate(()=>document.documentElement.dataset.theme='light-modern');await page.waitForFunction(()=>getComputedStyle(document.querySelector('button')).backgroundColor==='rgb(248, 248, 248)');await page.screenshot({path:path.join(process.env.FORGE_SESSION_ROLES_CAPTURE_DIR,'session-roles-th-768.png'),fullPage:true});}
  await page.getByLabel('ข้อความถึงรอบการทำงานย่อย').fill('PRIVATE PROJECT DRAFT');await page.evaluate(id=>window.renderRoles(id,'en'),f.q.id);await page.getByRole('heading',{name:'Session roles',exact:true}).waitFor();await page.getByLabel('Child prompt',{exact:true}).waitFor();assert.equal(await page.getByLabel('Child prompt',{exact:true}).inputValue(),'');assert.equal(await page.getByText('Bounded UI engineering fixture advice.',{exact:true}).count(),0);assert.deepEqual(errors,[]);
});
