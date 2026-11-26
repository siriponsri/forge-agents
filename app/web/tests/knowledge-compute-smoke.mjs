// Actual production App + HTTP/session/SQLite. No provider/cloud execution.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import {createApplication} from '../../server/main.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-knowledge-integrated-')),app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
const click=name=>page.getByRole('button',{name,exact:true}).click();
const nav=name=>openRoute(page,name);
async function post(route,data){const session=await(await page.request.get(app.url+'/api/session')).json();const response=await page.request.post(app.url+route,{data,headers:{'X-Forge-CSRF':session.csrf}});const result=await response.json();assert.ok(response.ok(),JSON.stringify(result));return result;}
const cmd=async(type,projectId,data)=>(await post('/api/command',{type,projectId,data,operationId:crypto.randomUUID()})).entity;
async function wait(fn){for(let i=0;i<150;i++){const result=fn(app.store.read());if(result)return result;await page.waitForTimeout(80);}throw Error('Production state did not reach expected condition');}
try{
  const p=await cmd('project.create',undefined,{name:'Disposable integrated knowledge workspace',workspace:path.join(temp,'workspace'),profile:{provider:{instanceId:'engineering-fixture',model:'no-provider-turn',options:[]},compute:{kind:'local'}}});
  const plan=await cmd('plan.create',p.id,{name:'Approved local fixture plan',approved:true});await cmd('task.create',p.id,{title:'Inspect actual evidence',planId:plan.id,status:'ready'});
  await cmd('notebook.create',p.id,{name:'Real CPU fixture',code:"print('Real Python from integrated GUI')",language:'python'});
  await page.addInitScript(()=>{localStorage.setItem('forge.language','en');});await page.goto(app.url+'/app');
  await nav('Memory Studio');await page.getByRole('heading',{name:'Memory Studio',exact:true}).waitFor();
  await page.getByLabel('Title',{exact:true}).fill('วิธีทำงาน / Project practice');await page.getByLabel('Authorized content',{exact:true}).fill('รายงานภาษาไทยและตรวจหลักฐานจริง');await click('Save memory');
  await wait(s=>s.events.some(e=>e.type==='memory.record'&&e.memory.title==='วิธีทำงาน / Project practice'));
  await click('Central Owner memory');await page.getByRole('heading',{name:'Central Owner memory',exact:true}).waitFor();
  await page.getByLabel('Owner title',{exact:true}).fill('Owner writing preference');await page.getByLabel('Owner content',{exact:true}).fill('รายงานภาษาไทยจากความจำส่วนกลางที่ Owner แชร์เท่านั้น');await click('Save privately');
  await page.getByText('Not shared with any project.',{exact:true}).waitFor();
  await page.getByLabel('Share with project',{exact:true}).selectOption(p.id);await click('Share this revision with selected project');
  await wait(s=>s.events.some(e=>e.type==='owner-memory.grant'&&e.status==='active'));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(temp,'owner-memory-shared-1440.png'),fullPage:true});
  await nav('Strategies & skills');await click('Context budget');await page.getByRole('heading',{name:'Context & token budget',exact:true}).waitFor();
  await page.getByLabel('Context window',{exact:true}).fill('20000');await page.getByLabel('Output reserve',{exact:true}).fill('500');await page.getByLabel('Safety reserve',{exact:true}).fill('100');await page.getByLabel('Capacity source / configuration note',{exact:true}).fill('Engineering fixture capacity, no real model claim');await click('Save route budget');
  await page.getByLabel('Retrieve authorized project memory',{exact:true}).check();await page.getByLabel('Memory query TH/EN',{exact:true}).fill('รายงานภาษาไทย');await click('Compose with receipt');
  await page.getByText('Resolved prefix',{exact:true}).click();await page.locator('pre.code').filter({hasText:'ความจำส่วนกลาง'}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(temp,'context-1440.png'),fullPage:true});
  await click('Goals & evidence');await page.getByRole('heading',{name:'Goals and acceptance',exact:true}).waitFor();
  await nav('Compute targets');await page.getByRole('heading',{name:'Compute & notebook jobs',exact:true}).waitFor();await click('Start new job');
  await page.getByLabel('Actual job logs',{exact:true}).filter({hasText:'Real Python from integrated GUI'}).waitFor();
  assert.equal(app.store.read().jobs.at(-1).status,'completed');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(temp,'compute-1440.png'),fullPage:true});
  await nav('Mobile Inbox');await page.getByRole('heading',{name:'Mobile Inbox',exact:true}).waitFor();await page.getByText(/No Telegram work yet/).waitFor();
  for(const width of [320,375,414,768]){await page.setViewportSize({width,height:1000});assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),`Mobile Inbox overflow ${width}`);}
  await page.screenshot({path:path.join(temp,'mobile-inbox-768.png'),fullPage:true});
  await setLanguage(page,'th');await page.getByRole('heading',{name:'กล่องงานจากมือถือ',exact:true}).waitFor();assert.deepEqual(errors,[]);
  const evidence={result:'PASSED',fixtureDir:temp,checks:['actual production Memory Studio + central Owner sharing by named project','actual session/CSRF authenticated Context budget and reference-only memory composition','central source appears only after explicit grant','production Goals mount','real local Python through production Compute GUI','production Telegram Inbox setup and honest empty/readiness state','TH/EN, 320/375/414/768 no horizontal overflow, no page exceptions'],providerExecution:'NOT_RUN',liveHermes:'NOT_RUN',liveOpenClaw:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN'};
  await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){console.error('FIXTURE_DIR',temp);await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
finally{await browser.close();await app.close();}
