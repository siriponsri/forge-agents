import {chromium} from 'playwright';
import {serve} from '../../../scripts/serve.mjs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const out=fileURLToPath(new URL('.',import.meta.url));
const app=await serve(),browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
for(const width of [320,375,414,768,1280,1440]){
await page.setViewportSize({width,height:1000});await page.goto(app.url+'/en/');await page.evaluate(()=>document.fonts.ready);
if(width===1280)console.log('Laptop hero bottom',await page.locator('.hero').evaluate(e=>e.getBoundingClientRect().bottom));
await page.locator('.hero').screenshot({path:out+`hero-${width}.png`});await page.locator('.strategy-board').screenshot({path:out+`formation-${width}.png`});
}
await page.getByRole('button',{name:'Use dark theme',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
await page.getByRole('link',{name:'เปลี่ยนเป็นภาษาไทย',exact:true}).click();await page.waitForURL('**/th/');assert.equal(await page.locator('html').getAttribute('lang'),'th');
await page.getByRole('link',{name:'เปิดภาพพื้นที่ทำงานความละเอียดเต็ม',exact:true}).click();await page.waitForURL('**/forge-workbench.png');assert.equal(await page.locator('img').evaluate(e=>e.naturalWidth),1440);
console.log('Theme toggle/reload persistence, localized navigation and genuine full-size screenshot: PASS');
if(process.argv.includes('--references'))for(const [name,url] of [['orca','https://orca.dev/'],['t3','https://t3.codes/'],['ao','https://orchestrator.inc/']]){
await page.setViewportSize({width:1440,height:1000});await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1200);const path=join(tmpdir(),`forge-reference-${name}.png`);await page.screenshot({path});console.log(JSON.stringify({name,url,title:await page.title(),path}));
}
}finally{await browser.close();await app.close()}
