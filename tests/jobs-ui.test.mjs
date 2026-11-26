// Disposable HTTP/SQLite/Chromium fixture. Actual local Python, no cloud/SSH call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium } from 'playwright';
import { openStore } from '../app/server/store.mjs';
import { entity } from '../app/server/domain.mjs';
import { createJobService } from '../app/server/jobs.mjs';
import { createComputeService } from '../app/compute/index.mjs';

test('Compute no-code screen: actual HTTP/local Python, forms, conflict, TH/EN, stop, Colab transfer references and responsive theme layout',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-compute-ui-fixture-')),workspace=path.join(dir,'workspace');await mkdir(workspace);const store=await openStore(dir);let project,note,phase;
  await store.transaction(s=>{project=entity({name:'Disposable compute UI fixture',workspace,profile:{compute:{kind:'local'},limits:{jobSeconds:5}}});note=entity({name:'Actual Python UI fixture',code:"print('Python result from Compute UI')"},project.id);phase=entity({name:'CPU phase'},project.id);s.projects.push(project);s.notebooks.push(note);s.phases.push(phase);s.artifacts.push(entity({name:'Verified fixture bytes',kind:'dataset',status:'verified',sha256:'a'.repeat(64)},project.id));});
  const jobs=createJobService({store,dataDir:dir}),compute=createComputeService({store,dataDir:dir,localJobs:{start:({resolvedCompute,...input})=>jobs.start(input,{resolvedCompute}),stop:id=>jobs.stop(id)}});
  const vite=await createServer({root:path.resolve('app/web'),server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});const seen=[];
  const methods={'export-notebook':'exportNotebook','link-artifact':'linkArtifact','import-result':'importResult'};
  const html=`<html data-theme="dark-modern"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">
    import React,{useState,useEffect} from '/@fs/${path.resolve('node_modules/react/index.js').replaceAll('\\','/')}';import{createRoot}from'/@fs/${path.resolve('node_modules/react-dom/client.js').replaceAll('\\','/')}';import Compute from '/src/Compute.jsx';import '/src/style.css';
    function Fixture(){const[state,S]=useState(null),[busy,B]=useState(false),[error,E]=useState(''),[lang,L]=useState('en');const refresh=async()=>S(await(await fetch('/api/state')).json());useEffect(()=>{refresh();const t=setInterval(refresh,150);return()=>clearInterval(t);},[]);const run=async f=>{B(true);E('');try{const r=await f();await refresh();return r;}catch(e){E(e.code+': '+e.message);return null;}finally{B(false);}};return <main className="content"><p>Disposable engineering fixture · real local Python · live cloud NOT_RUN</p><label>Language<select value={lang} onChange={e=>L(e.target.value)}><option>en</option><option>th</option></select></label>{error&&<p role="alert">{error}</p>}{state&&<Compute t={(th,en)=>lang==='th'?th:en} state={state} projectId="${project.id}" run={run} busy={busy}/>}</main>;}createRoot(document.getElementById('root')).render(<Fixture/>);
    </script></body></html>`;
  const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/from '\/@fs\/[^']*react\/index.js'/,"from 'react'").replace(/from'\/@fs\/[^']*react-dom\/client.js'/,"from'react-dom/client'");
  const compiled=await transformWithEsbuild(moduleSource.replace('<select value={lang}','<select aria-label="Language" value={lang}'),'fixture.jsx',{loader:'jsx'});
  const fixtureHtml=html.replace(/<script type="module">[\s\S]*?<\/script>/,`<script type="module">${compiled.code}</script>`);
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/api/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({csrf:'isolated-compute-wire-fixture'}));return;}
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/fixture',fixtureHtml));return;}
    if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(store.read()));return;}
    if(req.url.startsWith('/api/compute/')){
      try{const chunks=[];for await(const b of req)chunks.push(b);const body=JSON.parse(Buffer.concat(chunks));seen.push({route:req.url,body});const action=req.url.slice('/api/compute/'.length);
        // Transfer HTTP bodies only: the dedicated adapter has its own byte tests.
        const result=action.startsWith('colab/')?{status:'verified',operationId:body.operationId}:await compute[methods[action]??action](body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
      }catch(e){res.statusCode=e.statusCode??500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:e.message,code:e.code}}));}return;
    }
    vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await vite.close();await compute.shutdown();await jobs.shutdown();await store.close();await rm(dir,{recursive:true,force:true});});
  const click=name=>page.getByRole('button',{name,exact:true}).click();
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await page.getByRole('heading',{name:'Compute & notebook jobs'}).waitFor();
  await page.getByLabel('Display name',{exact:true}).fill('Local fixture');await click('Save target');await page.getByText('Target saved. Execution has not been verified.',{exact:true}).waitFor();await click('Check health');await page.getByText('Latest health observation',{exact:false}).waitFor();
  // Health increments the persisted revision; a stale open draft cannot overwrite it.
  await click('Save target');await page.getByRole('alert').filter({hasText:'REVISION_CONFLICT'}).waitFor();
  await click('Start new job');await page.getByLabel('Actual job logs').filter({hasText:'Python result from Compute UI'}).waitFor();assert.equal(store.read().jobs.length,1);
  await store.transaction(s=>{s.notebooks[0].code="import time\nprint('UI stop fixture',flush=True)\ntime.sleep(30)";s.notebooks[0].revision++;});
  await click('Start new job');await page.getByLabel('Actual job logs').filter({hasText:'UI stop fixture'}).waitFor();await click('Stop this attempt');await page.waitForFunction(async()=>{const s=await(await fetch('/api/state')).json();return s.jobs.at(-1).status==='stopped';});assert.equal(store.read().jobs.at(-1).status,'stopped');
  await page.getByLabel('Saved target').selectOption('');
  for(const kind of ['owner-ssh','jupyter','vast','runpod','colab-browser','colab-mcp']){await page.getByLabel('Target kind',{exact:true}).selectOption(kind);if(kind==='owner-ssh')await page.getByLabel('SSH host',{exact:true}).waitFor();if(kind==='jupyter')await page.getByLabel('Jupyter base URL',{exact:true}).waitFor();if(kind==='colab-mcp')await page.getByLabel('Google bearer environment reference',{exact:true}).waitFor();}
  // A labelled existing Colab job exercises reference-only GUI transfer bodies.
  await store.transaction(s=>s.jobs.push(entity({kind:'compute-notebook',notebookId:note.id,sourceRevision:1,computeAttempt:{kind:'colab-mcp'},status:'completed',logs:'Labelled Colab UI receipt fixture; not a live Google result',artifactRefs:[]},project.id)));
  await page.getByLabel('Select attempt',{exact:true}).selectOption(store.read().jobs.at(-1).id);await page.getByText('Transfer Colab files',{exact:true}).click();await page.getByLabel('Verified project artifact',{exact:true}).selectOption(store.read().artifacts[0].id);await page.getByLabel('Relative file path',{exact:true}).fill('input/data.bin');await click('Upload selected artifact');await page.getByLabel('Expected download SHA-256',{exact:true}).fill('b'.repeat(64));await click('Download & verify hash');
  const upload=seen.find(r=>r.route.endsWith('/colab/upload-artifact')).body;assert.equal(upload.artifactId,store.read().artifacts[0].id);assert.equal(upload.bytes,undefined);assert.equal(upload.localPath,undefined);assert.equal(seen.find(r=>r.route.endsWith('/colab/download-artifact')).body.sha256,'b'.repeat(64));
  await page.getByLabel('Language',{exact:true}).selectOption('th');await page.getByRole('heading',{name:'เครื่องประมวลผลและสมุดโค้ด Python'}).waitFor();
  for(const width of [320,375,414,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}`);}
  await page.setViewportSize({width:1440,height:1100});
  if(process.env.FORGE_JOBS_EVIDENCE_DIR){await mkdir(process.env.FORGE_JOBS_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FORGE_JOBS_EVIDENCE_DIR,'compute-desktop.png'),fullPage:true});await page.setViewportSize({width:375,height:1000});await page.screenshot({path:path.join(process.env.FORGE_JOBS_EVIDENCE_DIR,'compute-mobile.png'),fullPage:true});}
  assert.deepEqual(errors,[]);assert.ok(seen.every(r=>r.body.resolvedCompute===undefined));
});
