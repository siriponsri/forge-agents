// Actual Chromium with the real component + service and a labelled memory-only
// backend fixture. HTTP is intercepted in-process: no FORGE server/account runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { secretFixture } from './secrets-fixture.test.mjs';
import { dispatchSecretRequest } from '../app/secrets/index.mjs';

test('password form saves, clears, rotates, removes and retries uncertain writes with the same operation', { timeout: 60000 }, async t => {
  const f = await secretFixture(), calls = [], responses = [], errors = [];
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import SecretManager from './app/web/src/SecretManager.jsx';const state=${JSON.stringify(f.canonical)};function App(){const[lang,L]=React.useState('en');const[p,P]=React.useState('${f.projectId}');return <><button onClick={()=>L(x=>x==='en'?'th':'en')}>Language</button><button onClick={()=>P('${f.foreignId}')}>Other project</button><SecretManager state={state} projectId={p} t={(th,en)=>lang==='th'?th:en} run={async fn=>fn()} busy={false}/></>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: path.resolve('.'), loader: 'jsx' }, bundle: true, format: 'iife', platform: 'browser', write: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const browser = await chromium.launch({ headless: true, ...(process.env.FORGE_TEST_BROWSER ? { executablePath: process.env.FORGE_TEST_BROWSER } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1050, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  let loseNextAck = false;
  await page.route('http://127.0.0.1:43991/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main id="root"></main></body></html>' });
    assert.ok(url.pathname.startsWith('/api/secrets/')); assert.equal(req.method(), 'POST');
    const action = url.pathname.slice('/api/secrets/'.length), input = req.postDataJSON(); calls.push({ action, input });
    try {
      const result = await dispatchSecretRequest(f.service, action, input); responses.push(result);
      if (loseNextAck && action === 'set') { loseNextAck = false; return route.abort('failed'); }
      return route.fulfill({ json: result });
    } catch (e) { return route.fulfill({ status: e.statusCode ?? 500, json: { error: { code: e.code, message: e.message } } }); }
  });
  await page.goto('http://127.0.0.1:43991/'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: 'Save key', exact: true }).waitFor();
  const key = page.getByLabel('Key value', { exact: true });
  assert.equal(await key.getAttribute('type'), 'password'); assert.equal(await key.getAttribute('autocomplete'), 'off');
  assert.equal(calls.filter(c => c.action === 'set' || c.action === 'remove').length, 0);
  await page.getByLabel('Purpose', { exact: true }).selectOption('provider');
  await page.getByLabel('Key reference name', { exact: true }).fill('FORGE_KOB_KEY');
  await key.fill('browser-disposable-key-ONLY'); await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate key', exact: true }).waitFor();
  assert.equal(await key.inputValue(), '');
  assert.ok(!(await page.locator('body').innerText()).includes('browser-disposable-key-ONLY'));
  assert.ok(!JSON.stringify(responses).includes('browser-disposable-key-ONLY'));
  assert.equal(calls.find(c => c.action === 'set').input.expectedRevision, 0);
  await page.getByRole('button', { name: 'Rotate key', exact: true }).click();
  await page.getByLabel('New key value', { exact: true }).fill('browser-rotated-disposable-ONLY');
  await page.getByRole('button', { name: 'Save rotated key', exact: true }).click();
  await page.getByLabel('Key value', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove key', exact: true }).click();
  await page.getByText('No saved keys in this project.', { exact: true }).waitFor();
  assert.equal(calls.find(c => c.action === 'remove').input.expectedRevision, 2);
  assert.ok(!JSON.stringify(f.privateState()).includes('browser-rotated-disposable-ONLY'));
  // Lose acknowledgement AFTER durable service commit. Retry must replay, not
  // create/rotate a second time. The GUI never places the input in React state.
  loseNextAck = true;
  await key.fill('browser-uncertain-disposable-ONLY'); await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same operation', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Retry same operation', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate key', exact: true }).waitFor();
  assert.equal(await key.inputValue(), '');
  const writes = calls.filter(c => c.action === 'set');
  assert.equal(writes.at(-1).input.operationId, writes.at(-2).input.operationId);
  assert.equal(f.privateState().records.filter(r => !r.deleted).length, 1);
  assert.equal(f.privateState().records.find(r => !r.deleted).revision, 1);
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('heading', { name: 'คีย์ส่วนตัวในเครื่อง', exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.locator('input,select,textarea').evaluateAll(nodes => nodes.filter(n => !n.labels?.length && !n.getAttribute('aria-label')).length), 0);
  await page.locator('input[type=password]').fill('unsaved-switch-disposable-ONLY');
  await page.getByRole('button', { name: 'Other project', exact: true }).click();
  await page.getByText('ยังไม่มีคีย์ในโปรเจกต์นี้', { exact: true }).waitFor();
  assert.equal(await page.locator('input[type=password]').inputValue(), '');
  assert.ok(!(await page.locator('body').innerText()).includes('FORGE_KOB_KEY · provider'));
  assert.deepEqual(errors, []);
});
