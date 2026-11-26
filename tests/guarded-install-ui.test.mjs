// Disposable rendered UI fixtures. No actual build/install/check/provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
test('Guarded setup TH/EN rendered states, keyboard, narrow layout and exact action bodies',async t=>{
  const dependencies=createRequire(path.join(process.env.FORGE_GUARDED_TEST_DEPENDENCIES??repo,'package.json'));
  const {build}=await import(pathToFileURL(dependencies.resolve('vite')).href),{chromium}=dependencies('playwright');
  const component=path.join(repo,'app/web/src/GuardedSetup.jsx').replaceAll('\\','/');
  const result=await build({root:repo,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:[{find:/^react$/,replacement:dependencies.resolve('react')},{find:/^react-dom\/client$/,replacement:dependencies.resolve('react-dom/client')}]},plugins:[{name:'guarded-fixture',resolveId(id){if(id==='guarded-fixture'||id.replaceAll('\\','/').endsWith('/guarded-fixture'))return '\0guarded-fixture';},load(id){if(id==='\0guarded-fixture')return `import React from 'react';import{createRoot}from'react-dom/client';import GuardedSetup from ${JSON.stringify(component)};const root=createRoot(document.getElementById('root'));window.__unmount=()=>root.unmount();root.render(React.createElement(GuardedSetup,{t:(th,en)=>window.__lang==='th'?th:en,state:window.__setup,projectId:window.__project,run:fn=>fn(),busy:false}));`;}}],build:{write:false,lib:{entry:'guarded-fixture',name:'GuardedFixture',formats:['iife']},minify:false}});
  const output=Array.isArray(result)?result[0].output:result.output,js=output.find(f=>f.type==='chunk').code,css=output.filter(f=>f.type==='asset'&&f.fileName.endsWith('.css')).map(f=>f.source).join('\n');
  const style=await fs.readFile(path.join(repo,'app/web/src/style.css'),'utf8'),themes=await fs.readFile(path.join(repo,'app/web/src/themes.css'),'utf8');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),calls=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>process.stderr.write(error.message+'\n'));
  const screenshots=process.env.FORGE_GUARDED_UI_EVIDENCE;
  if(screenshots)await fs.mkdir(path.resolve(screenshots),{recursive:true});
  async function render(status,lang,width=375){
    await page.evaluate(()=>window.__unmount?.());await page.setViewportSize({width,height:900});await page.setContent(`<html lang="${lang}"><head><style>${themes}\n${style}\n${css}</style></head><body style="margin:0"><main style="padding:24px 20px"><div id="root"></div></main></body></html>`);
    const installation={status,operationId:'existing-setup-0001',progress:{stage:'opencode-build',completed:6,total:11},checkRequired:true,...(status==='failed'?{error:{code:'INSTALL_INTERRUPTED',action:'reconcile-installed-files'},recovery:'reconcile-required'}:{})};
    await page.evaluate(({installation,lang})=>{crypto.randomUUID??=()=> '11111111-1111-4111-8111-111111111111';window.__project=installation.status==='no-project'?null:'fixture-project';window.__setup=['loading','network-error'].includes(installation.status)?null:{installation,readiness:null};window.__lang=lang;window.__calls=[];window.fetch=async(url,opts)=>{const body=opts?.body?JSON.parse(opts.body):null;window.__calls.push({url,body});if(installation.status==='loading')return new Promise(()=>{});if(installation.status==='network-error')throw Error('fixture disconnect');return {ok:true,status:200,json:async()=>url==='/api/session'?{csrf:'fixture-csrf'}:{installation,readiness:null}};};},{installation,lang});
    await page.addScriptTag({content:js});await page.getByRole('heading',{level:2}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${status}/${lang}/${width} overflow`);
    return installation;
  }
  for(const lang of ['th','en'])for(const status of ['missing','preparing','ready','failed','cancelled']){
    await render(status,lang);if(screenshots)await page.screenshot({path:path.join(path.resolve(screenshots),`${status}-${lang}-375.png`),fullPage:true});
    if(status==='ready'){await page.getByRole('button',{name:lang==='th'?'ทดสอบการเชื่อมต่อ':'Check installed route',exact:true}).click();const c=await page.evaluate(()=>window.__calls.find(c=>c.url==='/api/guarded/check'));assert.equal(c.body.projectId,'fixture-project');assert.deepEqual(Object.keys(c.body).sort(),['operationId','projectId']);}
    if(status==='preparing'){await page.getByRole('button',{name:lang==='th'?'ยกเลิกการตั้งค่า':'Cancel setup',exact:true}).click();const c=await page.evaluate(()=>window.__calls.find(c=>c.url==='/api/guarded/cancel'));assert.equal(c.body.operationId,'existing-setup-0001');}
  }
  for(const lang of ['th','en']){await render('loading',lang);await page.getByRole('status').filter({hasText:lang==='th'?'กำลังอ่านสถานะ':'Loading setup'}).waitFor();await render('no-project',lang);await page.getByRole('status').filter({hasText:lang==='th'?'เลือกโปรเจกต์':'Choose a project'}).waitFor();await render('network-error',lang);await page.getByRole('alert').waitFor();}
  await render('ready','en',1100);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').evaluate(e=>e.tagName),'SELECT');
  for(const leaseMs of [900000,3600000]){await page.getByRole('combobox',{name:'Route check lifetime'}).selectOption(String(leaseMs));await page.getByRole('button',{name:'Check installed route',exact:true}).click();const c=await page.evaluate(()=>window.__calls.filter(c=>c.url==='/api/guarded/check').at(-1));assert.equal(c.body.leaseMs,leaseMs);assert.deepEqual(Object.keys(c.body).sort(),['leaseMs','operationId','projectId']);}
  if(screenshots)await page.screenshot({path:path.join(path.resolve(screenshots),'ready-en-1100.png'),fullPage:true});
  await render('missing','en');await page.getByRole('button',{name:'Install Guarded',exact:true}).click();calls.push(...await page.evaluate(()=>window.__calls));
  const install=calls.find(c=>c.url==='/api/guarded/install');assert.equal(install.body.projectId,'fixture-project');assert.match(install.body.operationId,/^[a-f0-9-]{36}$/);
  assert.ok(calls.every(c=>!JSON.stringify(c).includes('executable')));
});
