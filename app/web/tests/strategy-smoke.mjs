// GUI wire-contract qualification: REAL SQLite + strategy services + provider
// catalog validator; INJECTED catalog/T3 execution, never a live provider run.
// No shared app/server routes are installed by this harness.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fixture as assistanceFixture} from '../../../tests/assistance-fixture.test.mjs';
import {fixture as adaptiveFixture} from '../../../tests/adaptive-fixture.test.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-strategy-gui-'));
const cleanup=[],after=fn=>cleanup.push(fn),a=await assistanceFixture({after}),d=await adaptiveFixture({after});
const calls=[],faults={loseNext:false,readError:false,delayRead:0};
const entry=path.join(root,'app/web/strategy-harness-entry.jsx').replaceAll('\\','/');
const entryCode=`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Adaptive from './src/Adaptive.jsx';import Assistance from './src/Assistance.jsx';
import './src/style.css';
function Harness(){const[service,setService]=useState('assistance'),[state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[lang,setLang]=useState('en');
const t=(th,en)=>lang==='en'?en:th;
async function refresh(){const r=await fetch('/harness-state?service='+service);const s=await r.json();setState(s);return s;}
React.useEffect(()=>{setState(null);refresh();},[service]);
const run=async fn=>{setBusy(true);setError('');try{const result=await fn();await refresh();return result;}catch(e){setError(e.message);await refresh();return null;}finally{setBusy(false);}};
return <main><p role="note">WIRE-CONTRACT HARNESS · real strategy services / INJECTED T3 · LIVE_PROVIDER_NOT_RUN</p>
<nav aria-label="Harness"><button onClick={()=>setService('assistance')}>Assistance</button><button onClick={()=>setService('adaptive')}>Adaptive</button><label htmlFor="harness-language">Language</label><select id="harness-language" value={lang} onChange={e=>setLang(e.target.value)}><option value="en">English</option><option value="th">ไทย</option></select></nav>
{error&&<p role="alert">{error}</p>}{state&&(service==='adaptive'?<Adaptive key={service} {...{t,state,run,busy}} projectId={state.projects[0].id}/>:<Assistance key={service} {...{t,state,run,busy}} projectId={state.projects[0].id}/>)}</main>;}createRoot(document.getElementById('root')).render(<Harness/>);`;
let server,browser,page;
const send=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const methods={'create-loop':'createLoop'};
try {
  server=await createServer({root:path.join(root,'app/web'),configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{
    name:'labelled-strategy-wire-harness',
    resolveId(id){if(id==='/strategy-harness-entry.jsx')return entry;},
    load(id){if(id===entry)return entryCode;},
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/harness'){
        const html=await vite.transformIndexHtml('/harness','<!doctype html><html lang="en" data-theme="dark-modern"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>FORGE strategy wire-contract harness</title></head><body><div id="root"></div><script type="module" src="/strategy-harness-entry.jsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);return;
      }
      if(url.pathname==='/harness-state'){send(res,200,(url.searchParams.get('service')==='adaptive'?d:a).store.read());return;}
      if(url.pathname==='/api/session'){send(res,200,{csrf:'isolated-component-fixture-only'});return;}
      if(!url.pathname.startsWith('/api/'))return next();
      try {
        assert.equal(req.method,'POST');let bytes='';for await(const chunk of req)bytes+=chunk;
        const body=JSON.parse(bytes),[,namespace,action]=url.pathname.split('/').slice(1);
        calls.push({path:url.pathname,body});
        if(url.pathname==='/api/providers/catalog'){send(res,200,a.providers.catalog(body));return;}
        const name=url.pathname.split('/')[2],h=name==='adaptive'?d:a,method=methods[action]??action;
        assert.equal(body.projectId,h.p.id);
        if(['state','status'].includes(method)){
          if(faults.delayRead)await new Promise(resolve=>setTimeout(resolve,faults.delayRead));
          if(faults.readError){send(res,503,{error:{code:'INJECTED_READ_FAILURE',message:'Injected read failure; refresh state.'}});return;}
        }else assert.equal(typeof body.operationId,'string');
        assert.equal(typeof h.service[method],'function',url.pathname);
        const result=await h.service[method](body);
        if(faults.loseNext&&!['state','status'].includes(method)){faults.loseNext=false;send(res,503,{error:{code:'INJECTED_OUTCOME_UNKNOWN',message:'Injected accepted command response unavailable. Reconcile the durable outcome.'}});return;}
        send(res,200,result);
      }catch(e){send(res,e.statusCode??500,{error:{code:e.code??'HARNESS_CONTRACT',message:e.message}});}
    });},
  }]});
  await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/harness`;
  console.log('HARNESS_URL',url,'FIXTURE_DIR',temp);
  if(process.argv.includes('--serve')){
    console.log('Manual harness only; no provider runs. Ctrl+C closes it.');
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else {
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const button=name=>page.getByRole('button',{name,exact:true});
    const label=name=>page.getByLabel(name,{exact:true});
    async function action(name,route){const response=page.waitForResponse(r=>r.url().endsWith(route)&&r.request().method()==='POST');await button(name).click();const r=await response;assert.equal(r.status(),200,JSON.stringify(await r.json()));await page.getByRole('status').filter({hasText:'Reading or saving…'}).waitFor({state:'hidden'});return calls.filter(c=>c.path===route).at(-1).body;}
    async function chooseTask(h){await label('Task').selectOption(h.task.id);}
    async function shot(name){await page.screenshot({path:path.join(temp,name+'.png'),fullPage:true});}
    await page.goto(url);await label('Quality weight').waitFor();
    assert.equal(await label('Quality weight').inputValue(),'');assert.equal(await label('Size rank').first().inputValue(),'');
    await chooseTask(a);await action('Select and record reasons','/api/assistance/select');await page.getByText('ask_owner',{exact:true}).waitFor();assert.equal(await button('Create loop starting with Executor').isDisabled(),true);
    await page.locator('summary').filter({hasText:'fixture-route-a'}).click();await button('Read route catalog').first().click();
    // New policy from no-code fields, exact observed options and typed booleans.
    await label('Quality weight').fill('2');await label('Cost weight').fill('3');await label('Unknown cost handling').selectOption('allow-ranked-last');
    for(const [key,value]of Object.entries({Source:'engineering GUI fixture','Recorded by':'fixture-owner','Reason and evidence':'Explicit injected classification; no measured model claim'}))await label('Policy: '+key).fill(value);
    const models=[['fixture-economy','executor',1,3,1],['fixture-premium-executor','excluded',2,6,5],['fixture-assistant','asst',3,7,'']];
    for(const [id,role,size,quality,cost]of models){const row=page.getByRole('group').filter({has:page.locator('legend').filter({hasText:id})}).filter({has:page.getByLabel('Allowed roles',{exact:true})}).first();await row.getByLabel('Allowed roles',{exact:true}).selectOption(role);await row.getByLabel('Size rank',{exact:true}).fill(String(size));await row.getByLabel('Quality rank',{exact:true}).fill(String(quality));if(cost!=='')await row.getByLabel('Cost rank (blank = unknown)',{exact:true}).fill(String(cost));for(const key of ['Source','Recorded by','Reason and evidence'])await row.getByLabel(key,{exact:true}).fill('Injected GUI evidence');}
    await label('Option: thinking').selectOption('true');
    const configured=await action('Save new policy version','/api/assistance/configure');assert.equal(configured.expectedPolicyId,null);assert.equal(configured.policy.classifications.find(c=>c.model==='fixture-assistant').options[0].value,true);assert.equal(configured.policy.classifications.find(c=>c.model==='fixture-assistant').costRank,null);
    // Null ordinals must remain unknown on a policy read/edit/save round trip.
    await button('Replace draft with current policy').click();await label('Quality weight').fill('4');const revised=await action('Save new policy version','/api/assistance/configure');assert.equal(revised.policy.classifications.find(c=>c.model==='fixture-assistant').costRank,null);assert.ok(revised.expectedPolicyId);
    await action('Select and record reasons','/api/assistance/select');await page.getByText('selected',{exact:true}).waitFor();
    await action('Create loop starting with Executor','/api/assistance/create-loop');await action('Dispatch next attempt','/api/assistance/advance');assert.equal(a.turns,1);
    await shot('assistance-desktop');await action('Reconcile loop','/api/assistance/reconcile');
    let loop=a.service.state({projectId:a.p.id}).loops.at(-1);await a.complete(loop);
    await button('Refresh strategy').click();await page.getByText('awaiting_review',{exact:true}).waitFor();
    await label('Observed stuck reason').fill('Injected completed Executor output could not resolve dependency');
    const loopPanel=page.locator('section').filter({has:page.getByRole('heading',{name:'Executor and Asst loop',exact:true})});
    for(const key of ['Source','Recorded by','Reason and evidence'])await loopPanel.getByLabel(key,{exact:true}).fill('Observed fixture run');
    await action('Escalate this stuck attempt','/api/assistance/transition');await action('Dispatch next attempt','/api/assistance/advance');assert.equal(a.turns,2);loop=a.service.state({projectId:a.p.id}).loops.at(-1);await a.complete(loop);await button('Refresh strategy').click();await page.getByText('awaiting_return',{exact:true}).waitFor();await label('Reviewed handoff').fill('Owner-reviewed bounded fixture guidance');await action('Return reviewed handoff to Executor','/api/assistance/transition');await action('Dispatch next attempt','/api/assistance/advance');loop=a.service.state({projectId:a.p.id}).loops.at(-1);await a.complete(loop);await button('Refresh strategy').click();await page.getByText('awaiting_review',{exact:true}).waitFor();await label('Reviewer').fill('fixture-human');await label('Verification evidence').fill('Inspected injected fixture result');await action('Approve loop review','/api/assistance/transition');
    assert.equal(a.store.read().tasks[0].status,'ready');assert.equal(a.store.read().projects[0].profile.provider.model,'unchanged');
    // Unknown accepted HTTP response: durable decision exists, no auto dispatch.
    faults.loseNext=true;await button('Select and record reasons').click();await page.getByRole('heading',{name:'Reconcile before continuing',exact:true}).waitFor();const pending=await page.evaluate(()=>Object.values(sessionStorage).map(v=>{try{return JSON.parse(v);}catch{return [];}}).flat().filter(x=>x.action==='select'));assert.ok(pending[0].input.operationId);assert.equal(a.turns,3);await shot('assistance-unknown');await page.reload();await page.getByRole('heading',{name:'Reconcile before continuing',exact:true}).waitFor();assert.equal(a.turns,3);await chooseTask(a);await label('Saved decision').selectOption(a.service.state({projectId:a.p.id}).decisions.at(-1).id);await button('Acknowledge after checking outcome').click();
    await action('Create loop starting with Executor','/api/assistance/create-loop');await action('Dispatch next attempt','/api/assistance/advance');await action('Stop owned loop','/api/assistance/stop');assert.equal(a.turns,4);
    // A stale draft must retain its original expectedPolicyId and entered text.
    await button('Replace draft with current policy').click();await label('Quality weight').fill('9');await a.configure(a.service.state({projectId:a.p.id}).policy.policy);const conflict=page.waitForResponse(r=>r.url().endsWith('/api/assistance/configure'));await button('Save new policy version').click();assert.equal((await conflict).status(),409);assert.equal(await label('Quality weight').inputValue(),'9');await shot('assistance-policy-conflict');await button('Refresh strategy').click();await page.getByRole('alert').filter({hasText:'Policy changed.'}).waitFor();
    await a.store.transaction(s=>{s.connections[0].lastCheck.authentication='unknown';});await action('Select and record reasons','/api/assistance/select');await page.getByText('needs_setup',{exact:true}).waitFor();assert.equal(await button('Create loop starting with Executor').isDisabled(),true);
    for(const width of [320,375,414,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth),true,`assistance overflow at ${width}`);await shot('assistance-'+width);}await page.setViewportSize({width:1440,height:1000});
    // Adaptive uses actual service state, versions and evidence bytes.
    await button('Adaptive').click();await chooseTask(d);await action('Select and record reasons','/api/adaptive/select');await action('Create loop from this decision','/api/adaptive/create-loop');await action('Use human-approved plan','/api/adaptive/advance');await action('Dispatch through T3','/api/adaptive/advance');await action('Stop owned loop','/api/adaptive/stop');await action('Resume within original deadline','/api/adaptive/resume');await label('Revision feedback').fill('Inspect fixture revision');await action('Save revision and return to plan','/api/adaptive/advance');await action('Use human-approved plan','/api/adaptive/advance');await action('Dispatch through T3','/api/adaptive/advance');let dl=d.service.status({projectId:d.p.id}).loops.at(-1);await d.complete(dl);await action('Reconcile loop','/api/adaptive/reconcile');
    const output=await d.evidenceRun(); // Fix fixture hash to actual raw bytes for the byte evaluator.
    await d.store.transaction(async s=>{const artifact=s.artifacts.find(x=>x.id===output.artifact.id);artifact.sha256=createHash('sha256').update(await readFile(artifact.path)).digest('hex');});
    const currentRun=d.store.read().runs.find(r=>r.id===dl.attempts.at(-1).runId),currentArtifact=await d.artifact(currentRun);
    await d.store.transaction(async s=>{s.artifacts.find(x=>x.id===currentArtifact.id).sha256=createHash('sha256').update(await readFile(currentArtifact.path)).digest('hex');});
    await action('Reconcile loop','/api/adaptive/reconcile');
    const inspection=page.getByRole('group',{name:'Current attempt evidence',exact:true});await inspection.getByRole('button',{name:'Add evidence check',exact:true}).click();await inspection.getByLabel('Comparable check key',{exact:true}).fill('output');await inspection.getByLabel('Artifact linked to this run',{exact:true}).selectOption(currentArtifact.id);await action('Inspect output evidence','/api/adaptive/advance');await label('Reviewer').fill('fixture-human');await action('Approve loop review','/api/adaptive/advance');
    await label('Active base skill').selectOption(d.skill.id);await label('New version').fill('2.0-gui');await label('Candidate instructions').fill('Inspect actual fixture output, compare bytes and retain provenance.');await label('Lesson from evidence').fill('Versioned improvement proposed from injected run evidence.');await page.getByRole('group',{name:'Source evidence (choose 1–24)',exact:true}).getByRole('checkbox').first().check();await action('Create versioned candidate','/api/adaptive/candidate');
    const candidate=d.service.status({projectId:d.p.id}).candidates.at(-1);const candidateRun=await d.evidenceRun(candidate);await d.store.transaction(async s=>{const artifact=s.artifacts.find(x=>x.id===candidateRun.artifact.id);artifact.sha256=createHash('sha256').update(await readFile(artifact.path)).digest('hex');});
    // Reload component to refresh domain records without manufacturing UI evidence.
    await button('Assistance').click();await page.getByRole('heading',{name:'Assistance strategy',exact:true}).waitFor();await button('Adaptive').click();await label('Candidate to evaluate').selectOption(candidate.id);
    for(const [name,evidence]of [['Baseline evidence',output],['Candidate evidence',candidateRun]]){const group=page.getByRole('group',{name,exact:true});await group.getByRole('button',{name:'Add evidence check',exact:true}).click();await group.getByLabel('Comparable check key',{exact:true}).fill('output');await group.getByLabel('Evidence run',{exact:true}).selectOption(evidence.run.id);await group.getByLabel('Artifact linked to this run',{exact:true}).selectOption(evidence.artifact.id);}
    await action('Evaluate both evidence suites','/api/adaptive/evaluate');await label('Promotion reason').fill('Both exact fixture suites passed');await action('Promote after evidence revalidation','/api/adaptive/promote');
    const promotion=d.service.status({projectId:d.p.id}).history.at(-1);await label('Promotion to roll back').selectOption(promotion.id);await label('Rollback reason').fill('Explicit fixture rollback after GUI verification');await action('Roll back to previous version','/api/adaptive/rollback');assert.equal(d.store.read().skills.find(s=>s.id===d.skill.id).status,'active');
    await shot('adaptive-desktop');
    // Read failures and loading remain visible. Refresh does not dispatch.
    faults.readError=true;await button('Refresh strategy').click();await page.getByRole('alert').filter({hasText:'INJECTED_READ_FAILURE'}).waitFor();await shot('adaptive-read-error');faults.readError=false;faults.delayRead=800;await button('Refresh strategy').click();await page.getByRole('status').filter({hasText:'Reading or saving…'}).waitFor();await shot('adaptive-loading');faults.delayRead=0;await page.getByRole('status').filter({hasText:'Reading or saving…'}).waitFor({state:'hidden'});
    for(const width of [320,375,414,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth),true,`overflow at ${width}`);await shot('adaptive-'+width);}
    await label('Language').selectOption('th');await page.getByRole('heading',{name:'ทักษะและวงรอบปรับปรุง',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{level:1}).count(),1);
    assert.deepEqual(await page.locator('input,select,textarea').evaluateAll(elements=>elements.filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML)),[]);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'),true);
    assert.deepEqual(errors,[]);
    const expected=['assistance/state','providers/catalog','assistance/configure','assistance/select','assistance/create-loop','assistance/advance','assistance/reconcile','assistance/transition','assistance/stop','adaptive/status','adaptive/select','adaptive/create-loop','adaptive/advance','adaptive/stop','adaptive/reconcile','adaptive/resume','adaptive/candidate','adaptive/evaluate','adaptive/promote','adaptive/rollback'];
    for(const route of expected)assert.ok(calls.some(c=>c.path==='/api/'+route),route);
    const evidence={result:'PASSED',qualification:'GUI_WIRE_CONTRACT_REAL_SERVICES_INJECTED_T3',liveProvider:'NOT_RUN',homeUat:'NOT_RUN',fixtureDir:temp,checks:['empty/unconfigured ordinals','ask_owner and needs_setup dispatch blocked','catalog-only options preserve boolean','policy provenance and weights; null cost survives read/edit/save; stale revision 409 preserves draft','Executor/Asst/Executor reviewed handoff and stop','unchanged project route and task status','accepted command response unavailable: operation ID retained across reload; no auto dispatch','adaptive stop/resume/revise/reconcile/inspect/human-review','actual byte evidence paired evaluation/promotion/rollback','loading and read-error states','both components: 320/375/414/768px main no overflow','Thai and keyboard focus; one H1; labelled inputs','zero browser exceptions'],routes:[...new Set(calls.map(c=>c.path))]};
    await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  }
}catch(e){await page?.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}
finally {await browser?.close();await server?.close();for(const fn of cleanup.reverse())await fn();}
