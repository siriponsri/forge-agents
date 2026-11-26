// Narrow remaining finish-review finding only. Run from apps/website, static server :4179.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=new URL('.',import.meta.url),browser=await chromium.launch({headless:true}),checks=[];
try{
  const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();
  for(const [width,lang,theme,name] of [[1440,'en','light','phase-inspect-1440-en'],[375,'th','dark','phase-inspect-375-th-dark']]){
    await page.setViewportSize({width,height:1000});
    await page.goto(`http://127.0.0.1:4179/${lang}/`);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;return document.fonts.ready},theme);
    await page.locator('.hero a[download]').first().waitFor();
    await page.locator('.illustration-controls button').nth(2).click();
    await page.waitForFunction(()=>document.querySelector('.illustration-canvas').dataset.phase==='2');
    const result=await page.locator('.connector-current').evaluate(e=>({
      path:e.getAttribute('d'),
      trunk:e.isPointInStroke({x:300,y:110}),
      leftCurve:e.isPointInStroke({x:293.75,y:133.75}),
      rightCurve:e.isPointInStroke({x:306.25,y:133.75})
    }));
    assert.ok(result.trunk&&result.leftCurve&&result.rightCurve,'Both curves join the incoming trunk');
    await page.evaluate(()=>{const r=document.querySelector('.work-illustration').getBoundingClientRect();scrollTo({top:scrollY+r.top-30,behavior:'instant'})});
    await page.locator('.work-illustration').screenshot({path:fileURLToPath(new URL(name+'.png',out))});
    checks.push({width,lang,theme,...result,capture:name+'.png'});
  }
  await context.close();
  await writeFile(new URL('inspect-connector-check.json',out),JSON.stringify({status:'PASS at narrow geometric/render check scope',checks,scope:'Inspect incoming trunk joins both branches. Only two Inspect images refreshed; earlier17-view matrix and other findings were not re-audited. Independent reviewer verdict pending.'},null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',checks},null,2));
}finally{await browser.close()}
