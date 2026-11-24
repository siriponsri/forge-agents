// Integration checks for FORGE's theme adaptation. Run from repository root.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { THEMES, DEFAULT_THEME, VSCODE_REVISION, getTheme } from '../../web/src/themes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const manifest = JSON.parse(await readFile(path.join(here,'sources.json'),'utf8'));
assert.equal(VSCODE_REVISION, 'b57d5c9e1b27c4ede570c76940b7aa5207595a54');
assert.equal(manifest.revision,VSCODE_REVISION);
for (const entry of manifest.files) {
  assert.equal(createHash('sha256').update(await readFile(path.join(here,'source',entry.file))).digest('hex'), entry.sha256, entry.file);
  assert.equal(entry.url, `https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_REVISION}/${entry.file}`);
}
assert.equal(DEFAULT_THEME,'dark-modern');
assert.equal(getTheme('invalid').id,DEFAULT_THEME);
assert.equal(getTheme(null).id,DEFAULT_THEME);
assert.equal(THEMES.length,15);
assert.equal(new Set(THEMES.map(theme=>theme.id)).size,15);
assert.equal(getTheme('dark-modern').preview.background.toUpperCase(),'#1F1F1F');
assert.equal(getTheme('dark-modern').preview.sidebar.toUpperCase(),'#181818');
assert.equal(getTheme('dark-modern').preview.accent.toUpperCase(),'#0078D4');
assert.equal(getTheme('solarized-dark').preview.background.toUpperCase(),'#002B36');
assert.equal(getTheme('monokai').preview.background.toUpperCase(),'#272822');
const luminance = color => color.slice(1).match(/../g).slice(0,3).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
let minimum = Infinity;
for (const theme of THEMES) {
  const t = theme.tokens;
  for (const foreground of ['fg','muted','link']) for (const surface of ['bg','paper','sidebar','topbar','input','hover','elevated','selected-bg','code-bg']) {
    const value = contrast(t[foreground],t[surface]); minimum = Math.min(minimum,value);
    assert.ok(value >= 4.5,`${theme.id}: ${foreground}/${surface}: ${value}`);
  }
  for (const state of ['success','warning','danger']) assert.ok(contrast(t[state],t[state+'-bg']) >= 4.5,`${theme.id}: ${state}`);
  for (const surface of ['accent','accent-hover']) assert.ok(contrast(t['on-accent'],t[surface]) >= 4.5,`${theme.id}: button ${surface}`);
}

