// Isolated component/API engineering fixture. Production session/CSRF, App route,
// context dispatch and provider transport qualification remain lead-owned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer as createViteServer,transformWithEsbuild } from 'vite';
import { openStore } from '../app/server/store.mjs';
import { createMemoryService } from '../app/memory/index.mjs';
import { createOwnerMemoryService } from '../app/memory/owner.mjs';
import { createMemoryHttpHandler,createOwnerMemoryHttpHandler } from '../app/memory/http.mjs';

test('browser fixture uses named scope records and real central Owner create/share/revoke/edit/export/forget APIs',{
  skip:!existsSync(chromium.executablePath())?'NOT_RUN: installed Chromium unavailable':false,timeout:60000,
},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'forge-owner-browser-')),store=await openStore(temp),owner={},runP={},runQ={},csrf=randomUUID(),cookie=randomUUID();
  await store.transaction(s=>{
    s.projects.push({id:'p',name:'Project Alpha'},{id:'q',name:'Project Beta'});
    s.tasks.push({id:'task',projectId:'p',title:'Compile fixtures'});s.bots.push({id:'bot',projectId:'p',name:'Ada agent'});
    s.conversations.push({id:'conversation',projectId:'p',name:'Team room',kind:'team'});
  });
  const authorize=({action,scope,callerContext})=>callerContext===owner||action==='read'&&scope.kind==='project'&&scope.projectId===(callerContext===runP?'p':callerContext===runQ?'q':null);
  const memory=await createMemoryService({store,dataDir:temp,authorize}),central=await createOwnerMemoryService({store,dataDir:temp,authorize});let url;
  const resolveCaller=req=>req.headers.cookie===`fixture=${cookie}`&&req.headers['x-fixture-csrf']===csrf&&req.headers.origin===url?owner:null;
  const projectHandler=createMemoryHttpHandler({service:memory,resolveCaller}),ownerHandler=createOwnerMemoryHttpHandler({service:central,resolveCaller});
  const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Memory from '/src/Memory.jsx';import '/src/style.css';
    const state=await fetch('/api/fixture-state').then(r=>r.json());
    function Root(){const [busy,setBusy]=useState(false);const run=async fn=>{setBusy(true);try{return await fn();}catch(e){console.error(e.message);}finally{setBusy(false);}};return <Memory t={(th,en)=>en} state={state} projectId="p" run={run} busy={busy}/>;}
    createRoot(document.getElementById('root')).render(<Root/>);`;
  const vite=await createViteServer({root:path.resolve('app/web'),configFile:false,cacheDir:path.join(temp,'vite-cache'),appType:'custom',server:{host:'127.0.0.1',port:0},plugins:[{
    name:'owner-memory-browser-fixture',resolveId:id=>id==='/memory-fixture.jsx'?'\0memory-fixture.jsx':null,load:async id=>id==='\0memory-fixture.jsx'?(await transformWithEsbuild(entry,'memory-fixture.jsx',{loader:'jsx'})).code:null,
    configureServer(server){server.middlewares.use((req,res,next)=>{void(async()=>{
      if(req.url==='/api/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({csrf:'isolated-memory-wire-fixture'}));return;}
      if(await ownerHandler(req,res)||await projectHandler(req,res))return;
      if(req.url==='/api/fixture-state'){const s=store.read();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Object.fromEntries(['projects','tasks','bots','conversations','skills','runs','artifacts'].map(k=>[k,s[k]]))));return;}
      if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/memory-fixture.jsx"></script>');return;}
      next();})().catch(next);});},
  }]});
  let browser;
  try{
    await vite.listen();url=`http://127.0.0.1:${vite.httpServer.address().port}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({extraHTTPHeaders:{'X-Fixture-CSRF':csrf}});await context.addCookies([{name:'fixture',value:cookie,url}]);
    const page=await context.newPage(),errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.setDefaultTimeout(12000);await page.goto(url);
    try{await page.getByRole('heading',{name:'Memory Studio',exact:true}).waitFor();}catch(e){throw new Error('Fixture startup failed: '+JSON.stringify({errors,consoleErrors,body:(await page.locator('body').innerText()).slice(0,1500)}));}
    await page.getByLabel('Scope',{exact:true}).selectOption('task');await page.getByLabel('Scope record',{exact:true}).selectOption({label:'Compile fixtures'});
    assert.equal(await page.getByLabel('Scope record',{exact:true}).evaluate(e=>e.tagName),'SELECT');
    await page.getByLabel('Title',{exact:true}).fill('Project task memory');await page.getByLabel('Authorized content',{exact:true}).fill('Task-specific record chosen by name');
    await page.getByRole('button',{name:'Save memory',exact:true}).click();await page.getByRole('button',{name:/Project task memory/}).waitFor();
    assert.equal(store.read().events.find(e=>e.type==='memory.record').memory.scope.id,'task');
    await page.getByRole('button',{name:'Central Owner memory',exact:true}).click();
    await page.getByLabel('Owner title',{exact:true}).fill('My shared preference');await page.getByLabel('Owner content',{exact:true}).fill('Owner source ภาษาไทย');
    await page.getByRole('button',{name:'Save privately',exact:true}).click();await page.getByRole('heading',{name:'Owner source memory',exact:true}).waitFor();
    await page.getByText('Not shared with any project.',{exact:true}).waitFor();assert.equal((await central.ownerContext({projectId:'p'},runP)).items.length,0);
    const share=async name=>{await page.getByLabel('Share with project',{exact:true}).selectOption({label:name});await page.getByRole('button',{name:'Share this revision with selected project',exact:true}).click();};
    await share('Project Alpha');await page.getByRole('button',{name:'Revoke · Project Alpha',exact:true}).waitFor();
    const original=await central.ownerContext({projectId:'p'},runP),refs=original.items.map(({id,revision,sha256})=>({id,revision,sha256}));assert.equal(original.items.length,1);assert.equal((await central.ownerContext({projectId:'q'},runQ)).items.length,0);
    await page.getByRole('button',{name:'Revoke · Project Alpha',exact:true}).click();await page.getByText('revoked',{exact:true}).waitFor();assert.equal((await central.resolveOwnerRefs({projectId:'p',refs},runP)).items.length,0);
    await share('Project Alpha');await page.getByRole('button',{name:'Revoke · Project Alpha',exact:true}).waitFor();assert.equal((await central.resolveOwnerRefs({projectId:'p',refs},runP)).items.length,0);
    await page.getByLabel('Owner content',{exact:true}).fill('Revised Owner source');await page.getByRole('button',{name:'Save Owner revision',exact:true}).click();await page.getByText('needs-reshare',{exact:true}).waitFor();assert.equal((await central.ownerContext({projectId:'p'},runP)).items.length,0);
    await share('Project Beta');await page.getByRole('button',{name:'Revoke · Project Beta',exact:true}).waitFor();assert.equal((await central.ownerContext({projectId:'q'},runQ)).items[0].content,'Revised Owner source');
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Owner memory',exact:true}).click();const download=await downloadPromise,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);assert.equal(JSON.parse(Buffer.concat(parts).toString()).format,'forge-owner-memory-v1');
    await page.getByLabel('Delete source and invalidate every project reference',{exact:true}).check();await page.getByRole('button',{name:'Forget Owner memory',exact:true}).click();await page.getByText('No central memories yet.',{exact:true}).waitFor();assert.equal((await central.ownerContext({projectId:'q'},runQ)).items.length,0);assert.deepEqual(errors,[]);
    const denied=await page.request.post(url+'/api/owner-memory/afterRestore',{data:{}});assert.equal(denied.status(),404);
  }finally{await browser?.close();await vite.close();await central.close();await memory.close();await store.close();await rm(temp,{recursive:true,force:true});}
});
