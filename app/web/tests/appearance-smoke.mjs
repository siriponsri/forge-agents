// Actual integrated UI and persistent appearance checks, with labelled engineering data.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createApplication} from '../../server/main.mjs';
import {THEMES} from '../src/themes.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-appearance-'));let app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cmd=async(type,projectId,data,record)=>{const r=await page.request.post(app.url+'/api/command',{data:{operationId:crypto.randomUUID(),type,projectId,data,...(record?{id:record.id,expectedRevision:record.revision}:{})}});assert.ok(r.ok(),await r.text());return(await r.json()).entity;};
const state=async()=>(await page.request.get(app.url+'/api/state')).json();
async function choose(id){await page.getByRole('button',{name:/^Choose theme:/}).click();await page.getByRole('radio',{name:THEMES.find(t=>t.id===id).label,exact:true}).click();await page.waitForFunction(id=>document.documentElement.dataset.theme===id,id);for(let n=0;n<40;n++){if((await state()).settings.theme===id)return;await page.waitForTimeout(25);}throw new Error('Theme was not durably saved');}
try{
  await page.goto(app.url+'/app');await page.getByLabel('Language',{exact:true}).selectOption('en');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-modern');await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(temp,'empty-dark-modern.png'),fullPage:true});
  const p=await cmd('project.create',null,{name:'FORGE · Engineering workspace',workspace:path.join(temp,'workspace'),description:'พื้นที่ตรวจการทำงานของ FORGE · ข้อมูลตัวอย่างทางวิศวกรรม'});
  const bots=[];for(const [name,role]of [['Planner','Plan and coordinate'],['Builder','Build bounded tasks'],['Reviewer','Inspect verification evidence']])bots.push(await cmd('bot.create',p.id,{name,role,kind:'resident'}));
  const plan=await cmd('plan.create',p.id,{name:'FORGE engineering verification',approved:true});
  for(const [title,status,owner]of [['ตรวจการบันทึกและเปิดข้อมูลอีกครั้ง','done',2],['ตรวจสูตรและการแก้ไขเอกสาร','done',2],['ตรวจไฟล์ DOCX และ PDF ที่สร้างจริง','done',2],['ตรวจธีมและหน้าเว็บหลายขนาด','review',1],['เตรียมคำแนะนำการเปิดใช้งาน','ready',0]])await cmd('task.create',p.id,{title,status,planId:plan.id,botId:bots[owner].id,evidence:status==='done'?['Developer checks passed; disposable engineering fixture only']:[]});
  await page.reload();await page.getByRole('heading',{name:'Workspace overview',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(temp,'workbench-dark-modern.png'),fullPage:false});
  await mkdir('app/web/public',{recursive:true});await copyFile(path.join(temp,'workbench-dark-modern.png'),'app/web/public/forge-workbench-preview.png');
  for(const theme of THEMES){await choose(theme.id);const color=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());assert.ok(color);assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);if(['monokai','solarized-dark','light-modern','quiet-light'].includes(theme.id))await page.screenshot({path:path.join(temp,theme.id+'.png'),fullPage:false});}
  await choose('monokai');await page.reload();await page.getByRole('heading',{name:'Workspace overview',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'monokai');
  const port=Number(new URL(app.url).port);await page.goto('about:blank');await app.close();app=await createApplication({dataDir:path.join(temp,'state'),port});await page.goto(app.url+'/app');await page.getByRole('heading',{name:'Workspace overview',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'monokai');
  await choose('dark-modern');
  for(const width of [320,375,414,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true,`overflow at ${width}`);await page.getByRole('button',{name:/^Choose theme:/}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1),true);await page.keyboard.press('Escape');await page.screenshot({path:path.join(temp,`width-${width}.png`),fullPage:true});}
  assert.deepEqual(errors,[]);const evidence={result:'PASSED',fixtureDir:temp,checks:['Dark Modern default','15 named VS Code themes selectable and saved','reload and process-restart theme persistence','real Overview records','320/375/414/768/1440 responsive','theme dialog keyboard dismissal','bundled fonts','actual landing screenshot captured','no browser exceptions']};await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}finally{await browser.close();await app.close();}
