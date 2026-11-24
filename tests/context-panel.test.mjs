import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {openStore} from '../app/server/store.mjs';
import {createContextService,dispatchContextRequest} from '../app/context/index.mjs';

test('ContextBudget operates real HTTP/SQLite policies, compose, compact, evidence, retrieval and revocation in TH/EN',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-context-ui-')),store=await openStore(dir),caller={};
  const source={kind:'fixture',reference:'disposable panel verification, no live provider',observedAt:'2026-11-24T00:00:00Z'};
  await store.transaction(s=>{s.projects.push({id:'p',profile:{provider:{instanceId:'fixture-provider',model:'fixture-model'}}});});
  const context=await createContextService({store,dataDir:dir,authorize:({callerContext})=>callerContext===caller,capabilities:async()=>({contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source})});
  const sp=await context.spill({projectId:'p',operationId:crypto.randomUUID(),text:'Stored output ภาษาไทย',source},caller);
  const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import ContextBudget from './ContextBudget.jsx';const state=await(await fetch('/fixture/state')).json();function Fixture(){const[language,setLanguage]=useState('th');return <><button onClick={()=>setLanguage(language==='th'?'en':'th')}>Language</button><ContextBudget state={state} projectId="p" t={(th,en)=>language==='th'?th:en} run={async fn=>fn()} busy={false}/></>;}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:path.resolve('app/web/src'),loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
  const script=bundle.outputFiles[0].text;
  const server=createServer(async(req,res)=>{try{
    if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html lang="th"><meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');return;}
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(script);return;}
    if(req.url==='/fixture/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(store.read()));return;}
    // Supports the lead's newer shared request helper after integration. This
    // token belongs only to this disposable loopback fixture, never production.
    if(req.url==='/api/session'){res.setHeader('content-type','application/json');res.end(JSON.stringify({csrf:'disposable-context-panel-fixture'}));return;}
    const match=/^\/api\/context\/([a-z]+)$/.exec(req.url);
    if(req.method!=='POST'||!match){res.writeHead(404);res.end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Fixture request limit');}
    const value=await dispatchContextRequest(context,match[1],JSON.parse(body),caller);res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
  }catch(e){res.writeHead(e.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:e.code,message:e.message}}));}});
  let browser;
  t.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));await store.close();await rm(dir,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
  const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'บริบทและงบโทเคน',exact:true}).waitFor();await page.getByRole('button',{name:'Language',exact:true}).click();
  await page.getByLabel('Context window',{exact:true}).fill('10000');await page.getByLabel('Output reserve',{exact:true}).fill('500');await page.getByLabel('Safety reserve',{exact:true}).fill('100');await page.getByLabel('Capacity source / configuration note',{exact:true}).fill('fixture capacity configured by panel');
  await page.getByRole('button',{name:'Save route budget',exact:true}).click();await page.getByRole('button',{name:'Load saved values',exact:true}).waitFor();
  assert.equal(store.read().events.find(e=>e.type==='context.policy').budget.maxInputTokens,9400);
  await page.getByLabel('Preview data',{exact:true}).fill('preview ภาษาไทย and English evidence');await page.getByRole('button',{name:'Compose with receipt',exact:true}).click();
  await page.getByText(/estimate · \d+ tokens/).waitFor();await page.getByText('The native harness owns its internal history; its token count is unknown.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Compact permitted content',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('select')[1]?.options.length>=3);
  assert.equal(store.read().events.filter(e=>e.type==='context.version').length,2);
  await page.getByRole('button',{name:'Resolve with evidence',exact:true}).click();await page.getByRole('button',{name:'Inspect accounting & usage',exact:true}).click();
  await page.getByLabel('Scoped retrieval handle',{exact:true}).selectOption(sp.handle);await page.getByRole('button',{name:'Read first page & verify hash',exact:true}).click();await page.getByText('Stored output ภาษาไทย',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Revoke & delete bytes',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Revoke & delete bytes')?.disabled===true);
  assert.equal(store.read().events.filter(e=>e.type==='context.revoked').length,1);
  await page.reload();await page.getByRole('heading',{name:'บริบทและงบโทเคน',exact:true}).waitFor();
  await page.getByRole('button',{name:'Language',exact:true}).click();await page.getByLabel('Context version',{exact:true}).selectOption(store.read().events.filter(e=>e.type==='context.version').at(-1).id);await page.getByRole('button',{name:'Resolve with evidence',exact:true}).click();await page.getByText(/estimate · \d+ tokens/).waitFor();
  assert.deepEqual(pageErrors,[]);
});
