// Browser engineering fixture. Goals endpoints call the actual SQLite service;
// T3 dispatch remains injected. No product server, account or live model starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fixture,hash} from './goals-fixture.test.mjs';
import {dispatchGoalRequest} from '../app/goals/index.mjs';

test('Goals TH/EN form uses exact routes, actual evidence, QA and same authenticated Owner acceptance',async t=>{
  const f=await fixture(t),calls=[],errors=[];
  const js=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Goals from './app/web/src/Goals.jsx';const state=${JSON.stringify(f.store.read())};function App(){const[lang,L]=React.useState('en');const[project,P]=React.useState('${f.p.id}');return <><button onClick={()=>L(x=>x==='en'?'th':'en')}>Language</button><button onClick={()=>P('${f.q.id}')}>Foreign project</button><Goals t={(th,en)=>lang==='th'?th:en} state={state} projectId={project} run={async fn=>fn()} busy={false}/></>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:path.resolve('.'),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:43199/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="root"></main></body></html>'});
    if(!url.pathname.startsWith('/api/goals/'))return route.fulfill({status:404,body:'not found'});
    const method=url.pathname.slice('/api/goals/'.length),input=request.postDataJSON();calls.push({method,input});
    try{const result=await dispatchGoalRequest(f.service,method,input,f.owner);await route.fulfill({json:result});}
    catch(e){await route.fulfill({status:e.statusCode??500,json:{error:{code:e.code,message:e.message}}});}
  });
  await page.goto('http://127.0.0.1:43199/');await page.addScriptTag({content:js.outputFiles[0].text});
  await page.getByRole('heading',{name:'Goals and acceptance',exact:true}).waitFor();
  await page.getByLabel('Objective',{exact:true}).fill('Browser verified measured goal');
  await page.getByLabel('Approved plan',{exact:true}).selectOption(f.plan.id);
  await page.getByRole('checkbox',{name:f.tasks[0].title,exact:true}).check();
  await page.getByLabel('Expected SHA-256 (fixed before execution)',{exact:true}).fill(hash);
  await page.getByLabel('Unknown token usage',{exact:true}).selectOption('allow');
  await page.getByLabel('Unknown spending',{exact:true}).selectOption('allow');
  await page.getByRole('button',{name:'Save paused goal',exact:true}).click();
  await page.getByRole('button',{name:'Start / resume',exact:true}).waitFor();
  assert.equal(calls.find(c=>c.method==='create').input.criteria[0].sha256,hash);
  await page.getByRole('button',{name:'Start / resume',exact:true}).click();
  await page.getByRole('button',{name:'Run next ready task',exact:true}).click();
  await page.waitForFunction(()=>document.body.textContent.includes('Run next ready task'));
  // Wait for the actual durable run to appear before the injected finish.
  for(let n=0;n<100&&!f.store.read().runs.length;n++)await new Promise(r=>setTimeout(r,10));
  let g=f.service.state({projectId:f.p.id}).goals[0];g=await f.finish(g);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('button',{name:'QA review independent of executor',exact:true}).click();
  await page.getByRole('button',{name:'Owner final acceptance',exact:true}).click();
  for(let n=0;n<100&&f.goal(g).status!=='completed';n++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.goal(g).status,'completed');
  for(const c of calls){assert.ok(!Object.hasOwn(c.input,'reviewer'));assert.ok(!Object.hasOwn(c.input,'approved'));assert.ok(!Object.hasOwn(c.input,'caller'));}
  await page.getByRole('button',{name:'Language',exact:true}).click();
  await page.getByRole('heading',{name:'เป้าหมายและเกณฑ์รับงาน',exact:true}).waitFor();
  await page.setViewportSize({width:375,height:900});
  const unlabeled=await page.locator('input,textarea,select').evaluateAll(nodes=>nodes.filter(n=>!n.labels?.length&&!n.getAttribute('aria-label')).length);
  assert.equal(unlabeled,0);
  await page.getByRole('button',{name:'Foreign project',exact:true}).click();
  await page.getByText('ยังไม่มีเป้าหมาย เลือกงานจากแผนที่อนุมัติด้านล่าง',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
});
