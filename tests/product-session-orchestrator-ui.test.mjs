// Mounted production Chat -> SessionRoles + SessionOrchestrator + Run, shipped
// CSS/fonts, real SQLite + role/intent services. Browser HTTP/session routing and
// the native task/conversation lifecycle are explicitly INJECTED engineering
// fixtures. This never starts T3, a provider turn, account login or native job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture,gate} from './product-session-roles-fixture.mjs';
import {entity,find,changed} from '../app/server/domain.mjs';
import {digest as taskDigest} from '../app/server/agui.mjs';
import {createSessionRoute} from '../app/server/session-route.mjs';
import {dispatchSessionRoleRequest} from '../app/server/session-roles.mjs';

// Read-only dependency resolution; works in the isolated worktree without an
// install, junction or manifest/lockfile edit. Service imports use the shared loader.
const common=execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true}).trim();
const dependencyRoot=process.env.FORGE_TEST_DEPENDENCY_ROOT??path.dirname(path.resolve(common));
const require=createRequire(path.join(dependencyRoot,'package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
const origin='http://127.0.0.1:31921'; // Playwright interception only; NO listener.
const longName='ตรวจหลักฐานและประสานงาน Engineering fixture '+ 'session-with-long-name-'.repeat(5);
const tr=(language,th,en)=>language==='en'?en:th;
let browser,bundle,captures;

async function serviceFixture(t){
  const f=await fixture(t);
  const plan=entity({name:'Approved engineering plan',approved:true},f.p.id);
  const task=entity({title:longName,description:'Bounded engineering advice only',planId:plan.id,botId:f.bot.id,status:'ready',runIds:[],dependsOn:[],evidence:[],artifactIds:[]},f.p.id);
  const otherParent=entity({name:'Alternative parent session',kind:'private',botId:f.bot.id,messages:[]},f.p.id);
  const unbound=entity({name:'Unbound child session',kind:'private',botId:f.childBot.id,messages:[]},f.p.id);
  await f.store.transaction(s=>{
    s.plans.push(plan);s.tasks.push(task);
    const unapproved=entity({name:'Unapproved fixture plan',approved:false},f.p.id);s.plans.push(unapproved);
    for(const data of [
      {title:'Excluded unapproved task',planId:unapproved.id,botId:f.bot.id,status:'ready'},
      {title:'Excluded missing Orchestrator role',planId:plan.id,botId:f.childBot.id,status:'ready'},
      {title:'Excluded running task',planId:plan.id,botId:f.bot.id,status:'running'},
    ])s.tasks.push(entity(data,f.p.id));
    s.tasks.push(entity({title:'Excluded foreign task',planId:plan.id,botId:f.bot.id,status:'ready'},f.q.id));
    find(s,'conversations',f.child.id).name=longName;
    otherParent.bindings=structuredClone(find(s,'conversations',f.chat.id).bindings);
    s.conversations.push(otherParent,unbound);
    find(s,'runs',f.parent.id).status='completed';
  });
  await f.assign(otherParent.id,f.bot.id,'orchestrator');
  await f.assign(unbound.id,f.childBot.id,'reviewer');
  let calls=0,route;
  const native={async startRun(input){
    calls++;
    return f.store.transaction(s=>{
      route.validateContext(s,input);
      const current=find(s,'tasks',task.id);
      const run=entity({...input,botId:current.botId,attemptId:crypto.randomUUID(),threadId:'INJECTED-native-parent-thread',rootNodeId:crypto.randomUUID(),selection:structuredClone(f.selection),sessionRole:f.roles.captureRole(s,{...input,botId:current.botId}),status:'submitting'},f.p.id);
      s.runs.push(run);current.runIds.push(run.id);changed(current);
      run.guardedReservedTaskSnapshot=taskDigest(current);route.reserve(s,{run,input});
      return run;
    });
  }};
  route=createSessionRoute({store:f.store,authorizeOwner:(_i,caller)=>caller===f.owner&&f.ownerState.active?{kind:'human',role:'owner'}:null,policy:{observe:()=>({route:f.selection,policyGeneration:'fixture-policy',toolGeneration:'fixture-tools'})},getGuarded:()=>({privateSnapshot:()=>null}),getT3:()=>native,getRoles:()=>f.roles,getMcp:()=>null});
  t.after(()=>route.close());
  return {...f,route,task,otherParent,unbound,get calls(){return calls;}};
}

async function harness(t,{language='th',mode='chat'}={}){
  const f=await serviceFixture(t),context=await browser.newContext({viewport:{width:1440,height:1000}});
  t.after(()=>context.close());
  const page=await context.newPage(),requests=[],errors=[],external=[],faults={};
  page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const entry=()=>`<!doctype html><html lang="${language}" data-theme="dark-modern"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/bundle.css"></head><body><div id="app"></div><script>window.initial=${JSON.stringify({projectId:f.p.id,language,mode})}</script><script src="/bundle.js"></script></body></html>`;
  await page.route('**/*',async r=>{
    const req=r.request(),url=new URL(req.url());
    if(url.origin!==origin){external.push(req.url());await r.abort();return;}
    if(url.pathname==='/bundle.js'){await r.fulfill({contentType:'text/javascript',body:bundle.js});return;}
    if(url.pathname==='/bundle.css'){await r.fulfill({contentType:'text/css',body:bundle.css});return;}
    if(url.pathname==='/forge-mark.svg'||url.pathname==='/favicon.svg'){await r.fulfill({contentType:'image/svg+xml',body:await readFile(url.pathname==='/forge-mark.svg'?'app/web/public/forge-mark.svg':'apps/website/public/favicon.svg')});return;}
    if(url.pathname==='/engineering-state'){await r.fulfill({json:f.store.read()});return;}
    if(url.pathname==='/api/session'){await r.fulfill({json:{csrf:'INJECTED-browser-owner-session'}});return;}
    if(url.pathname.startsWith('/api/')){
      const method=url.pathname.split('/').at(-1),input=req.postData()?req.postDataJSON():{};
      requests.push({path:url.pathname,method,input,csrf:req.headers()['x-forge-csrf']});
      const fault=faults[method];if(fault?.once!==false)delete faults[method];
      try{
        if(fault?.hold){fault.hold.enter();await fault.hold.promise;}
        if(fault?.beforeError)throw Object.assign(new Error(fault.beforeError),{code:fault.beforeError,statusCode:fault.status??503});
        let result;
        if(url.pathname.startsWith('/api/session-roles/'))result=await dispatchSessionRoleRequest(f.roles,method,input,f.owner);
        else if(url.pathname.startsWith('/api/session-orchestrator/'))result=await f.route[{intent:'createIntent',start:'start',cancel:'cancel'}[method]](input,f.owner);
        else if(/^\/api\/runs\/[^/]+\/(reconcile|stop|disconnect|recovery)$/.test(url.pathname)){
          // Run-control ROUTE INJECTION only; no native observation/Stop proof.
          const id=url.pathname.split('/')[3];
          result=await f.store.transaction(s=>{const run=find(s,'runs',id);if(method==='stop'){run.status='interrupted';run.stopRequest={status:'INJECTED-confirmed'};}return {runId:run.id,status:run.status,engineeringFixture:true};});
        }else throw Error(`Unexpected route ${url.pathname}`);
        if(fault?.loseResponse){await r.abort('failed');return;}
        await r.fulfill({json:result});
      }catch(error){await r.fulfill({status:error.statusCode??400,json:{error:{code:error.code??'ENGINEERING_ROUTE_ERROR',message:error.message}}});}
      return;
    }
    if(url.pathname==='/'){await r.fulfill({contentType:'text/html',body:entry()});return;}
    throw Error(`Unexpected engineering request ${url.pathname}`);
  });
  const render=async(projectId=f.p.id,lang=language,nextMode=mode)=>{
    await page.evaluate(args=>window.renderSessionUi(args),{projectId,language:lang,mode:nextMode});
    await page.locator(`[data-engineering-ready="true"][data-engineering-project="${projectId??''}"][data-engineering-language="${lang}"]`).waitFor();
    const summary=page.locator('.session-orchestrator:not([open]) > summary');
    if(await summary.count()){await summary.focus();await page.keyboard.press('Enter');}
  };
  const open=async(lang=language)=>{
    if(mode==='chat'){
      const button=page.getByRole('button',{name:tr(lang,'บทบาทและเซสชัน','Roles and sessions'),exact:true});
      await button.waitFor();await button.focus();await page.keyboard.press('Enter');
      assert.equal(await button.getAttribute('aria-pressed'),'true');
    }
    await page.getByRole('heading',{name:tr(lang,'บทบาทของเซสชัน','Session roles'),exact:true}).waitFor();
    await page.locator('.session-orchestrator > summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('.session-orchestrator').getAttribute('open'),'');
    await page.getByRole('button',{name:tr(lang,'โหลดสถานะ','Refresh state'),exact:true}).click();
  };
  const select=async(lang=language)=>{
    await page.getByLabel(tr(lang,'Task ที่อนุมัติ','Approved task'),{exact:true}).selectOption(f.task.id);
    const assignment=f.store.read().events.find(e=>e.type==='session-role.assignment'&&e.conversationId===f.chat.id);
    await page.getByLabel(tr(lang,'เซสชัน Orchestrator','Orchestrator session'),{exact:true}).selectOption(assignment.id);
    await page.locator('.session-child').filter({hasText:longName}).getByRole('checkbox').check();
  };
  const shot=async name=>{await page.evaluate(()=>document.fonts.ready);const file=path.join(captures,`${name}.png`);await page.screenshot({path:file,fullPage:true});return file;};
  await page.goto(origin);await page.locator('[data-engineering-ready="true"]').waitFor();
  t.after(()=>{assert.deepEqual(errors,[],'no uncaught React/browser exceptions');assert.deepEqual(external,[],'no external resources/provider requests');});
  return {f,page,requests,faults,render,open,select,shot};
}

async function fit(page,width){
  await page.setViewportSize({width,height:1000});
  const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll('button,input,select,textarea,fieldset,summary,.panel')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,text:e.textContent?.trim().slice(0,90),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,client:e.clientWidth,scroll:e.scrollWidth})).filter(e=>e.left<0||e.right>innerWidth+1||e.scroll>e.client+2)}));
  assert.ok(result.scroll<=result.width,`document fits ${width}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.bad,[],`controls/labels fit without clipping at ${width}`);
}

async function semanticContrast(page){
  const rows=await page.evaluate(()=>{
    const rgb=c=>c.match(/[\d.]+/g)?.slice(0,3).map(Number);
    const luminance=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('.session-child span,.session-orchestrator .help,.field>label,.session-orchestrator button.primary')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>{
      let node=e,bg;while(node){const c=getComputedStyle(node).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){bg=c;break;}node=node.parentElement;}
      const color=getComputedStyle(e).color,a=luminance(color),b=luminance(bg);
      return {text:e.textContent.slice(0,60),color,bg,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  });
  assert.ok(rows.length>8,'contrast samples cover real labels/help/children/action');
  assert.deepEqual(rows.filter(r=>r.contrast<4.5),[],'normal semantic text meets 4.5:1; decorative logo/facets excluded');
  return Math.min(...rows.map(r=>r.contrast));
}

test('session UI integration: actual mounted production components, injected native lifecycle',async t=>{
  captures=process.env.FORGE_SESSION_UI_CAPTURE_DIR??await mkdtemp(path.join(os.tmpdir(),'forge-session-ui-integration-'));
  await mkdir(captures,{recursive:true});
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {Chat,Run} from './app/web/src/work.jsx';import SessionRoles from './app/web/src/SessionRoles.jsx';import SessionOrchestrator from './app/web/src/SessionOrchestrator.jsx';
    import './app/web/src/style.css';
    import '@fontsource/manrope/latin-400.css';import '@fontsource/manrope/latin-500.css';import '@fontsource/manrope/latin-600.css';import '@fontsource/manrope/latin-700.css';
    import '@fontsource/ibm-plex-sans-thai/thai-400.css';import '@fontsource/ibm-plex-sans-thai/thai-500.css';import '@fontsource/ibm-plex-sans-thai/thai-600.css';
    const root=createRoot(document.getElementById('app'));
    function Harness({projectId,language='th',mode='chat'}){
      const [state,setState]=useState(null),[busy,setBusy]=useState(false);const read=async()=>setState(await(await fetch('/engineering-state')).json());
      useEffect(()=>{void read();},[projectId]);
      const run=async fn=>{setBusy(true);try{return await fn();}catch{return null;}finally{await read();setBusy(false);}};
      const t=(th,en)=>language==='en'?en:th;const props={t,state,projectId,run,busy,connected:false,mutate:()=>{throw Error('Unexpected domain mutation')}};
      return <main data-engineering-ready={!!state} data-engineering-project={projectId??''} data-engineering-language={language}>
        <p><img src="/forge-mark.svg" width="32" height="32" alt="FORGE"/> ENGINEERING FIXTURE — injected HTTP and native lifecycle</p>
        {state&&(mode==='chat'?<Chat {...props}/>:<><SessionRoles {...props} {...(language==='th'?{t:undefined}:{})}/><SessionOrchestrator {...props} renderRun={r=><Run runRecord={r} {...props}/>}/></>)}
      </main>;
    }
    window.renderSessionUi=args=>root.render(<Harness {...args}/>);window.renderSessionUi(window.initial);
  `},nodePaths:[path.join(dependencyRoot,'node_modules')],bundle:true,write:false,platform:'browser',format:'iife',outfile:'session-ui.js',loader:{'.woff2':'dataurl','.woff':'dataurl'},logLevel:'silent'});
  bundle={js:compiled.outputFiles.find(f=>f.path.endsWith('.js')).text,css:compiled.outputFiles.find(f=>f.path.endsWith('.css')).text};
  browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});t.after(()=>browser.close());
  t.diagnostic(`CAPTURES ${captures}`);

  await t.test('Chat navigation, TH default/EN, task/role/child selection, shipped CSS and colored assets at 320/375/768/1440',async t=>{
    const h=await harness(t),{f,page}=h;await h.open();
    assert.equal(h.requests.filter(x=>x.method!=='state').length,0,'opening the view does not start work');
    const taskSelect=page.getByLabel('Task ที่อนุมัติ',{exact:true});
    assert.deepEqual(await taskSelect.locator('option').evaluateAll(rows=>rows.map(x=>x.value)),['',f.task.id],'only ready/backlog approved tasks with preassigned Orchestrator roles');
    await h.select();assert.equal(await page.locator('.session-orchestrator input[type="checkbox"]').count(),2,'bound role sessions only, including the alternate parent as an eligible child');
    assert.equal(await page.getByRole('button',{name:'อนุมัติและเริ่ม attempt ใหม่',exact:true}).isEnabled(),true);
    const parentSelect=page.getByLabel('เซสชัน Orchestrator',{exact:true});
    const other=f.store.read().events.find(e=>e.type==='session-role.assignment'&&e.conversationId===f.otherParent.id);
    await parentSelect.selectOption(other.id);assert.equal(await page.locator('.session-child').filter({hasText:longName}).getByRole('checkbox').isChecked(),false,'parent change clears child approval draft');
    await h.select();
    const layoutFailures=[],contrasts=[];
    for(const lang of ['th','en']){
      await h.render(f.p.id,lang);await page.getByRole('heading',{name:tr(lang,'บทบาทของเซสชัน','Session roles'),exact:true}).waitFor();
      for(const width of [320,375,768,1440]){try{await fit(page,width);}catch(error){layoutFailures.push(`${lang}: ${error.message}`);}await h.shot(`chat-sessions-${lang}-${width}-dark`);}
      contrasts.push(await semanticContrast(page));
    }
    for(const file of ['app/web/public/forge-mark.svg','apps/website/public/favicon.svg']){
      const svg=await readFile(file,'utf8');assert.deepEqual([...svg.matchAll(/fill="(#[a-f0-9]+)"/g)].map(x=>x[1]),['#f97316','#f2c94c','#8b9199']);
    }
    assert.equal(await page.locator('img[alt="FORGE"]').evaluate(img=>img.complete&&img.naturalWidth>0),true,'real app mark decoded');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByLabel('Conversation',{exact:true}).selectOption(f.child.id);await page.getByLabel('Session bot',{exact:true}).selectOption(f.childBot.id);
    await page.getByLabel('Role',{exact:true}).selectOption('tester');await page.getByRole('button',{name:'Save role',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
    assert.equal(f.roles.state({projectId:f.p.id},f.owner).assignments.find(a=>a.conversationId===f.child.id).role,'tester');
    await page.locator('.session-child').filter({hasText:longName}).getByText(/tester$/).waitFor();
    await page.evaluate(()=>document.documentElement.dataset.theme='light-modern');try{await fit(page,375);}catch(error){layoutFailures.push(`light: ${error.message}`);}await h.shot('chat-sessions-en-375-light');
    const ink=await page.locator('.session-child').filter({hasText:longName}).locator('span').evaluate(e=>({color:getComputedStyle(e).color,ink:getComputedStyle(e).getPropertyValue('--ink').trim()}));
    assert.ok(!['rgb(242, 201, 76)','rgb(139, 145, 153)'].includes(ink.color),'brand secondary accents never replace readable child label ink');
    contrasts.push(await semanticContrast(page));t.diagnostic(`Minimum scoped text contrast ${Math.min(...contrasts).toFixed(2)}:1`);
    await page.setViewportSize({width:768,height:1000});
    await page.evaluate(()=>{
      const proof=document.createElement('section');proof.id='brand-proof';proof.className='panel';proof.innerHTML='<h2>Actual shipped app mark and website favicon — engineering asset proof</h2>';
      for(const src of ['/forge-mark.svg','/favicon.svg'])for(const size of [64,32,16]){const image=document.createElement('img');image.src=src;image.width=size;image.height=size;image.alt=`${src} ${size}px`;proof.append(image);}
      document.querySelector('main').prepend(proof);
    });
    await page.locator('#brand-proof img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    await page.locator('#brand-proof').screenshot({path:path.join(captures,'colored-app-mark-and-website-favicon.png')});
    assert.deepEqual(layoutFailures,[],'all layout failures are collected without skipping later captures or assertions');
  });

  for(const lost of ['intent','start'])await t.test(`lost ${lost} response: reload retains exact create/start identity, one canonical reservation, existing Run controls`,async t=>{
    const h=await harness(t,{language:'en'}),{f,page,requests}=h;await h.open();await h.select();h.faults[lost]={loseResponse:true};
    await page.getByRole('button',{name:'Approve and start new attempt',exact:true}).click();await page.getByRole('alert').filter({hasText:'CONNECTION_LOST'}).waitFor();
    const retained=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`forge.orchestrator-start.${id}`)),f.p.id);
    assert.equal(retained.create.taskId,f.task.id);assert.equal(retained.create.maxMs,300000);
    assert.deepEqual(retained.create.children,[{conversationId:f.child.id,botId:f.childBot.id}]);
    assert.equal(f.calls,lost==='start'?1:0);
    await page.reload();await h.open();await page.getByRole('button',{name:'Check retained request',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Approved task',{exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Check retained request',exact:true}).focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Check retained request',exact:true}).waitFor({state:'detached'});
    assert.equal(f.calls,1);assert.equal(f.store.read().runs.filter(r=>r.sessionContext).length,1);
    const intents=requests.filter(x=>x.path==='/api/session-orchestrator/intent'),starts=requests.filter(x=>x.path==='/api/session-orchestrator/start');
    assert.equal(intents.length,lost==='intent'?2:1);assert.equal(starts.length,lost==='start'?2:1);
    for(const row of intents)assert.deepEqual(row.input,retained.create,'replayed create input never changes');
    const storedIntent=f.store.read().events.find(e=>e.type==='session-route.intent');
    assert.equal(f.store.read().receipts.find(r=>r.intentId===storedIntent.id).operationId,retained.create.operationId);
    for(const row of starts){assert.equal(row.input.operationId,storedIntent.context.operationId);assert.equal(row.input.intentId,storedIntent.id);}
    for(const row of [...intents,...starts])assert.equal(row.csrf,'INJECTED-browser-owner-session','real API helper attaches owner CSRF header');
    const attempts=page.getByRole('region',{name:'Orchestrator attempts'});
    for(const name of ['Watch live events','Detach observation (keeps execution)','Reconnect existing observation','Read recovery snapshot','Reconcile status','Request stop','Recorded events'])assert.equal(await attempts.getByRole('button',{name,exact:true}).isVisible(),true);
    await attempts.getByRole('button',{name:'Reconcile status',exact:true}).click();
    await attempts.getByRole('button',{name:'Read recovery snapshot',exact:true}).click();await attempts.getByText('Persisted recovery snapshot',{exact:true}).waitFor();
    await attempts.getByRole('button',{name:'Request stop',exact:true}).click();await attempts.getByText('interrupted',{exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path.endsWith('/stop')).length,1);assert.equal(f.calls,1,'Run controls do not create another parent');
    await h.shot(`recovered-${lost}-with-run-controls`);
    await fit(page,320);await h.shot(`recovered-${lost}-320-run-controls`);
  });

  await t.test('retained approval can be revoked with the original intent/operation without starting or reviving work',async t=>{
    const h=await harness(t,{language:'en'}),{f,page}=h;await h.open();await h.select();h.faults.start={beforeError:'INJECTED_START_UNAVAILABLE'};
    await page.getByRole('button',{name:'Approve and start new attempt',exact:true}).click();await page.getByRole('alert').filter({hasText:'INJECTED_START_UNAVAILABLE'}).waitFor();
    const retained=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`forge.orchestrator-start.${id}`)),f.p.id);
    assert.ok(retained.intent);await page.getByRole('button',{name:'Revoke retained approval',exact:true}).click();
    await page.getByRole('button',{name:'Check retained request',exact:true}).waitFor({state:'detached'});
    const cancel=h.requests.find(r=>r.method==='cancel').input;
    assert.deepEqual(cancel,{projectId:f.p.id,intentId:retained.intent.intentId,operationId:retained.intent.operationId});
    assert.equal(f.calls,0);assert.equal((await f.route.start(cancel,f.owner)).status,'cancelled');assert.equal(f.calls,0);
    await h.shot('revoked-retained-approval');
  });

  await t.test('busy/loading disables edits; rapid double submit reserves once; 4xx validation remains actionable',async t=>{
    const h=await harness(t,{language:'en'}),{f,page}=h;await h.open();await h.select();
    h.faults.intent={beforeError:'SESSION_ROUTE_OWNER_REQUIRED',status:403};
    await page.getByRole('button',{name:'Approve and start new attempt',exact:true}).click();await page.getByRole('alert').filter({hasText:'SESSION_ROUTE_OWNER_REQUIRED'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Check retained request',exact:true}).count(),0,'definitive create refusal does not trap a retained operation');
    assert.equal(await page.getByLabel('Approved task',{exact:true}).inputValue(),f.task.id,'selection survives refusal');assert.equal(f.calls,0);
    const hold=gate();h.faults.intent={hold};
    // Two synchronous React submit events exercise the ref lock before rerender.
    await page.locator('.session-orchestrator form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await hold.entered;
    assert.equal(await page.getByLabel('Approved task',{exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Orchestrator session',{exact:true}).isDisabled(),true);
    assert.equal(await page.locator('.session-child').filter({hasText:longName}).getByRole('checkbox').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Check retained request',exact:true}).isDisabled(),true);
    await h.shot('orchestrator-loading');hold.release();
    await page.getByRole('region',{name:'Orchestrator attempts'}).waitFor();assert.equal(f.calls,1);
    assert.equal(h.requests.filter(r=>r.method==='intent').length,2,'one refused create and one concurrent submission');assert.equal(h.requests.filter(r=>r.method==='start').length,1);
  });

  await t.test('project switching clears role/prompt/task/child drafts; pending requests remain scoped; empty guidance and real role errors',async t=>{
    const h=await harness(t,{language:'en'}),{f,page}=h;await h.open();await h.select();
    await page.getByLabel('Conversation',{exact:true}).selectOption(f.child.id);await page.getByLabel('Session bot',{exact:true}).selectOption(f.childBot.id);await page.getByLabel('Role',{exact:true}).selectOption('designer');
    await page.getByLabel('Child prompt',{exact:true}).fill('PRIVATE PROJECT DRAFT');
    await h.render(f.q.id,'en');await page.getByLabel('Child prompt',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Child prompt',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Conversation',{exact:true}).inputValue(),'');
    await page.getByText('Assign an Orchestrator role and prepare a ready task first.',{exact:true}).waitFor();
    assert.equal(await page.getByText(longName,{exact:true}).count(),0,'foreign project never displays private session/task names');
    await h.shot('empty-foreign-project');
    await h.render(f.p.id,'en');assert.equal(await page.getByLabel('Approved task',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Orchestrator session',{exact:true}).inputValue(),'');
    await page.getByLabel('Conversation',{exact:true}).selectOption(f.child.id);await page.getByLabel('Session bot',{exact:true}).selectOption(f.childBot.id);
    await f.assign(f.child.id,f.childBot.id,'reviewer',1);await page.getByRole('button',{name:'Refresh state',exact:true}).click();await page.getByRole('alert').filter({hasText:'Role changed'}).waitFor();
    await page.getByRole('button',{name:'Save role',exact:true}).click();await page.getByRole('alert').filter({hasText:'REVISION_CONFLICT'}).waitFor();
    await page.getByRole('button',{name:'Check same operation',exact:true}).waitFor();await h.shot('real-role-conflict');
    await page.getByRole('button',{name:'Acknowledge after checking state',exact:true}).click();await page.getByRole('region',{name:'Uncertain command'}).waitFor({state:'detached'});
    await page.getByRole('button',{name:'Load current role',exact:true}).click();assert.equal(await page.getByLabel('Role',{exact:true}).inputValue(),'reviewer');
    // Leave a lost create in project A, switch to B, return to A: no cross-scope
    // controls or drafts, but the exact uncertain operation remains recoverable.
    await h.select();h.faults.intent={loseResponse:true};await page.getByRole('button',{name:'Approve and start new attempt',exact:true}).click();await page.getByRole('alert').filter({hasText:'CONNECTION_LOST'}).waitFor();
    const pending=await page.evaluate(id=>sessionStorage.getItem(`forge.orchestrator-start.${id}`),f.p.id);
    await h.render(f.q.id,'en');assert.equal(await page.getByRole('button',{name:'Check retained request',exact:true}).count(),0);
    await h.render(f.p.id,'en');await page.getByRole('button',{name:'Check retained request',exact:true}).waitFor();
    assert.equal(await page.evaluate(id=>sessionStorage.getItem(`forge.orchestrator-start.${id}`),f.p.id),pending);assert.equal(f.calls,0);
  });

  await t.test('existing SessionRoles fallback TH, real link/prompt services, lost prompt replay, Stop/reconcile/revoke and narrow uncertainty',async t=>{
    const h=await harness(t,{mode:'standalone'}),{f,page}=h;
    await f.store.transaction(s=>{find(s,'runs',f.parent.id).status='running';});
    await h.open();await page.getByRole('heading',{name:'บทบาทของเซสชัน',exact:true}).waitFor();
    await h.render(f.p.id,'en','standalone');await page.getByRole('button',{name:'Refresh state',exact:true}).click();
    await page.getByLabel('Parent orchestrator run',{exact:true}).selectOption(f.parent.id);
    const child=f.roles.state({projectId:f.p.id},f.owner).assignments.find(a=>a.conversationId===f.child.id);
    await page.getByLabel('Bound child session',{exact:true}).selectOption(child.id);await page.getByRole('button',{name:'Approve child link',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
    const membership=f.roles.state({projectId:f.p.id},f.owner).memberships.filter(m=>m.usable).at(-1);assert.ok(membership);
    await page.getByLabel('Approved child',{exact:true}).selectOption(membership.id);await page.getByLabel('Child prompt',{exact:true}).fill('INJECTED lifecycle: review evidence, no paid turn.');
    h.faults.prompt={loseResponse:true};await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.getByRole('region',{name:'Uncertain command'}).waitFor();assert.equal(f.ownerLifecycle.calls,1);
    await fit(page,320);await h.shot('session-roles-uncertain-en-320');
    await page.getByRole('button',{name:'Check same operation',exact:true}).click();await page.getByRole('region',{name:'Uncertain command'}).waitFor({state:'detached'});
    const prompts=h.requests.filter(r=>r.method==='prompt');assert.equal(prompts.length,2);assert.deepEqual(prompts[0].input,prompts[1].input);assert.equal(f.ownerLifecycle.calls,1);
    await page.getByRole('button',{name:'Stop prompt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');assert.equal(f.ownerLifecycle.stopCalls,1);
    await page.getByRole('button',{name:'Reconcile',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
    await page.locator('.history-row').last().getByRole('button',{name:'Revoke link',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Result recorded');
    assert.equal(f.roles.state({projectId:f.p.id},f.owner).memberships.find(m=>m.id===membership.id).status,'revoked');
    await h.shot('session-roles-stopped-revoked-en-320');
    await h.render(null,'th','standalone');await page.getByText('เลือกโปรเจกต์ก่อน',{exact:true}).waitFor();
  });

  await t.test('late create response after a project switch cannot start or alter the other project; original create remains recoverable',async t=>{
    const h=await harness(t,{language:'en'}),{f,page}=h;await h.open();await h.select();
    const hold=gate();h.faults.intent={hold};
    await page.getByRole('button',{name:'Approve and start new attempt',exact:true}).click();await hold.entered;
    const retained=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`forge.orchestrator-start.${id}`)),f.p.id);
    await h.render(f.q.id,'en');hold.release();
    await page.getByRole('button',{name:'Refresh state',exact:true}).click();
    assert.equal(f.calls,0);assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('button',{name:'Check retained request',exact:true}).count(),0);
    await h.render(f.p.id,'en');await page.getByRole('button',{name:'Check retained request',exact:true}).click();
    await page.getByRole('region',{name:'Orchestrator attempts'}).waitFor();assert.equal(f.calls,1);
    const intents=h.requests.filter(r=>r.method==='intent');assert.equal(intents.length,2);assert.deepEqual(intents[0].input,retained.create);assert.deepEqual(intents[1].input,retained.create);
    assert.equal(h.requests.filter(r=>r.method==='start').length,1);
  });

  await writeFile(path.join(captures,'scope.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),surfaces:['Chat','SessionRoles','SessionOrchestrator','Run'],nativeLifecycle:'INJECTED; no installed/native/provider qualification',http:'Playwright route interception; real role/session-route services with opaque fixture Owner; NOT real HTTP/CSRF admission',widths:[320,375,768,1440],languages:['th','en'],dependencyRoot},null,2));
});
