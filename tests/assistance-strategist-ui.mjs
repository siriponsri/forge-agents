// Component wire qualification: production JSX/CSS, real SQLite + Assistance
// service; INJECTED native catalog/turns. This never starts the native T3 process.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fixture} from './assistance-fixture.test.mjs';
import {THEMES} from '../app/web/src/themes.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),temp=await mkdtemp(path.join(os.tmpdir(),'forge-strategist-ui-'));
const cleanup=[],h=await fixture({after:fn=>cleanup.push(fn)}),calls=[],errors=[];
const entry=path.join(root,'app/web/strategist-harness.jsx').replaceAll('\\','/');
const entryCode=`import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import Assistance from './src/Assistance.jsx';import './src/style.css';
function Harness(){const[state,setState]=useState(null),[busy,setBusy]=useState(false),[lang,setLang]=useState('th');
const t=(th,en)=>lang==='th'?th:en,refresh=async()=>setState(await(await fetch('/harness-state')).json());useEffect(()=>{refresh()},[]);
const run=async fn=>{setBusy(true);try{const r=await fn();await refresh();return r}catch{return null}finally{setBusy(false)}};
return <main><p role="note">ENGINEERING FIXTURE · real SQLite / INJECTED native effects · LIVE_PROVIDER_NOT_RUN</p>
<label htmlFor="language">Language</label><select id="language" value={lang} onChange={e=>setLang(e.target.value)}><option value="th">ไทย</option><option value="en">English</option></select>
{state&&<Assistance {...{t,state,run,busy}} projectId={state.projects[0].id}/>}</main>};createRoot(document.getElementById('root')).render(<Harness/>);`;
let server,browser,page;
const send=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
try{
  server=await createServer({root:path.join(root,'app/web'),configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{
    name:'strategist-isolated-component-qualification',resolveId:id=>id==='/strategist-harness.jsx'?entry:undefined,load:id=>id===entry?entryCode:undefined,
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/harness'){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/harness','<!doctype html><html lang="th" data-theme="dark-modern"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strategist engineering fixture</title></head><body><div id="root"></div><script type="module" src="/strategist-harness.jsx"></script></body></html>'));return;}
      if(url.pathname==='/harness-state'){send(res,200,h.store.read());return;}
      if(url.pathname==='/api/session'){send(res,200,{csrf:'component-fixture-only'});return;}
      if(!url.pathname.startsWith('/api/assistance/'))return next();
      try{
        let bytes='';for await(const b of req)bytes+=b;const input=JSON.parse(bytes),action=url.pathname.split('/').at(-1),method=action==='create-loop'?'createLoop':action;
        calls.push({action,input});assert.equal(input.projectId,h.p.id);if(action!=='state')assert.ok(input.operationId);
        send(res,200,await h.service[method](input));
      }catch(e){send(res,e.statusCode??500,{error:{code:e.code??'HARNESS_ERROR',message:e.message}});}
    });},
  }]});
  await server.listen();const url=`http://127.0.0.1:${server.httpServer.address().port}/harness`;
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const label=name=>page.getByLabel(name,{exact:true}),button=name=>page.getByRole('button',{name,exact:true});
  async function action(name,action){const response=page.waitForResponse(r=>r.url().endsWith('/api/assistance/'+action));await button(name).click();const r=await response;assert.equal(r.status(),200,JSON.stringify(await r.json()));await page.getByRole('status').filter({hasText:'Reading or saving…'}).waitFor({state:'hidden'});}
  async function complete(){await h.complete(h.service.state({projectId:h.p.id}).loops.at(-1));await action('Refresh strategy','state');}
  const panel=()=>page.locator('section').filter({has:page.getByRole('heading',{name:'Strategist and Executor loop',exact:true})});
  await page.goto(url);await page.getByRole('heading',{name:'กลยุทธ์ผู้ช่วย',exact:true}).waitFor();await label('รูปแบบบทบาท').selectOption('strategist-executor');await label('คุณภาพผู้วางกลยุทธ์ขั้นต่ำ').waitFor();
  await label('Language').selectOption('en');await label('Task').selectOption(h.task.id);await action('Select and record reasons','select');
  await page.getByText('ask_owner',{exact:true}).waitFor();assert.ok(await button('Create loop starting with Executor').isDisabled());
  await label('Quality weight').fill('2');await label('Cost weight').fill('3');await label('Unknown cost handling').selectOption('allow-ranked-last');
  for(const key of ['Source','Recorded by','Reason and evidence'])await label('Policy: '+key).fill('Injected owner evidence');
  for(const [model,role,size,quality,cost]of [['fixture-economy','executor',1,3,1],['fixture-premium-executor','strategist',0,4,2],['fixture-assistant','asst',3,7,'']]){
    const row=page.getByRole('group').filter({has:page.locator('legend').filter({hasText:model})}).first();
    await row.getByLabel('Allowed roles',{exact:true}).selectOption(role);
    for(const [key,value]of [['Size rank',size],['Quality rank',quality],['Cost rank (blank = unknown)',cost]])await row.getByLabel(key,{exact:true}).fill(String(value));
    for(const key of ['Source','Recorded by','Reason and evidence'])await row.getByLabel(key,{exact:true}).fill('Explicit engineering fixture classification');
  }
  await action('Save new policy version','configure');await action('Select and record reasons','select');
  assert.equal(calls.filter(c=>c.action==='select').at(-1).input.constraints.rolePattern,'strategist-executor');
  assert.equal(h.service.state({projectId:h.p.id}).decisions.at(-1).selection.asst,undefined);
  await page.getByRole('heading',{name:'Strategist · fixture-premium-executor',exact:true}).waitFor();
  await action('Create loop starting with Strategist','create-loop');await action('Dispatch next attempt','advance');assert.equal(h.turns,1);
  await complete();await page.getByText('awaiting_return',{exact:true}).waitFor();
  assert.ok(await button('Hand reviewed strategy to Executor').isDisabled());assert.equal(await button('Approve loop review').count(),0);
  await label('Reviewed handoff').fill('Reviewed risk and acceptance checks for the approved task');
  for(const key of ['Source','Recorded by','Reason and evidence'])await panel().getByLabel(key,{exact:true}).fill('Owner reviewed exact injected Strategist run');
  // Both variants use current tokens; every shipped palette retains readable controls.
  for(const theme of THEMES){await page.locator('html').evaluate((e,id)=>e.dataset.theme=id,theme.id);assert.ok(await button('Hand reviewed strategy to Executor').isVisible());assert.equal(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth),true,theme.id);}
  await page.locator('html').evaluate(e=>e.dataset.theme='dark-modern');
  await page.screenshot({path:path.join(temp,'desktop-strategist-handoff.png'),fullPage:true});
  await label('Language').selectOption('th');await page.setViewportSize({width:375,height:1000});
  await page.getByRole('button',{name:'ส่งแผนที่ตรวจแล้วให้ผู้ลงมือทำงาน',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(temp,'mobile-th-strategist-handoff.png'),fullPage:true});
  for(const width of [320,375,414,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth),true,`overflow ${width}`);}
  await label('Language').selectOption('en');await page.setViewportSize({width:1440,height:1000});
  await action('Hand reviewed strategy to Executor','transition');assert.equal(h.turns,1);await action('Dispatch next attempt','advance');assert.equal(h.turns,2);await complete();
  assert.equal(await button('Escalate this stuck attempt').count(),0);assert.equal(await label('Observed stuck reason').count(),0);
  await label('Reviewer').fill('Fixture owner');await label('Verification evidence').fill('Inspected injected result');await action('Approve loop review','transition');
  assert.equal(h.service.state({projectId:h.p.id}).loops.at(-1).status,'completed');assert.equal(h.store.read().tasks[0].status,'ready');
  await label('Role pattern').selectOption('executor-only');await action('Select and record reasons','select');await action('Create loop starting with Executor','create-loop');await action('Dispatch next attempt','advance');await action('Stop owned loop','stop');assert.equal(h.turns,3);
  // Failed strategic attempt has a recovery explanation and cannot hand off.
  await label('Role pattern').selectOption('strategist-executor');await action('Select and record reasons','select');await action('Create loop starting with Strategist','create-loop');await action('Dispatch next attempt','advance');
  await h.complete(h.service.state({projectId:h.p.id}).loops.at(-1),'failed');await action('Refresh strategy','state');
  await page.getByRole('alert').filter({hasText:'The advisory attempt did not complete.'}).waitFor();assert.ok(await button('Hand reviewed strategy to Executor').isDisabled());
  await page.screenshot({path:path.join(temp,'failed-strategist.png'),fullPage:true});await action('Stop owned loop','stop');
  assert.deepEqual(await page.locator('input,select,textarea').evaluateAll(es=>es.filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML)),[]);
  await label('Role pattern').focus();await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');assert.deepEqual(errors,[]);
  const evidence={result:'PASSED',qualification:'REAL_SQLITE_SERVICES_PRODUCTION_JSX_INJECTED_NATIVE_EFFECTS',liveProvider:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN',fixtureDir:temp,themes:THEMES.length,widths:[320,375,414,768,1440],turns:h.turns,checks:['Thai default / English','policy Strategist classification from evidence','unconfigured refusal','distinct exact route/model snapshots','reviewed Strategist to Executor wire action','absent Asst controls for optional pattern','Executor-only dispatch and Stop','failed advisory recovery state','labelled controls and keyboard focus','no overflow across palettes and target widths','zero browser exceptions']};
  await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page?.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}
finally{await browser?.close();await server?.close();for(const fn of cleanup.reverse())await fn();}
