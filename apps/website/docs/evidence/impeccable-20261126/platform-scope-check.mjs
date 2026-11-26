// Narrow follow-up: current Windows-only setup copy, layout and download bytes.
// Existing installed browser/dependencies; no provider/native/platform execution.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {serve} from '../../../scripts/serve.mjs';

process.chdir(fileURLToPath(new URL('../../../',import.meta.url)));
const out=new URL('.',import.meta.url),app=await serve(0),browser=await chromium.launch({headless:true});
const report={scope:'New platform-qualification copy only. Original four-finding design verdict retained separately; no Owner aesthetic or native macOS qualification.',layouts:[],audits:[],captures:[],errors:[]};
try{
  for(const lang of ['en','th'])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.name));
    await page.goto(app.url+'/'+lang+'/');await page.evaluate(theme=>{localStorage.setItem('forge.website.theme',theme);document.documentElement.dataset.theme=theme;},theme);
    for(const width of [320,375,414,768,1280,1440]){
      await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);await page.locator('.hero a[download]').first().waitFor();
      const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,requirements:[...document.querySelectorAll('.source-requirements')].map(e=>({fits:e.scrollWidth<=e.clientWidth+1,text:e.textContent}))}));
      assert.ok(layout.documentWidth<=width+1);assert.ok(layout.requirements.length);assert.ok(layout.requirements.every(e=>e.fits&&e.text.includes('Windows x64')));report.layouts.push({lang,theme,...layout});
      if((lang==='en'&&theme==='light'&&width===1440)||(lang==='th'&&theme==='dark'&&[320,375].includes(width))){
        await page.evaluate(()=>scrollTo(0,0));const capture=`platform-scope-home-${lang}-${theme}-${width}.png`;await page.screenshot({path:fileURLToPath(new URL(capture,out))});report.captures.push(capture);
      }
      if((lang==='en'&&theme==='light'&&width===1440)||(lang==='th'&&theme==='dark'&&width===375)){
        const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(audit.violations,[]);report.audits.push({page:'home',lang,theme,width,violations:0});
      }
    }
    if((lang==='en'&&theme==='light')||(lang==='th'&&theme==='dark')){
      const width=lang==='en'?1440:375;await page.setViewportSize({width,height:1000});await page.goto(app.url+'/'+lang+'/download/');await page.locator('.download-detail a[download]').first().waitFor();await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      assert.ok((await page.locator('.download-detail .source-requirements').innerText()).includes('Windows x64'));
      const capture=`platform-scope-download-${lang}-${theme}-${width}.png`;await page.screenshot({path:fileURLToPath(new URL(capture,out)),fullPage:true});report.captures.push(capture);
      const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(audit.violations,[]);report.audits.push({page:'download',lang,theme,width,violations:0});
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.status='PASS';await writeFile(new URL('platform-scope-check.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,layouts:report.layouts.length,audits:report.audits.length,captures:report.captures}));
}finally{await browser.close();app.server.closeAllConnections();await app.close();}
