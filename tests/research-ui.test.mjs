// Real React/Chromium + real SQLite research service. Wire routing is injected;
// no product server, account, model or browser integration claim is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fixture} from './research-fixture.test.mjs';
import {dispatchResearchRequest} from '../app/research/index.mjs';
test('Research Lab TH/EN configuration, execution, independent evidence, comparisons, export and mobile labels',async t=>{
  const f=await fixture(t),errors=[],calls=[];
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import ResearchLab from './app/web/src/ResearchLab.jsx';function App(){const[lang,L]=React.useState('en');const[project,P]=React.useState('${f.p.id}');return <><button onClick={()=>L(l=>l==='en'?'th':'en')}>Language</button><button onClick={()=>P('${f.q.id}')}>Foreign project</button><ResearchLab t={(th,en)=>lang==='th'?th:en} state={${JSON.stringify(f.store.read())}} projectId={project} run={async fn=>fn()} busy={false}/></>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:path.resolve('.'),loader:'jsx'},bundle:true,write:false,outfile:'research-fixture.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:43219/**',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><main id="root"></main>'});if(url.pathname==='/api/session')return route.fulfill({json:{csrf:'RESEARCH_WIRE_FIXTURE'}});
    if(!url.pathname.startsWith('/api/research/'))return route.fulfill({status:404,body:'not found'});
    const method=url.pathname.slice('/api/research/'.length),input=req.postDataJSON();calls.push({method,input});try{const result=await dispatchResearchRequest(f.service,method,input,f.owner);await route.fulfill({json:result});}catch(e){await route.fulfill({status:e.statusCode??500,json:{error:{code:e.code,message:e.message}}});}
  });
  await page.goto('http://127.0.0.1:43219/');await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  await page.getByRole('heading',{name:'Research Lab',exact:true}).waitFor();await page.getByLabel('Experiment name',{exact:true}).fill('Real CPU browser fixture');await page.getByLabel('Repetitions per condition',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Save experiment (no execution)',exact:true}).click();await page.getByRole('button',{name:'Reserve next trial',exact:true}).click();await page.getByRole('button',{name:'Run trial',exact:true}).click();await page.getByText('PASSED',{exact:true}).waitFor();
  const e=f.store.read().events.find(e=>e.type==='research.experiment');assert.equal(e.config.name,'Real CPU browser fixture');assert.equal(f.store.read().runs.length,0);
  await page.getByRole('button',{name:'Recheck evidence',exact:true}).click();await page.getByRole('button',{name:'Prepare export',exact:true}).click();await page.getByRole('button',{name:'Download JSON',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Real CPU browser fixture · dev',exact:true}).check();await page.getByRole('button',{name:'Compare conditions',exact:true}).click();await page.getByLabel('Trial pass fractions',{exact:true}).waitFor();assert.equal(await page.locator('meter').count(),1);
  await page.getByRole('button',{name:'Language',exact:true}).click();await page.getByRole('heading',{name:'ห้องวิจัยและประเมินผล',exact:true}).waitFor();await page.setViewportSize({width:375,height:900});assert.equal(await page.locator('input,select,textarea').evaluateAll(nodes=>nodes.filter(n=>!n.labels?.length&&!n.getAttribute('aria-label')).length),0);
  await page.getByRole('button',{name:'Foreign project',exact:true}).click();await page.getByText('ยังไม่มีการทดลอง',{exact:true}).waitFor();assert.deepEqual(errors,[]);assert.ok(calls.every(c=>!('caller'in c.input)&&!('tokens'in c.input)&&!('success'in c.input)));
});