// Compile the real component into a disposable harness; no app integration edits,
// server, domain records, credentials or third-party assets are needed.
const picker = path.join(root,'app/web/src/ThemePicker.jsx').replaceAll('\\','/');
const harness = `import React, {useState} from 'react';import {createRoot} from 'react-dom/client';import ThemePicker from ${JSON.stringify(picker)};
function Fixture(){const [theme,setTheme]=useState('invalid');const [thai,setThai]=useState(false);return <div className="workbench"><aside className="sidebar"><div className="brand"><span className="forge-mark">F</span><span>FORGE<small>Local workbench</small></span></div><nav><button className="active">Overview</button><button>Plan & tasks</button></nav></aside><div className="workspace"><header className="topbar"><button className="mobile-menu">☰</button><span className="topbar-title">Project workbench</span><div className="actions"><span className="environment-tag">LOCAL</span><ThemePicker theme={theme} onChange={id=>{setTheme(id);document.documentElement.dataset.theme=id;}} t={(th,en)=>thai?th:en}/><button id="language" onClick={()=>setThai(!thai)}>TH/EN</button></div></header><main><header className="page-heading"><div><h1>Workspace verification</h1><p>Disposable fixture. No product data.</p></div><button className="primary">Create project</button></header><div className="split"><section className="panel"><h2>Documents</h2><div className="collection"><button className="selected"><strong>Selected document</strong><small>Saved locally</small></button></div></section><section className="panel"><h2>Project settings</h2><div className="form-grid"><label className="field">Name<input placeholder="Workspace name"/></label><label className="field">Provider<select><option>Local</option></select></label></div><div className="message user"><p>Persisted message</p></div><span className="badge state-done">done</span><div className="code">Log output</div></section></div><div className="univer-container"><button id="editor-owned">Editor-owned control</button></div></main></div></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({stdin:{contents:harness,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
const css = (await readFile(path.join(root,'app/web/src/themes.css'),'utf8')) + (await readFile(path.join(root,'app/web/src/style.css'),'utf8')).replace(/@import[^;]*;/,'');
const browser = await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});
const out = await mkdtemp(path.join(tmpdir(),'forge-theme-verification-'));
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const trigger=page.locator('.theme-trigger');
  await trigger.waitFor();
  assert.match(await trigger.getAttribute('aria-label'),/Dark Modern/);
  assert.equal(await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('html').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(31, 31, 31)');
  // Generic FORGE rules cannot take over embedded editor controls.
  assert.notEqual(await page.locator('#editor-owned').evaluate(node=>getComputedStyle(node).minHeight),'37px');
  await trigger.click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('radio').count(),15);
  assert.equal(await page.getByRole('radio',{name:'Dark Modern',exact:true}).getAttribute('aria-checked'),'true');
  await page.getByRole('textbox',{name:'Search themes'}).fill('solarized');
  assert.equal(await page.getByRole('radio').count(),2);
  await page.getByRole('radio',{name:'Solarized Light',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'solarized-light');
  assert.equal(await page.locator('dialog').evaluate(node=>node.open),false);
  assert.ok(await trigger.evaluate(node=>document.activeElement===node));
  await trigger.click();
  await page.getByRole('textbox',{name:'Search themes'}).fill('no-such-theme');
  assert.equal(await page.getByRole('radio').count(),0);
  await page.getByRole('status').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(node=>node.open),false);
  await trigger.click();
  await page.getByRole('textbox',{name:'Search themes'}).press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-plus');
  await page.keyboard.press('End');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'high-contrast-light');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-modern');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('dialog').evaluate(node=>node.open),false);
  await trigger.click();
  await page.mouse.click(3,3);
  assert.equal(await page.locator('dialog').evaluate(node=>node.open),false);
  // Select every named theme through the public picker and verify emitted id.
  for(const theme of THEMES){await trigger.click();await page.getByRole('radio',{name:theme.label,exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),theme.id);}
  await trigger.click();await page.getByRole('radio',{name:'Dark Modern',exact:true}).click();
  for(const width of [320,375,414,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`root overflow at ${width}`);
    await trigger.click();
    const bounds=await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,`dialog overflow at ${width}`);
    assert.ok(await page.locator('.theme-options').evaluate(node=>node.scrollHeight>node.clientHeight),`scrollable options at ${width}`);
    const clipped=await page.locator('.theme-option-copy strong').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth).map(node=>node.textContent));
    assert.deepEqual(clipped,[],`truncated theme names at ${width}`);
    await page.screenshot({path:path.join(out,`theme-picker-${width}.png`),fullPage:true});
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:375,height:900});
  await page.locator('#language').click();await trigger.click();
  await page.getByRole('textbox',{name:'ค้นหาธีม'}).waitFor();
  await page.screenshot({path:path.join(out,'theme-picker-thai-375.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await trigger.evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASSED',themes:THEMES.length,pinnedSourceFiles:manifest.files.length,minimumTextContrast:Number(minimum.toFixed(3)),viewports:[320,375,414,768,1440],checks:['unknown id fallback','MIT source SHA256','palette fidelity','AA text/status/button contrast','search/filter/empty','selection aria-checked','keyboard arrows/Home/End/Enter','Escape/outside dismissal','focus restoration','all 15 onChange ids','Thai labels','reduced motion','embedded editor CSS boundary','no root/dialog overflow','no truncated theme names','no browser errors'],screenshots:out},null,2));
}finally{await browser.close();}
