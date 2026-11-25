// Real compiled component/browser + disposable SQLite/Mission fixture. The HTTP
// adapter below is labelled test wiring, not production session/CSRF coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import http from 'node:http';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright';
import {openStore} from '../app/server/store.mjs';
import {entity} from '../app/server/domain.mjs';
import {createLocalAuthority} from '../app/server/authority.mjs';
import {createMissionService} from '../app/missions/index.mjs';
import {createPlaybookService,dispatchPlaybookRequest} from '../app/playbooks/index.mjs';

test('actual WorkflowPresets component compiles and renders accessible TH/EN without effects during render',async()=>{
  const filename=path.resolve('tests/playbooks-ui-virtual.cjs'),bundle=await build({entryPoints:['app/web/src/WorkflowPresets.jsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'}});
  const compiled=new Module(filename);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(bundle.outputFiles[0].text,filename);
  let calls=0;for(const lang of ['th','en']){
    const html=renderToStaticMarkup(React.createElement(compiled.exports.default,{t:(th,en)=>lang==='th'?th:en,state:{revision:1},projectId:'fixture-project',run:()=>{calls++;return null;},busy:false}));
    assert.ok(html.includes(lang==='th'?'สรุปงานห้าส่วน':'Five-part brief'));assert.match(html,/<label for=/);assert.match(html,/<form/);assert.match(html,/Software delivery|ส่งมอบซอฟต์แวร์/);assert.equal(calls,0);
  }
});

test('real browser saves/revises a brief, explicitly creates one unapproved Mission, isolates project drafts and respects App run returning null',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-playbooks-component-engineering-')),store=await openStore(dir),workspace=path.join(dir,'workspace');await mkdir(workspace);
  const p=entity({name:'Component fixture',workspace}),other=entity({name:'Other fixture',workspace:path.join(dir,'other')});await store.transaction(s=>s.projects.push(p,other));
  const authority=createLocalAuthority(),owner=authority.owner({expiresAt:Date.now()+3600000});let starts=0,failCreate=false;
  const missions=createMissionService({store,goals:{},t3:{async startRun(){starts++;throw new Error('Preset must not execute');}},artifacts:{},authorize:authority.goalAuthorize}),playbooks=createPlaybookService({store,missions,authorize:authority.goalAuthorize});
  const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import WorkflowPresets from './app/web/src/WorkflowPresets.jsx';import{request}from'./app/web/src/api.mjs';
function Harness(){const[state,setState]=useState(${JSON.stringify(store.read())});const[projectId,setProject]=useState(${JSON.stringify(p.id)});const[language,setLanguage]=useState('en');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const run=async fn=>{setBusy(true);try{const r=await fn();setState(await request('/fixture/state'));return r;}catch(e){setError(e.message);return null;}finally{setBusy(false);}};
return <><p>Disposable component engineering fixture. No live provider or production HTTP qualification.</p><button onClick={()=>setLanguage(v=>v==='en'?'th':'en')}>Switch language</button><button onClick={()=>setProject(v=>v===${JSON.stringify(p.id)}?${JSON.stringify(other.id)}:${JSON.stringify(p.id)})}>Switch project</button>{error&&<p data-testid="parent-error">{error}</p>}<WorkflowPresets t={(th,en)=>language==='th'?th:en} {...{state,projectId,run,busy}}/></>;};createRoot(document.getElementById('root')).render(<Harness/>);`;
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,outdir:path.join(dir,'compiled'),platform:'browser',format:'esm'}),js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const server=http.createServer(async(req,res)=>{try{
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/fixture/state')return send(store.read());
    if(req.url==='/api/session')return send({csrf:'labelled-component-fixture'});
    if(req.url?.startsWith('/api/playbooks/')){
      let data='';for await(const chunk of req)data+=chunk;const method=req.url.split('/').at(-1);
      if(failCreate&&method==='create'){failCreate=false;return send({error:{code:'FIXTURE_UNAVAILABLE',message:'Injected component transport failure'}},503);}
      return send(await dispatchPlaybookRequest(playbooks,method,JSON.parse(data),owner));
    }
    if(req.url==='/app.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(js);return;}
    if(req.url==='/app.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
    res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playbooks component engineering fixture</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
  }catch(e){res.writeHead(e.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:e.code??'FIXTURE_ERROR',message:e.message}}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  t.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));await playbooks.close();await missions.close();await store.close();await rm(dir,{recursive:true,force:true});});
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Five-part brief',exact:true}).waitFor();
  const fillBrief=async title=>{await page.getByLabel('Brief title',{exact:true}).fill(title);for(const name of ['Objective','Inputs and scope','Acceptance criteria','Interfaces and dependencies','Risks, stop criteria and decisions'])await page.getByLabel(name,{exact:true}).fill(`Engineering ${name}`);};
  await fillBrief('Browser engineering delivery');await page.getByRole('button',{name:'Add decision',exact:true}).click();await page.getByLabel('Question',{exact:true}).fill('Choose format');await page.getByRole('button',{name:'Save draft brief',exact:true}).click();
  await page.getByRole('heading',{name:'Review Mission draft',exact:true}).waitFor();assert.equal(store.read().plans.length,0);assert.equal(store.read().runs.length,0);assert.equal(starts,0);
  assert.equal(await page.getByRole('button',{name:'Create Mission draft',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Revise brief',exact:true}).click();await page.getByLabel('Answer (blank when unknown)',{exact:true}).fill('HTML');await page.getByRole('button',{name:'Save draft brief',exact:true}).click();
  await page.getByRole('heading',{name:'Review Mission draft',exact:true}).waitFor();await page.getByLabel('Deliverable name',{exact:true}).fill('Readable HTML');await page.getByLabel('Output file in project',{exact:true}).fill('index.html');await page.getByLabel('Acceptance for this deliverable',{exact:true}).fill('Readable HTML contains the engineering objective');await page.getByLabel('JavaScript test files (one per line)',{exact:true}).fill('output.test.mjs');
  await page.getByLabel('I reviewed the brief, files and criteria. Create a Mission draft.',{exact:true}).check();await page.getByRole('button',{name:'Create Mission draft',exact:true}).click();await page.getByRole('heading',{name:'Linked Mission',exact:true}).waitFor();
  assert.equal(store.read().plans.length,1);assert.equal(store.read().plans[0].approved,false);assert.equal(store.read().tasks.length,1);assert.equal(store.read().runs.length,0);assert.equal(starts,0);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);await page.setViewportSize({width:1280,height:1000});
  await page.getByRole('button',{name:'Switch language',exact:true}).click();await page.getByRole('heading',{name:'ภารกิจที่เชื่อมไว้',exact:true}).waitFor();await page.getByRole('button',{name:'Switch project',exact:true}).click();await page.getByRole('heading',{name:'สรุปงานห้าส่วน',exact:true}).waitFor();assert.equal(await page.getByLabel('ชื่อสรุปงาน',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:/Browser engineering delivery/}).count(),0);
  await page.getByRole('button',{name:'Switch language',exact:true}).click();await fillBrief('Failed request retains draft');failCreate=true;await page.getByRole('button',{name:'Save draft brief',exact:true}).click();await page.getByTestId('parent-error').waitFor();await page.getByRole('heading',{name:'Reconcile before continuing',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Brief title',{exact:true}).inputValue(),'Failed request retains draft');assert.equal(store.read().events.filter(e=>e.type==='playbook.workflow').length,1);assert.deepEqual(errors,[]);
});
