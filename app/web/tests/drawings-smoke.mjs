import {browserOwner} from '../../../tests/support/browser-owner.mjs';
// Real Univer/browser + real artifact HTTP boundary + a separate restarted FORGE process.
// Disposable engineering fixtures only. No provider, accounts or prototype product.
// node app/web/tests/drawings-smoke.mjs (after installing coordinated root dependencies)
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'forge-drawings-'));
const dataDir = path.join(temp, 'state');
let child, appURL, vite, browser, page;
const errors = [];
async function start(port = 0) {
  const script = `import {createApplication} from './app/server/main.mjs';
    const app=await createApplication({dataDir:process.env.FORGE_DRAWINGS_DATA,port:${port}});
    console.log('DRAWINGS_READY '+app.url);
    process.on('message',async m=>{if(m==='close'){await app.close();process.exit(0);}});`;
  child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, windowsHide: true, env: { ...process.env, FORGE_DRAWINGS_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  appURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('FORGE child startup timed out')), 30000);
    let output = '';
    child.stderr.on('data', b => { output += b; });
    child.stdout.on('data', b => { const match = String(b).match(/DRAWINGS_READY (http:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`FORGE child exited ${code}: ${output}`)); });
  });
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.send('close'); await exited; } }
async function post(route, body, expected = 200) {
  const response = await fetch(appURL + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...await browserOwner(appURL) }, body: JSON.stringify(body) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const command = (type, projectId, data, entity, expected = 200) => post('/api/command', {
  operationId: crypto.randomUUID(), type, projectId, data,
  ...(entity ? { id: entity.id, expectedRevision: entity.revision } : {}),
}, expected);
const state = async () => (await fetch(appURL + '/api/state')).json();
async function mount(record) {
  await page.evaluate(async record => {
    window.mountedEditor?.dispose();
    document.querySelector('#editor').replaceChildren();
    window.changes = 0;
    window.mountedEditor = await window.office.mountEditor(document.querySelector('#editor'), record, () => window.changes++);
  }, record);
  await page.waitForFunction(() => !!document.querySelector('#editor canvas'));
}
const snapshot = () => page.evaluate(() => window.mountedEditor.snapshot());
try {
  await start();
  vite = await createServer({ root: path.join(root, 'app/web'), configFile: false,
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: appURL, changeOrigin: true,
      configure(proxy) { proxy.on('proxyReq', req => req.setHeader('origin', appURL)); },
    } } },
    plugins: [{ name: 'drawings-fixture', configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== '/__drawings__') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html><head><style>html,body{margin:0}#editor{width:1400px;height:950px}</style></head>
        <body><div id="editor"></div><script type="module">import * as office from '/src/univer.mjs'; window.office=office;</script></body></html>`);
    }); } }],
  });
  await vite.listen();
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/__drawings__`;
  browser = await chromium.launch({ headless: true, ...(process.env.FORGE_TEST_BROWSER ? { executablePath: process.env.FORGE_TEST_BROWSER } : {}) });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => { errors.push(e.message); console.error(e); });
  await page.goto(url); await page.waitForFunction(() => !!window.office);
  const project = (await command('project.create', null, { name: 'Disposable image fixture', workspace: path.join(temp, 'workspace') })).entity;
  const other = (await command('project.create', null, { name: 'Other image scope', workspace: path.join(temp, 'other') })).entity;
  const records = [];
  for (const kind of ['sheet', 'doc']) {
    const initial = await page.evaluate(kind => {
      const data = window.office.newSnapshot(kind, `Image ${kind}`);
      if (kind === 'sheet') { data.sheetOrder.push('second'); data.sheets.second = { ...data.sheets.sheet1, id: 'second', name: 'Second', cellData: {} }; }
      return data;
    }, kind);
    let record = (await command('document.create', project.id, { name: `Image ${kind}`, kind, snapshot: initial, packageVersion: '1.6.1' })).entity;
    await mount(record);
    if (kind === 'sheet') {
      await page.evaluate(() => window.mountedEditor.apply({ kind: 'sheet.setValues', sheetId: 'second', range: 'A1', text: 'targeted' }));
      const value = await snapshot(); assert.equal(value.sheets.second.cellData[0][0].v, 'targeted'); assert.equal(value.sheets.sheet1.cellData[0]?.[0]?.v, undefined);
      await assert.rejects(page.evaluate(() => window.mountedEditor.apply({ kind: 'sheet.setValues', sheetId: 'missing', range: 'A1', text: 'wrong' })), /unavailable/);
    }
    // A deterministic PNG/JPEG fixture is generated in-browser and uploaded through the production helper.
    const result = await page.evaluate(async kind => {
      const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 40;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e25232'; ctx.fillRect(0, 0, 60, 40);
      const mime = kind === 'sheet' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
      window.fixtureFile = new File([blob], kind === 'sheet' ? 'chart.png' : 'figure.jpg', { type: mime });
      return window.mountedEditor.insertImage(window.fixtureFile, kind === 'sheet' ? { sheetId: 'second', row: 2, column: 1 } : { index: 0 });
    }, kind);
    assert.match(result.source, /^\/api\/artifacts\/[^/]+\/download$/);
    let saved = await snapshot();
    assert.match(JSON.stringify(saved), new RegExp(result.sha256));
    assert.ok(!/blob:|file:|data:image/.test(JSON.stringify(saved)));
    await page.evaluate(() => window.mountedEditor.undo());
    assert.ok(!JSON.stringify(await snapshot()).includes(result.source), 'image insertion undoes');
    await page.evaluate(() => window.mountedEditor.redo());
    assert.ok(JSON.stringify(await snapshot()).includes(result.source), 'image insertion redoes');
    // Exercise the SDK's own picker, proving its IImageIoService uses the same upload boundary.
    const fixture = await page.evaluate(async () => ({ name: window.fixtureFile.name, type: window.fixtureFile.type,
      bytes: [...new Uint8Array(await window.fixtureFile.arrayBuffer())] }));
    const priorSourceCount = JSON.stringify(await snapshot()).split(result.source).length;
    await page.getByText('Insert', { exact: true }).first().click();
    const chooserPromise = page.waitForEvent('filechooser');
    chooserPromise.catch(() => {});
    if (kind === 'sheet') {
      await page.locator('[data-u-command="sheet.menu.image"]:visible').click();
      await page.getByText('Float Image', { exact: true }).click();
    } else await page.locator('[data-u-command="doc.menu.image"]:visible').click();
    const chooser = await chooserPromise;
    const uploadResponse = page.waitForResponse(response => response.url().endsWith('/api/artifacts/upload') && response.request().method() === 'POST');
    await chooser.setFiles({ name: fixture.name, mimeType: fixture.type, buffer: Buffer.from(fixture.bytes) });
    assert.equal((await uploadResponse).status(), 200);
    await page.waitForFunction(({ source, prior }) => JSON.stringify(window.mountedEditor.rawSnapshot()).split(source).length > prior,
      { source: result.source, prior: priorSourceCount });
    saved = await snapshot();
    record = (await command('document.save', project.id, { snapshot: saved, resources: saved.resources, packageVersion: '1.6.1' }, record)).entity;
    // A competing writer advances durable revision. The failed save must leave this live image untouched.
    await command('document.save', project.id, { snapshot: saved }, record);
    await page.evaluate(kind => window.mountedEditor.apply(kind === 'doc' ? { kind: 'doc.insertText', index: 1, text: 'retained' } :
      { kind: 'sheet.setValues', sheetId: 'second', range: 'B2', text: 'retained' }), kind);
    const dirty = await snapshot();
    const stale = await command('document.save', project.id, { snapshot: dirty }, record, 409);
    assert.equal(stale.error.code, 'REVISION_CONFLICT');
    assert.deepEqual(await snapshot(), dirty, 'conflict leaves image and unsaved edits intact');
    await page.route('**/api/command', route => route.abort());
    await assert.rejects(page.evaluate(async record => {
      const { command } = await import('/src/api.mjs');
      await command('document.save', record.projectId, { snapshot: window.mountedEditor.snapshot() }, record);
    }, record), /Connection lost/);
    await page.unroute('**/api/command');
    assert.deepEqual(await snapshot(), dirty, 'connection failure leaves local snapshot intact');
    const wrongScope = await command('document.create', other.id, { name: 'Rejected cross-project', kind, snapshot: saved }, null, 404);
    assert.ok(wrongScope.error);
    // Test upload failure before editor mutation.
    const beforeFailure = await snapshot();
    await page.route('**/api/artifacts/upload', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fixture upload failure' } }) }));
    await assert.rejects(page.evaluate(() => window.mountedEditor.insertImage(window.fixtureFile)), /Fixture upload failure/);
    await page.unroute('**/api/artifacts/upload');
    assert.deepEqual(await snapshot(), beforeFailure);
    // The server completes an upload but the browser loses the response. Retry reuses its receipt.
    const uploadIds = [];
    let completedUpload;
    await page.evaluate(() => {
      window.retryFile = new File([window.fixtureFile], `retry-${window.fixtureFile.name}`, { type: window.fixtureFile.type });
    });
    await page.route('**/api/artifacts/upload', async route => {
      uploadIds.push(route.request().postDataJSON().operationId);
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      completedUpload = await response.json();
      await route.abort();
    });
    await assert.rejects(page.evaluate(() => window.mountedEditor.uploadImage(window.retryFile)), /connection lost/);
    await page.unroute('**/api/artifacts/upload');
    const receiptsAfterLostResponse = (await state()).receipts.length;
    const replay = await page.evaluate(() => window.mountedEditor.uploadImage(window.retryFile));
    assert.equal(replay.artifactId, completedUpload.id);
    assert.equal((await state()).receipts.length, receiptsAfterLostResponse);
    assert.equal(uploadIds.length, 1);
    assert.deepEqual(await snapshot(), beforeFailure, 'upload alone never changes native drawing content');
    const all = await state(); record = all.documents.find(d => d.id === record.id);
    record = (await command('document.save', project.id, { snapshot: dirty, resources: dirty.resources }, record)).entity;
    records.push({ id: record.id, kind, source: result.source, sha256: result.sha256, snapshot: dirty });
    await page.screenshot({ path: path.join(temp, `${kind}.png`) });
    // Closing an editor during an upload cancels the browser request and prevents late insertion/change callbacks.
    let pendingRoute;
    const held = new Promise(resolve => { pendingRoute = resolve; });
    await page.route('**/api/artifacts/upload', route => pendingRoute(route));
    await page.evaluate(() => {
      window.closedResult = window.mountedEditor.insertImage(window.fixtureFile).then(() => 'unexpected insertion', error => error.message);
    });
    const route = await held;
    const changesBeforeClose = await page.evaluate(() => window.changes);
    await page.evaluate(() => { window.mountedEditor.dispose(); window.mountedEditor.dispose(); window.mountedEditor = null; });
    await route.abort().catch(() => {});
    assert.match(await page.evaluate(() => window.closedResult), /closed/);
    assert.equal(await page.evaluate(() => window.changes), changesBeforeClose);
    await page.unroute('**/api/artifacts/upload');
  }
  // A new OS process reopens the durable state and bytes; the previous page/cache is discarded.
  const oldPID = child.pid, port = Number(new URL(appURL).port);
  await page.close(); await stop(); await start(port); assert.notEqual(child.pid, oldPID);
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => !!window.office);
  for (const expected of records) {
    const record = (await state()).documents.find(d => d.id === expected.id);
    await mount(record);
    const reopened = await snapshot();
    assert.ok(JSON.stringify(reopened).includes(expected.sha256));
    assert.ok(JSON.stringify(reopened).includes('retained'));
    // The native renderer must paint the fixture too; a downloadable URL alone is insufficient.
    await page.waitForFunction(() => [...document.querySelectorAll('#editor canvas')].some(canvas => {
      const ctx = canvas.getContext('2d'); if (!ctx || !canvas.width || !canvas.height) return false;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 200 && pixels[i] < 245 && pixels[i + 1] > 50 && pixels[i + 1] < 110 && pixels[i + 2] > 20 && pixels[i + 2] < 80) red++;
      return red > 1000;
    }));
    await page.screenshot({ path: path.join(temp, `reopened-${expected.kind}.png`) });
    const decoded = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: image.naturalWidth, height: image.naturalHeight, pixel: [...ctx.getImageData(0, 0, 1, 1).data] };
    }, expected.source);
    assert.equal(decoded.width, 60); assert.equal(decoded.height, 40); assert.ok(decoded.pixel[0] > 200 && decoded.pixel[1] < 120);
    const bytes = await fetch(appURL + expected.source); assert.equal(bytes.status, 200);
    const hash = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
    assert.equal(Buffer.from(hash).toString('hex'), expected.sha256);
    await page.evaluate(() => { window.mountedEditor.dispose(); window.mountedEditor = null; });
  }
  assert.deepEqual(errors, []);
  const evidence = { result: 'PASSED', model: 'gpt-6.1-sol', reasoning: 'xhigh', fixtureDir: temp,
    checks: ['mounted Docs + Sheets PNG/JPEG insertion and both native file pickers', 'native image undo/redo', 'plugin resources + artifact SHA identity',
      'explicit non-active sheetId', 'stale/network/upload failure retains edits', 'server rejects cross-project images',
      'new process + new page reload and image pixel/hash decode', 'lost upload response replays the same receipt',
      'clean repeated dispose + cancel in-flight upload'], records: records.map(({ snapshot, ...r }) => r) };
  await writeFile(path.join(temp, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error('FIXTURE_DIR', temp);
  await page?.screenshot({ path: path.join(temp, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await vite?.close(); await stop();
}
