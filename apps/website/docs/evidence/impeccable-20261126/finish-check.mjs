// From apps/website against the built static site. Existing installed Playwright only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const out=new URL('.',import.meta.url),base='http://127.0.0.1:4179';
const browser=await chromium.launch({headless:true});
const checks=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto(base+'/en/');await page.evaluate(()=>document.fonts.ready);await page.locator('.hero a[download]').first().waitFor();
  assert.equal(await page.locator('.connector-current').evaluate(e=>getComputedStyle(e).animationName),'none');
  const phases=[];
  for(let i=0;i<3;i++){
    await page.locator('.illustration-controls button').nth(i).click();
    await page.waitForFunction(i=>document.querySelector('.illustration-canvas').dataset.phase===String(i),i);
    phases.push(await page.locator('.result-node').evaluate(e=>({content:e.textContent,display:getComputedStyle(e).display,path:document.querySelector('.connector-current').getAttribute('d')})));
    if(i!==1)await page.locator('.work-illustration').screenshot({path:new URL(`phase-${i===0?'plan':'inspect'}-1440-en.png`,out).pathname.slice(1)});
  }
  assert.equal(new Set(phases.map(p=>p.content)).size,3);assert.equal(new Set(phases.map(p=>p.path)).size,3);
  assert.deepEqual(phases.map(p=>p.display),['flex','grid','block']);
  checks.push('Plan/Make/Inspect change illustrative retained output, connector topology and result structure: mission plan, split files/review, Delivery Pack');
  await page.locator('.illustration-controls button').nth(1).click();
  await page.locator('#strategies > summary').click();
  await page.getByRole('button',{name:'Next step',exact:true}).click();
  assert.equal(await page.locator('.strategy-board').getAttribute('data-playing'),'false');
  assert.equal(await page.locator('.flow-map').getAttribute('data-step'),'1');
  checks.push('Actual reduced-motion CSS disables hero connector animation; strategy manual Next step advances without playback');
  // Close expanded content, record the complete finished page with real downloads mounted.
  await page.locator('#strategies > summary').click();
  await page.evaluate(()=>{localStorage.setItem('forge.website.theme','light');document.documentElement.dataset.theme='light';scrollTo({top:0,behavior:'instant'})});
  await page.screenshot({path:new URL('fullpage-1440-en-light.png',out).pathname.slice(1),fullPage:true});
  await page.setViewportSize({width:375,height:1000});
  await page.goto(base+'/th/');await page.evaluate(()=>{localStorage.setItem('forge.website.theme','dark');document.documentElement.dataset.theme='dark';return document.fonts.ready});await page.locator('.hero a[download]').first().waitFor();
  await page.screenshot({path:new URL('fullpage-375-th-dark.png',out).pathname.slice(1),fullPage:true});
  await page.locator('.product-figure').screenshot({path:new URL('mobile-proof-375-th-dark.png',out).pathname.slice(1)});
  for(const i of [0,2]){
    await page.locator('.illustration-controls button').nth(i).click();
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.locator('.work-illustration').screenshot({path:new URL(`phase-${i===0?'plan':'inspect'}-375-th-dark.png`,out).pathname.slice(1)});
  }
  await page.locator('.illustration-controls button').nth(1).click();
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  await page.route('**/downloads/manifest.json',async route=>{await pending;await route.continue()});
  await page.goto(base+'/en/download/');
  await page.getByText('Checking download availability…',{exact:true}).waitFor();
  assert.equal(await page.locator('.source-download-panel .platform-download').count(),0);
  await page.screenshot({path:new URL('download-pending-375-en-dark.png',out).pathname.slice(1)});
  release();await page.locator('.source-download-panel a[download]').first().waitFor();
  await page.unroute('**/downloads/manifest.json');
  checks.push('Pending detail route gives Checking availability with no self-link download actions');
  await page.route('**/downloads/manifest.json',route=>route.fulfill({status:200,contentType:'application/json',body:'{"schemaVersion":1,"platforms":[]}'}));
  await page.reload();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.equal(await page.locator('.source-download-panel a[download]').count(),0);
  assert.equal(await page.locator('.source-download-panel a[href="/en/download/"]').count(),0);
  await page.screenshot({path:new URL('download-unavailable-375-en-dark.png',out).pathname.slice(1)});
  await page.goto(base+'/en/');await page.locator('.hero .package-details').waitFor();
  assert.equal(await page.locator('.hero a[download]').count(),0);
  assert.match(await page.locator('.hero .package-details').innerText(),/package details/i);
  await page.screenshot({path:new URL('home-package-details-375-en-dark.png',out).pathname.slice(1)});
  await page.locator('.hero .package-details').click();assert.equal(page.url(),base+'/en/download/');await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  await page.unroute('**/downloads/manifest.json');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.locator('.source-download-panel a[download="FORGE-macOS.zip"]').waitFor();
  checks.push('Malformed download metadata fails closed; visible Retry recovers to real same-origin platform anchors');
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:1000}}),read=await nojs.newPage();
  await read.goto(base+'/en/');assert.equal(await read.locator('noscript a[download]').count(),4);
  assert.equal(await read.getByRole('heading',{level:1}).count(),1);
  await read.goto(base+'/en/install/');assert.equal(await read.getByRole('heading',{name:'Get the source',exact:true}).count(),1);
  checks.push('No-JavaScript localized home retains honest direct Windows/macOS links; setup content remains readable');
  await nojs.close();await context.close();
  await writeFile(new URL('finish-check.json',out),JSON.stringify({status:'PASS',checks,scope:'Public static website only; no native runtime/product qualification'},null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',checks},null,2));
}finally{await browser.close()}
