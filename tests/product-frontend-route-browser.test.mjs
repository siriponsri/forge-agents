import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import FrontendTools from '/app/web/src/FrontendTools.jsx';
import {createUniver, LocaleType} from '@univerjs/presets';
import {UniverDocsCorePreset} from '@univerjs/preset-docs-core';
import {DocSelectionManagerService} from '@univerjs/docs';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import '/app/web/src/style.css';
import '/app/web/src/themes.css';
const {univer,univerAPI}=createUniver({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:enUS},presets:[UniverDocsCorePreset({container:document.getElementById('editor')})]});
const unit=univerAPI.createDocument({id:'native-doc',title:'Saved selection fixture',body:{dataStream:'Hello ไทย😀 world\\r\\n',paragraphs:[{startIndex:17}],sectionBreaks:[{startIndex:18}]}});
const saved=unit.save(), record={id:'doc',projectId:'p',kind:'doc',revision:1,snapshot:structuredClone(saved)};
const editor={univer,unit,record,ready:true,currentRevision:1,dirty:false,saving:false,pendingEdit:false,baseline:JSON.stringify(saved),rawSnapshot:()=>unit.save()};
const call={pendingId:'call',projectId:'p',runId:'run',attemptId:'attempt',status:'pending',delivery:'pending',arguments:{documentId:'doc',expectedRevision:1},expiresAt:Date.now()+120000};
let failOnce=true;
window.fixture={editor,answers:[],select:()=>unit.setSelection(6,11),selection:()=>univer.__getInjector().get(DocSelectionManagerService).getTextRanges({unitId:unit.getId(),subUnitId:unit.getId()}),pending:call};
const requestOwner=async(path,body)=>{if(path.includes('/pending?'))return{calls:[{...call}]};window.fixture.answers.push(structuredClone(body));if(failOnce){failOnce=false;throw Error('fixture lost reply');}call.status='accepted';call.delivery='unconfirmed';return{call:{...call},receipt:{result:body.result}};};
createRoot(document.getElementById('controls')).render(<FrontendTools projectId='p' run={{id:'run',projectId:'p',attemptId:'attempt',frontendContext:{}}} getEditor={()=>editor} requestOwner={requestOwner} t={(_th,en)=>en}/>);
window.fixture.ready=true;
`;

test('mounted Office component reads real Univer UI selection on click and retries exact result after lost reply', { timeout: 90000 }, async t => {
  const virtual = '\0frontend-component-fixture.jsx';
  const server = await createServer({ root, configFile: false, cacheDir: path.join(tmpdir(), 'forge-frontend-route-vite-cache'), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'frontend-component-engineering-fixture', resolveId: id => id === '/__frontend-fixture.jsx' ? virtual : undefined, load: async id => id === virtual ? transformWithEsbuild(entry, '__frontend-fixture.jsx', { loader: 'jsx' }) : undefined, configureServer(server) { server.middlewares.use('/__frontend-page', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="padding:16px"><div id="controls"></div><div id="editor" style="height:480px"></div></main><script type="module" src="/__frontend-fixture.jsx"></script></body></html>'); }); } }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.FORGE_TEST_BROWSER ? { executablePath: process.env.FORGE_TEST_BROWSER } : {}) });
  t.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0] + '__frontend-page');
  try { await page.waitForFunction(() => window.fixture?.ready, null, { timeout: 45000 }); }
  catch (e) { throw Error(e.message + '; browser errors: ' + errors.join('; ')); }
  await page.evaluate(() => window.fixture.select());
  await page.waitForFunction(() => window.fixture.selection()?.[0]?.endOffset === 11);
  await page.getByRole('button', { name: 'Send selection', exact: true }).click();
  await page.getByRole('alert').waitFor();
  const first = await page.evaluate(() => window.fixture.answers[0]);
  assert.equal(first.result.status, 'ok', JSON.stringify(first)); assert.equal(first.result.selection.text, 'ไทย😀');
  // The selection changes after the lost reply. Retrying must retain the first
  // operation AND text rather than resampling into an existing operation ID.
  await page.evaluate(() => window.fixture.editor.unit.setSelection(0, 5));
  await page.getByRole('button', { name: 'Retry same result', exact: true }).click();
  await page.getByText('Result accepted; provider delivery awaits run observation.').waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.answers[1]), first);
  assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.editor.unit.save()) === window.fixture.editor.baseline), true);
  await page.screenshot({ path: path.join(tmpdir(), 'forge-frontend-route-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.getElementById('controls').scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: path.join(tmpdir(), 'forge-frontend-route-mobile.png') });
  assert.deepEqual(errors, []);
});
