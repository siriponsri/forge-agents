import {browserOwner} from '../../../tests/support/browser-owner.mjs';
// Real built FORGE + disposable service state. No provider, compute, or external
// account calls. Delay gates below retain real responses to inspect loading/busy UI.
// Run: npm run build && node app/web/tests/visual-refinement.mjs
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import {createApplication} from '../../server/main.mjs';
import {THEMES} from '../src/themes.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(),'forge-visual-refinement-'));
const app = await createApplication({dataDir:path.join(temp,'state')});
const browser = await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER ? {executablePath:process.env.FORGE_TEST_BROWSER} : {})});
const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[]; page.on('pageerror',error => errors.push(error.message));
const checks=[]; const contrast=[];
const cmd = async(type,projectId,data,record) => {
  const r=await page.request.post(app.url+'/api/command',{headers:await browserOwner(app.url),data:{operationId:crypto.randomUUID(),type,projectId,data,...(record ? {id:record.id,expectedRevision:record.revision} : {})}});
  assert.ok(r.ok(),await r.text()); return (await r.json()).entity;
};
const nav = name => openRoute(page, name);
const shot = name => page.screenshot({path:path.join(temp,name+'.png'),fullPage:true});
const closePreferences = async () => { const b=page.getByRole('button',{name:'Language & theme',exact:true}); if(await b.getAttribute('aria-expanded')==='true') await b.click(); };
const newProject = async () => { await page.getByRole('button',{name:/^Switch project:/}).click(); await page.getByRole('menuitem',{name:'New project',exact:true}).click(); };
const choose = async id => {
  await chooseTheme(page,THEMES.find(theme => theme.id===id).label);
  await page.waitForFunction(id => document.documentElement.dataset.theme===id,id);
};
async function fits(label) {
  const overflow=await page.evaluate(() => {
    const w=innerWidth;
    return [...document.querySelectorAll('main *, .topbar *, dialog[open] *')].filter(e => {
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width && r.height && (r.right>w+1 || r.left < -1) && !e.closest('.univer-container') && e.tagName!=='OPTION';
    }).slice(0,8).map(e => ({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60),rect:e.getBoundingClientRect().toJSON()}));
  });
  assert.deepEqual(overflow,[],label);
  assert.equal(await page.locator('html').evaluate(e => e.scrollWidth<=innerWidth),true,label+' document overflow');
}
// Audit text against its actual opaque ancestor background, not just token pairs.
async function auditContrast(label) {
  const result=await page.evaluate(() => {
    const rgb=s => (s.match(/[\d.]+/g)||[]).map(Number);
    const lum=a => a.slice(0,3).map(c => {c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
    const failures=[]; let count=0,min=100;
    for(const e of document.querySelectorAll('.workbench *, dialog[open] *')) {
      const cs=getComputedStyle(e),r=e.getBoundingClientRect();
      const isField=['INPUT','TEXTAREA','SELECT'].includes(e.tagName), placeholder=isField && !e.value && e.placeholder;
      const hasText=[...e.childNodes].some(n => n.nodeType===3 && n.textContent.trim()) || isField && (e.value || placeholder);
      if(!r.width || !r.height || cs.visibility==='hidden' || e.closest('dialog:not([open]), .univer-container, button:disabled') || e.tagName==='OPTION' || e.disabled || !hasText)continue;
      let bg; for(let p=e;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length===3 || c[3]===1){bg=c;break;}}
      if(!bg)continue;
      const fg=rgb(placeholder ? getComputedStyle(e,'::placeholder').color : cs.color); const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const size=parseFloat(cs.fontSize),large=size>=24 || (size>=18.66 && Number(cs.fontWeight)>=700),threshold=large?3:4.5;
      count++; min=Math.min(min,ratio);
      if(ratio+.015<threshold)failures.push({text:(placeholder || (isField ? e.value : e.textContent)).slice(0,70),class:e.className,ratio:+ratio.toFixed(2),fg:cs.color,bg:bg.slice(0,3),size});
    }
    return {count,min:+min.toFixed(2),failures};
  });
  contrast.push({label,...result}); assert.deepEqual(result.failures,[],label+' contrast');
}
try {
  // Loading: hold state fetch, then continue the real service response.
  let release; const gate=new Promise(resolve => release=resolve);
  await page.route('**/api/state',async route => {await gate;await route.continue();});
  await page.goto(app.url+'/app');
  await page.getByText(/กำลังเปิด FORGE/).waitFor(); await shot('loading-th');
  release();
  await page.getByRole('heading',{name:'เริ่มจากไอเดียของคุณ',exact:true}).waitFor();
  await page.unroute('**/api/state');
  await setLanguage(page,'en');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-modern');
  await shot('empty-dark-modern');
  await page.getByLabel('Describe what you want to do',{exact:true}).focus(); await page.keyboard.press('Tab'); // keyboard focus
  assert.equal(await page.getByRole('button',{name:'Create first project',exact:true}).evaluate(e => e===document.activeElement),true);
  assert.equal(await page.getByRole('button',{name:'Create first project',exact:true}).evaluate(e => getComputedStyle(e).outlineStyle),'solid');
  await page.keyboard.press('Enter');
  const modal=page.getByRole('dialog'); await modal.waitFor();
  assert.equal(await page.getByLabel('Project name',{exact:true}).evaluate(e => e===document.activeElement),true);
  await page.getByLabel('Project name',{exact:true}).fill('FORGE · Design verification');
  await page.getByLabel('Workspace directory',{exact:true}).fill(path.join(temp,'workspace'));
  await page.getByLabel('Goal',{exact:true}).fill('Disposable engineering fixture · not a live provider session');
  // Submit busy state is observable and preserves the existing accessible name.
  let submitRelease; const submitGate=new Promise(resolve => submitRelease=resolve);
  await page.route('**/api/command',async route => {await submitGate;await route.continue();});
  await modal.getByRole('button',{name:'Create project',exact:true}).click();
  const submit=modal.getByRole('button',{name:'Create project',exact:true});
  await page.waitForFunction(() => document.querySelector('button[type=submit]')?.getAttribute('aria-busy')==='true');
  assert.equal(await submit.isDisabled(),true); await shot('project-saving');
  submitRelease();
  await modal.waitFor({state:'hidden'}); await page.unroute('**/api/command');
  await page.getByRole('heading',{name:'What do you want to do?',exact:true}).waitFor();
  await page.locator('.home-empty').waitFor(); assert.equal(await page.locator('.home-focus').count(),0,'no task focus without tasks');
  await shot('project-without-tasks');
  const s=await (await page.request.get(app.url+'/api/state')).json(); const p=s.projects[0];
  const bot=await cmd('bot.create',p.id,{name:'Reviewer · ผู้ตรวจ',role:'Inspect developer verification evidence',kind:'resident'});
  const plan=await cmd('plan.create',p.id,{name:'Engineering verification fixture',approved:true});
  const created=[];
  for(const [title,status] of [['Verify reopen and persistence','done'],['Inspect generated reports','done'],['Review themes and responsive layouts','review'],['Prepare local startup guide','ready']])created.push(await cmd('task.create',p.id,{title,status,planId:plan.id,botId:bot.id,evidence:status==='done'?['Synthetic completion record for disposable visual verification fixture; no live provider claim']:[]}));
  // Another project must not leak tasks or counts into the selected project.
  const other=await cmd('project.create',null,{name:'Other engineering fixture',workspace:path.join(temp,'other')});
  await cmd('task.create',other.id,{title:'OTHER PROJECT MUST NOT APPEAR',status:'running'});
  await page.getByRole('button',{name:'Refresh state',exact:true}).click();
  await page.locator('.home-focus').getByText('Review themes and responsive layouts',{exact:true}).waitFor();
  assert.equal(await page.getByText('OTHER PROJECT MUST NOT APPEAR').count(),0);
  assert.ok((await page.locator('.home-head p').innerText()).includes('4 tasks (2 done) · 0 documents'),'exact project-scoped counts');
  await page.evaluate(() => document.fonts.ready); await shot('overview-1440-dark-modern');
  checks.push('real GUI project creation, autofocus, busy/disabled state, empty project; canonical project-scoped task/status/owner and exact counts');
  // A real service validation error; the draft remains available for correction.
  await newProject();
  await page.getByLabel('Project name',{exact:true}).fill('Duplicate workspace fixture');
  await page.getByLabel('Workspace directory',{exact:true}).fill(path.join(temp,'workspace'));
  await page.getByRole('dialog').getByRole('button',{name:'Create project',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'WORKSPACE_EXISTS'}).waitFor();
  assert.equal(await page.getByLabel('Project name',{exact:true}).inputValue(),'Duplicate workspace fixture');
  await shot('real-validation-error'); await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Dismiss error',exact:true}).click();
  checks.push('real duplicate-workspace error with retained draft, dismissal and recovery');
  // All themes: open, selected, hover, form, dialog, search and keyboard states.
  for(const theme of THEMES) {
    await choose(theme.id); await fits(theme.id); await auditContrast(theme.id+' overview');
    await page.locator('.quick-action').first().hover(); await auditContrast(theme.id+' hover');
    await openThemePicker(page);
    await page.getByLabel('Search themes',{exact:true}).fill('not-a-theme');
    await page.getByText('No matching themes. Try another name.').waitFor();
    await auditContrast(theme.id+' no results');
    await page.getByLabel('Search themes',{exact:true}).fill('');
    assert.equal(await page.getByRole('radio').count(),15);
    await auditContrast(theme.id+' picker');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:/^Choose theme:/}).evaluate(e => e===document.activeElement),true);
    await closePreferences();
    await newProject();
    await page.getByLabel('Project name',{exact:true}).fill('Theme audit / ???????');
    await auditContrast(theme.id+' form, input and placeholder');
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    if(['light-modern','solarized-dark','high-contrast-dark'].includes(theme.id))await shot('overview-'+theme.id);
  }
  await choose('dark-modern');
  await openThemePicker(page);
  await page.getByLabel('Search themes',{exact:true}).fill('Light Modern');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme==='light-modern');
  await closePreferences();
  await page.reload(); await page.getByRole('heading',{name:'What do you want to do?',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light-modern');
  await choose('dark-modern');
  checks.push('15 named themes; rendered text contrast in overview/hover/picker/empty search/form; keyboard selection, Escape focus restoration, reload persistence');
  // Route semantics remain intact, including tool navigation and native Office.
  await page.getByRole('button',{name:'Open your plan',exact:true}).click();
  await page.getByRole('heading',{name:'Plan & tasks',exact:true}).waitFor();
  await nav('Overview');
  await page.locator('.quick-action').nth(1).click();
  await page.getByRole('heading',{name:'Docs & sheets',exact:true}).waitFor();
  await nav('Overview');
  checks.push('Open your plan and Docs & sheets route through existing functional surfaces');
  // Long mixed-language text is rendered from actual service records.
  const longTitle='ตรวจหลักฐานและการเปิดเอกสารอีกครั้ง — Review the saved report, workbook formulas, and verification evidence before proceeding';
  await cmd('task.update',p.id,{title:longTitle,status:'blocked'},created[2]);
  await page.getByRole('button',{name:'Refresh state',exact:true}).click();
  await page.locator('.home-focus').getByText(longTitle,{exact:true}).waitFor();
  for(const width of [320,375,414,768,1440,1920]) {
    await page.setViewportSize({width,height:1000}); await fits('width '+width);
    await openThemePicker(page); await fits('picker '+width); await page.keyboard.press('Escape'); await closePreferences();
    if(width<960) {await page.getByRole('button',{name:'Menu',exact:true}).click(); await page.locator('.sidebar .side-new').waitFor(); await fits('drawer '+width); await shot('drawer-'+width); await page.keyboard.press('Escape'); await page.locator('.sidebar .side-new').waitFor({state:'hidden'});}
    await shot('overview-long-'+width);
    for(const lang of ['th','en']) {await setLanguage(page,lang); await fits(lang+' '+width);}
  }
  checks.push('320/375/414/768/1440/1920; real long mixed TH/EN task title; native theme dialog bounds; mobile navigation drawer');
  await page.emulateMedia({forcedColors:'active'}); await fits('forced colors'); await shot('forced-colors');
  await page.emulateMedia({forcedColors:'none'});
  assert.equal(await page.locator('.composer').evaluate(e => getComputedStyle(e).transitionDuration),'0s');
  assert.equal(await page.locator('.quick-action').first().evaluate(e => getComputedStyle(e).transitionDuration),'0s');
  checks.push('visible keyboard focus; forced colors; reduced motion and no page exceptions');
  assert.deepEqual(errors,[]);
  const evidence={result:'PASSED',model:'gpt-6.1-sol',effort:'xhigh',fixture:'Real application service with disposable engineering records; no provider live claim',fixtureDir:temp,checks,contrast,pageErrors:errors,homeUat:'HOME_UAT_NOT_RUN',liveProviders:'NOT_RUN'};
  await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({...evidence,contrast:{audits:contrast.length,min:Math.min(...contrast.map(item => item.min)),failures:contrast.flatMap(item => item.failures)}},null,2));
} catch(error) {await shot('failure').catch(()=>{});console.error('FIXTURE_DIR',temp);throw error;}
finally {await browser.close();await app.close();}
