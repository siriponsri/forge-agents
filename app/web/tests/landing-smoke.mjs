// Integrated landing, actual app screenshot, and actual downloadable source packages.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import {createApplication} from '../../server/main.mjs';
import {unzip} from '../../reports/files.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-landing-'));
const app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(app.url+'/welcome');
  await page.getByRole('heading',{level:1}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'th');
  await page.locator('.landing-preview img').evaluate(async image=>{await image.decode();if(!image.naturalWidth)throw new Error('Actual screenshot unavailable');});
  // Every pinned printout is a real captured screen shipped with the page.
  const sources=await page.locator('.landing-printout img').evaluateAll(async images=>Promise.all(images.map(async image=>{image.loading='eager';await image.decode();if(!image.naturalWidth)throw new Error(image.src);return new URL(image.src).pathname;})));
  assert.deepEqual(sources,['/landing/overview.webp','/landing/chat.webp','/landing/kanban.webp','/landing/notebook.webp','/landing/serving.webp','/landing/sheet.webp']);
  // The working download action sits in the first viewport, not behind a link elsewhere.
  const primary=page.locator('.landing-hero-ticket').getByRole('link',{name:'ดาวน์โหลดสำหรับ Windows',exact:true});
  await primary.waitFor();assert.ok((await primary.boundingBox()).y+48<=1000,'primary download below the first viewport');
  // Every rendered download stays a same-origin package path.
  for(const href of await page.locator('a[download]').evaluateAll(links=>links.map(link=>link.href))){const url=new URL(href);assert.equal(url.origin,new URL(app.url).origin);assert.match(url.pathname,/^\/downloads\/FORGE-(Windows|macOS)\.zip$/);}
  const metadata=await(await page.request.get(app.url+'/api/downloads')).json();
  assert.equal(metadata.platforms.length,2);
  for(const platform of metadata.platforms){
    const link=page.getByRole('link',{name:`ดาวน์โหลดสำหรับ ${platform.label}`,exact:true}).first();
    await link.waitFor();
    const pending=page.waitForEvent('download');await link.click();const download=await pending;
    assert.equal(download.suggestedFilename(),platform.filename);
    const target=path.join(temp,platform.filename);await download.saveAs(target);
    const bytes=await readFile(target);
    assert.equal(bytes.length,platform.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),platform.sha256);
    const entries=unzip(bytes,64*1024*1024),info=JSON.parse(entries.get('FORGE/release-info.json'));
    assert.equal(info.commit,metadata.commit);
    assert.ok(entries.has(`FORGE/Start-FORGE.${platform.id==='windows'?'cmd':'command'}`));
    assert.ok(entries.has('FORGE/app/web/public/forge-workbench-preview.png'));
    assert.ok(![...entries.keys()].some(k=>k.includes('/.git/')||k.includes('/node_modules/')));
    if(platform.id==='macos')assert.equal(platform.qualification,'not-run');
  }
  // Metadata failure disables every download and offers a working retry.
  let fail=true;await page.route('**/api/downloads',route=>fail?route.fulfill({status:503,body:'{}'}):route.continue());
  await page.reload();await page.locator('.landing-hero-ticket .landing-retry').waitFor();
  assert.equal(await page.locator('a[download]').count(),0);
  assert.ok(await page.locator('.landing-button').evaluateAll(buttons=>buttons.every(button=>button.disabled)));
  fail=false;await page.locator('.landing-hero-ticket .landing-retry').click();
  await page.locator('.landing-hero-ticket a[download]').first().waitFor();await page.unroute('**/api/downloads');
  for(const lang of ['th','en']){
    await page.getByRole('button',{name:lang==='th'?'ภาษาไทย':'English',exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    for(const width of [320,375,390,414,768,1280,1440]){
      await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true,`${lang} overflow at ${width}`);
      const wrapped=await page.locator('.landing-button,.landing-nav-open,.landing-nav-links a').evaluateAll(els=>els.filter(el=>{
        if(!el.getBoundingClientRect().width)return false;const span=el.querySelector('span')??el,style=getComputedStyle(span);return span.getBoundingClientRect().height>parseFloat(style.lineHeight)*1.6;
      }).map(e=>e.textContent));assert.deepEqual(wrapped,[],`${lang} wrapped buttons at ${width}`);
      if([390,1440].includes(width))await page.screenshot({path:path.join(temp,`landing-${lang}-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Open workbench',exact:true}).first().click();
  await page.getByRole('heading',{name:'เริ่มจากไอเดียของคุณ',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/app');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-modern');
  assert.deepEqual(errors,[]);
  const evidence={result:'PASSED',fixtureDir:temp,commit:metadata.commit,checks:['Thai default and TH/EN','actual screenshot decoded','six landing captures decoded','primary download in first viewport','same-origin download links','metadata failure disables downloads and retry recovers','320/375/390/414/768/1280/1440 responsive in both languages','actual Windows and macOS browser downloads','download byte count/SHA256/commit provenance','source includes launchers and screenshot without git/dependencies','macOS explicitly not qualified','landing opens actual workbench','Dark Modern default','no browser exceptions'],packages:metadata.platforms};
  await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}
finally{await browser.close();await app.close();}
