import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {serve} from '../scripts/serve.mjs';
const evidenceDir=await mkdtemp(join(tmpdir(),'forge-public-website-'));
const app=await serve();
const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();const errors=[],requests=[],checks=[],a11y=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
page.on('request',r=>requests.push(r.url()));
async function fits(label) {
  const overflow=await page.evaluate(()=>{
    const w=innerWidth;return [...document.querySelectorAll('body *')].filter(e=>{
      const c=getComputedStyle(e),r=e.getBoundingClientRect();return r.width&&r.height&&c.visibility!=='hidden'&&c.display!=='none'&&!e.closest('.sr-only,.skip-link,svg,.screenshot-button')&&(r.right>w+1||r.left< -1);
    }).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,50)})).slice(0,8);
  });
  assert.deepEqual(overflow,[],label);assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),label+' html');
}
async function audit(label){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();a11y.push({label,violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],label+' accessibility')}
async function shot(name){await page.screenshot({path:join(evidenceDir,name+'.png'),fullPage:true})}
async function verticalTabs(label){
  const tabs=page.getByRole('tab'),list=page.getByRole('tablist');
  assert.equal(await list.getAttribute('aria-orientation'),'vertical',label);
  await tabs.nth(0).click();await tabs.nth(0).focus();
  for(const [key,index] of [['ArrowDown',1],['ArrowUp',0],['End',3],['Home',0],['ArrowUp',3],['ArrowDown',0],['ArrowRight',0],['ArrowLeft',0]]){
    await page.keyboard.press(key);
    await page.waitForFunction(index=>document.querySelectorAll('[role=tab]')[index]?.getAttribute('aria-selected')==='true',index);
    assert.equal(await tabs.nth(index).evaluate(e=>e===document.activeElement),true,`${label} ${key} focus`);
    assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),await tabs.nth(index).getAttribute('id'),`${label} ${key} panel`);
    if(key==='ArrowDown'&&index===1&&/375|1440/.test(label))await shot(`keyboard-${label.replaceAll(' ','-')}`);
  }
}
try {
  for(const lang of ['th','en'])for(const theme of ['light','dark'])for(const width of [320,375,768,1440]){
    await page.setViewportSize({width,height:1000});
    await page.addInitScript(theme=>localStorage.setItem('forge.website.theme',theme),theme);
    await page.goto(app.url+`/${lang}/`);await page.evaluate(()=>document.fonts.ready);
    await page.getByRole('tab',{name:/FORGE core/}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    await fits(`${lang} ${theme} ${width}`);await audit(`${lang} ${theme} ${width}`);
    await shot(`home-${lang}-${theme}-${width}`);
    for(const name of ['T3 + AG-UI','Your connections','Work you can inspect']){await page.getByRole('tab',{name:new RegExp(name.replaceAll('+','\\+'))}).click();await fits(`${name} ${lang} ${theme} ${width}`)}
    if(width===1440)await shot(`architecture-${lang}-${theme}`);
    await verticalTabs(`${lang} ${theme} ${width}`);
  }
  checks.push('Home and all architecture layers: TH/EN × light/dark × 320/375/768/1440; no overflow; 16 WCAG AA axe audits; actual vertical Up/Down, Home/End, wrapping, focus and panel assertions in every variant');
  for(const lang of ['th','en'])for(const theme of ['light','dark'])for(const width of [375,1440])for(const route of ['docs','install','download','changelog','github']) {
    await page.setViewportSize({width,height:1000});await page.addInitScript(theme=>localStorage.setItem('forge.website.theme',theme),theme);
    await page.goto(`${app.url}/${lang}/${route}/`);await page.evaluate(()=>document.fonts.ready);await fits(`${route} ${lang} ${theme} ${width}`);
    await audit(`${route} ${lang} ${theme} ${width}`);
    if(['github','changelog'].includes(route)||(width===375&&theme==='dark'&&lang==='th'))await shot(`${route}-${lang}-${theme}-${width}`);
    assert.equal(await page.getByRole('heading',{level:1}).count(),1);
    if(route==='download'){assert.equal(await page.locator('a[href*="/releases/download/"]').count(),0);await page.getByRole('link',{name:lang==='th'?'อ่านวิธีติดตั้งจาก source':'Read source setup instructions'}).click();await page.waitForURL('**/install/')}
  }
  checks.push('All 10 localized inner routes × both themes × 375/1440; 40 axe AA audits; missing release has source guide action and zero executable links');
  await page.setViewportSize({width:1440,height:1000});await page.goto(app.url+'/en/');
  await page.getByRole('button',{name:'Developer verified',exact:true}).click();assert.equal(await page.locator('.capability').count(),7);
  await page.getByRole('button',{name:'Planned',exact:true}).click();assert.equal(await page.locator('.capability').count(),1);
  await page.getByRole('button',{name:'All capabilities',exact:true}).click();assert.equal(await page.locator('.capability').count(),16);
  await page.getByRole('link',{name:'Open full-resolution workbench screenshot'}).click();await page.waitForURL('**/forge-workbench.png');assert.equal(await page.locator('img').evaluate(e=>e.naturalWidth),1440);await page.goBack();
  assert.equal(await page.locator('.layer-content[data-state=active]').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.getByRole('link',{name:'เปลี่ยนเป็นภาษาไทย'}).click();await page.waitForURL('**/th/');
  await page.getByRole('button',{name:'ใช้ธีมสว่าง'}).click();
  const persisted=await context.newPage();await persisted.goto(app.url+'/th/');await persisted.getByRole('button',{name:'ใช้ธีมมืด'}).waitFor();assert.equal(await persisted.locator('html').getAttribute('data-theme'),'light');await persisted.reload();assert.equal(await persisted.locator('html').getAttribute('data-theme'),'light');await persisted.close();
  await page.setViewportSize({width:320,height:1000});await page.getByRole('button',{name:'เปิดเมนู'}).click();await fits('mobile navigation');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'เปิดเมนู'}).getAttribute('aria-expanded'),'false');
  await page.goto(app.url+'/en/docs/');await page.keyboard.press('Tab');assert.equal(await page.getByRole('link',{name:'Skip to content'}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');assert.equal(await page.locator('#main').evaluate(e=>e===document.activeElement),true);
  checks.push('Keyboard Radix arrow-key tabs, capability filters, full-resolution screenshot, locale routes, theme persistence, 320px menu Escape and skip-link focus; reduced motion');
  await page.emulateMedia({forcedColors:'active'});await fits('forced colors');await shot('forced-colors-320');
  await page.emulateMedia({forcedColors:'none'});
  const nojs=await browser.newContext({javaScriptEnabled:false});const read=await nojs.newPage();await read.goto(app.url+'/en/install/');assert.equal(await read.getByRole('heading',{name:'Get the source',exact:true}).count(),1);await nojs.close();
  const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked')}}));const b=await blocked.newPage();await b.goto(app.url+'/th/');await b.getByRole('tab',{name:/FORGE core/}).waitFor();await b.getByRole('button',{name:/ใช้ธีม/}).click();await blocked.close();
  checks.push('Prerendered no-JavaScript install content; optional localStorage failure; forced colors');
  // Validate actual local links and fragment targets from every shipped route.
  for(const lang of ['th','en'])for(const route of ['','docs/','install/','download/','changelog/','github/']){
    await page.goto(`${app.url}/${lang}/${route}`);
    const links=await page.locator('a').evaluateAll(es=>es.map(e=>e.getAttribute('href')).filter(Boolean));
    for(const link of new Set(links.filter(l=>l.startsWith('/')))) {const u=new URL(link,app.url);const response=await page.request.get(u.href);assert.equal(response.status(),200,link);if(u.hash){const html=await response.text();assert.ok(html.includes(`id="${u.hash.slice(1)}"`),link)}}
  }
  checks.push('Every internal route and fragment resolves in the standalone build');
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.startsWith(app.url)), 'No third-party runtime or private API requests');
  assert.ok(!requests.some(r=>/\/api\/|\/downloads\//.test(r)),'No private runtime endpoints');
  const headers=await readFile('dist/_headers','utf8');assert.ok(headers.includes("default-src 'none'"));assert.ok(headers.includes('frame-ancestors \'none\''));
  const report={result:'PASSED',checks,a11yAuditCount:a11y.length,violations:a11y.flatMap(a=>a.violations),pageErrors:errors,requestsStayLocal:true,evidenceDir,releaseSnapshot:JSON.parse(await readFile('public/releases.json','utf8')),deployment:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN',macosNative:'NOT_RUN'};
  await writeFile(join(evidenceDir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await shot('failure').catch(()=>{});console.error('EVIDENCE_DIR',evidenceDir);throw e}finally{await context.close();await browser.close();await app.close()}
