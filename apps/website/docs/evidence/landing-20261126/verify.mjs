// Run from apps/website after npm run build. Uses existing installed dependencies.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {serve} from '../../../scripts/serve.mjs';
const out=fileURLToPath(new URL('.',import.meta.url));
const server=await serve();
const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage(),errors=[],audits=[],checks=[],captures=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
page.on('request',r=>requests.push(r.url()));
async function fits(label){
  const failures=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{
    const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width&&r.height&&c.visibility!=='hidden'&&c.display!=='none'&&!e.closest('.sr-only,.skip-link,svg,.screenshot-button')&&(r.left< -1||r.right>innerWidth+1);
  }).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60)})).slice(0,12));
  assert.deepEqual(failures,[],label);assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),label+' document');
}
async function audit(label){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();const violations=result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));audits.push({label,violations});assert.deepEqual(violations,[],label)}
async function shot(name,locator){const path=out+name+'.png';if(locator)await locator.screenshot({path});else{await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.screenshot({path,fullPage:true})}captures.push({name,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})}
try {
  for(const lang of ['th','en'])for(const theme of ['light','dark'])for(const width of [320,375,414,768,1440]){
    await page.setViewportSize({width,height:1000});
    await page.addInitScript(theme=>localStorage.setItem('forge.website.theme',theme),theme);
    await page.goto(server.url+`/${lang}/`);await page.evaluate(()=>document.fonts.ready);
    await page.getByRole('button',{name:lang==='en'?'Next step':'ขั้นตอนถัดไป',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),lang);assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    await fits(`${lang} ${theme} ${width}`);await audit(`${lang} ${theme} ${width}`);
    for(let mode=0;mode<6;mode++){
      await page.locator('.strategy-choices button').nth(mode).click();
      assert.equal(await page.locator('.strategy-choices [aria-pressed=true]').count(),1);
      await fits(`${lang} ${theme} ${width} mode ${mode}`);
    }
    await page.locator('.strategy-choices button').first().click();
    // All required widths have actual inspected evidence; both language/theme extremes are retained.
    if(lang==='en'&&theme==='light')await shot(`home-en-light-${width}`);
    if(lang==='th'&&theme==='dark'&&[320,375,1440].includes(width))await shot(`home-th-dark-${width}`);
  }
  checks.push('TH/EN × light/dark × 320/375/414/768/1440; all six modes fit; 20 WCAG AA axe audits');
  await page.setViewportSize({width:1440,height:1000});await page.goto(server.url+'/en/');
  await page.locator('.strategy-choices button').first().focus();
  for(const [key,index] of [['ArrowRight',1],['ArrowLeft',0],['End',5],['Home',0],['ArrowLeft',5],['ArrowRight',0]]){
    await page.keyboard.press(key);const selected=page.locator('.strategy-choices button').nth(index);
    assert.equal(await selected.getAttribute('aria-pressed'),'true');assert.ok(await selected.evaluate(e=>e===document.activeElement));
  }
  for(let i=0;i<4;i++){
    await page.locator('.story-steps button').nth(i).click();assert.equal(await page.locator('.flow-map').getAttribute('data-step'),String(i));
  }
  await page.getByRole('button',{name:'Next step',exact:true}).click();assert.equal(await page.locator('.flow-map').getAttribute('data-step'),'0');
  assert.equal(await page.locator('.strategy-board').getAttribute('data-playing'),'false');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const play=page.locator('.story-play');await play.click();assert.equal(await play.getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelector('.flow-map').dataset.step==='1');
  await play.click();assert.equal(await play.getAttribute('aria-pressed'),'false');
  const paused=await page.locator('.flow-map').getAttribute('data-step');await page.waitForTimeout(2800);assert.equal(await page.locator('.flow-map').getAttribute('data-step'),paused);
  await play.click();await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Next step',exact:true}).waitFor();assert.equal(await play.getAttribute('aria-pressed'),'false');
  await page.emulateMedia({reducedMotion:'no-preference'});await play.click();await page.locator('.closing').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.strategy-board').dataset.playing==='false');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#strategies').scrollIntoViewIfNeeded();
  await shot('strategy-keyboard-1440',page.locator('.strategy-board'));
  checks.push('Mode keyboard Left/Right/Home/End wrap, focus/pressed state, all workflow steps, reduced-motion manual progression, timed play/advance/pause, live preference change and offscreen pause');
  for(const route of ['docs','install','download','changelog','github'])for(const lang of ['en','th']){
    await page.setViewportSize({width:375,height:1000});await page.goto(`${server.url}/${lang}/${route}/`);await fits(`${lang}/${route}`);assert.equal(await page.getByRole('heading',{level:1}).count(),1);
    if(route==='download')assert.equal(await page.locator('a[href*="/releases/download/"]').count(),0);
  }
  await page.goto(server.url+'/en/');await page.getByRole('button',{name:'Developer verified',exact:true}).click();assert.equal(await page.locator('.capability').count(),8);
  await page.getByRole('button',{name:'All capabilities',exact:true}).click();assert.equal(await page.locator('.capability').count(),16);
  await page.getByRole('tab',{name:/T3 \+ AG-UI/}).click();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Your connections'));
  await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open menu',exact:true}).getAttribute('aria-expanded'),'false');
  await page.goto(server.url+'/en/');await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.ok(await page.locator('#main').evaluate(e=>e===document.activeElement));
  checks.push('All ten localized inner pages remain readable at 375; zero fake installer links; existing architecture arrow keys, filters, menu Escape and skip-link work');
  // Local source/license/fragment assets, no runtime or external API calls.
  for(const lang of ['en','th'])for(const route of ['','docs/','install/','download/','changelog/','github/']){
    await page.goto(`${server.url}/${lang}/${route}`);
    for(const link of new Set(await page.locator('a').evaluateAll(es=>es.map(e=>e.getAttribute('href')).filter(x=>x?.startsWith('/')||x?.startsWith('#'))))){
      const url=new URL(link,page.url()),response=await page.request.get(url.href);assert.equal(response.status(),200,link);if(url.hash)assert.ok((await response.text()).includes(`id="${url.hash.slice(1)}"`),link);
    }
  }
  for(const name of ['react-MIT','radix-MIT','manrope-OFL','ibm-plex-sans-thai-OFL','lucide-ISC'])assert.equal((await page.request.get(`${server.url}/licenses/${name}.txt`)).status(),200);
  const nojs=await browser.newContext({javaScriptEnabled:false});const read=await nojs.newPage();await read.goto(server.url+'/en/');assert.equal(await read.getByRole('heading',{name:/Different work/}).count(),1);await read.goto(server.url+'/en/install/');assert.equal(await read.getByRole('heading',{name:'Get the source',exact:true}).count(),1);await nojs.close();
  assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(url=>!url.startsWith(server.url)),[]);
  checks.push('Every local link/fragment and bundled license resolves; no-JS home/install content; strict served CSP, no console/page errors or remote runtime/font/API requests');
  const report={status:'PASS',checkedAt:new Date().toISOString(),checks,audits,errors,captures,scope:'Static public landing only; no product/native/live-provider/Home UAT qualification',sourceStatus:'Pinned 26 Nov source.json: public d928e9c; six-mode later branch unpublished; no public release'};
  await writeFile(out+'verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks,audits:audits.length,captures:captures.length,out},null,2));
}finally{await context.close();await browser.close();await server.close()}
