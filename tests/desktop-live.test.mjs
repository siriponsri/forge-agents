import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../app/server/store.mjs';
import { createDesktopService } from '../app/desktop/index.mjs';
import { wait } from '../app/desktop/common.mjs';

async function harness(t, prefix) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const store = await openStore(dataDir);
  await store.transaction(s => s.projects.push({ id: 'fixture-project' }));
  const service = createDesktopService({ dataDir, store });
  t.after(async () => { await service.shutdown(); await store.close(); if (process.env.FORGE_DESKTOP_KEEP_EVIDENCE !== '1') await rm(dataDir, { recursive: true, force: true }); });
  const base = { projectId: 'fixture-project', targetId: 'fixture-target' };
  const acquire = windowId => service.acquire({ ...base, windowId, controllerId: 'fixture-controller', attemptId: 'fixture-attempt' });
  let sequence = 0;
  const action = (lease, name, args = {}) => service.action({ ...base, ...lease, operationId: `fixture-op-${++sequence}`, name, arguments: args });
  return { dataDir, service, store, base, acquire, action };
}

test('LIVE owned Chromium: navigate, read, type, click, screenshot and revoke blocked input', { skip: process.env.FORGE_DESKTOP_LIVE_BROWSER !== '1', timeout: 60000 }, async t => {
  const h = await harness(t, 'forge-browser-evidence-');
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>FORGE disposable browser fixture</title><label>Name <input id="name" aria-label="Name"></label><button id="apply" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Apply fixture</button><p id="result">Untouched</p><button id="blocked" disabled>Blocked fixture</button>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  await h.service.setup({ ...h.base, name: 'FORGE disposable browser', kind: 'browser', config: { mode: 'owned', headless: true } });
  assert.equal((await h.service.health(h.base)).ready, true);
  const windows = await h.service.listWindows(h.base); assert.equal(windows.windows.length, 1);
  const lease = await h.acquire(windows.windows[0].id);
  assert.equal((await h.action(lease, 'navigate', { url: `http://127.0.0.1:${server.address().port}` })).status, 'completed');
  assert.equal((await h.action(lease, 'type', { selector: 'css=#name', text: 'ทดสอบ FORGE browser' })).status, 'completed');
  assert.equal((await h.action(lease, 'key', { selector: 'css=#name', key: 'End' })).status, 'completed');
  assert.equal((await h.action(lease, 'click', { selector: 'css=#apply' })).status, 'completed');
  const inspected = await h.action(lease, 'inspect'); assert.match(inspected.result.tree, /ทดสอบ FORGE browser/);
  const shot = await h.action(lease, 'screenshot'); assert.equal(shot.status, 'completed');
  const file = await h.service.screenshot({ ...h.base, artifactId: shot.result.artifactId }); assert.deepEqual((await readFile(file.path)).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const pending = h.action(lease, 'click', { selector: 'css=#blocked', timeoutMs: 30000 }); await wait(250);
  const started = Date.now(); const stop = await h.service.stop({ ...h.base, ...lease });
  assert.ok(Date.now() - started < 3000); assert.equal((await pending).status, 'unknown'); assert.equal(stop.controlState, 'stopped');
  await assert.rejects(h.action(lease, 'inspect'), { code: 'LEASE_REQUIRED' });
  // A fresh lease creates a fresh FORGE page, without reconnecting the revoked session.
  const next = await h.acquire(h.base.targetId);
  assert.equal((await h.action(next, 'inspect')).result.url, 'about:blank');
  const waiting = h.action(next, 'wait', { ms: 30000 }); await wait(100);
  assert.equal((await h.service.takeover(h.base)).controlState, 'human_control'); assert.equal((await waiting).status, 'cancelled');
  const evidence = { scope: 'Live FORGE-owned headless Chromium only; not native or guest proof', status: 'PASSED', screenshot: file.path, checks: ['navigation','read','Unicode replacement text','targeted key','click postcondition','PNG integrity','Stop interrupts blocked Playwright input','stale lease rejected','fresh isolated context after Stop','Take over cancels wait'] };
  await writeFile(path.join(h.dataDir, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ ...evidence, evidenceDir: h.dataDir }));
});

test('LIVE native Windows: owned disposable WinForms text, click, key, screenshot and takeover', { skip: process.env.FORGE_DESKTOP_LIVE_NATIVE !== '1' || process.platform !== 'win32', timeout: 120000 }, async t => {
  const h = await harness(t, 'forge-native-evidence-');
  const title = `FORGE disposable native fixture ${crypto.randomUUID()}`;
  const ready = path.join(h.dataDir, 'fixture-ready.txt');
  // This explicitly authorized, labelled fixture must be visible to exercise native UIA.
  const fixture = spawn('powershell.exe', ['-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../app/desktop/native-fixture.ps1', import.meta.url)), ready, title], { windowsHide: false, stdio: 'ignore' });
  t.after(async () => { if (fixture.exitCode === null) { const exited = once(fixture, 'exit'); fixture.kill(); await exited; } });
  for (let n = 0;; n++) { try { await readFile(ready); break; } catch { if (n > 100 || fixture.exitCode !== null) throw new Error('Owned native fixture failed to open'); await wait(100); } }
  await h.service.setup({ ...h.base, name: 'Owned native fixture', kind: 'windows' });
  const health = await h.service.health(h.base); assert.equal(health.ready, true, JSON.stringify(health));
  const windows = await h.service.listWindows(h.base); const selected = windows.windows.find(w => w.title === title);
  assert.ok(selected, 'Only the exact UUID-labelled disposable window may be selected');
  assert.equal(selected.identity.processId, fixture.pid);
  const lease = await h.acquire(selected.id);
  const inspect = await h.action(lease, 'inspect'); assert.equal(inspect.status, 'completed', JSON.stringify(inspect));
  const edit = inspect.result.elements.find(e => e.automationId === '101');
  const button = inspect.result.elements.find(e => e.automationId === '102'); assert.ok(edit); assert.ok(button);
  const typed = await h.action(lease, 'type', { elementId: edit.elementId, text: 'ทดสอบ FORGE native Windows' });
  assert.equal(typed.result?.verified, true, JSON.stringify(typed));
  assert.equal((await h.action(lease, 'key', { elementId: edit.elementId, key: 'End' })).status, 'completed');
  const clicked = await h.action(lease, 'click', { elementId: button.elementId }); assert.equal(clicked.status, 'completed');
  const after = await h.action(lease, 'inspect');
  assert.ok(after.result.elements.some(e => e.value === 'ทดสอบ FORGE native Windows'));
  assert.ok(after.result.elements.some(e => e.name === 'Fixture clicked'));
  const screenshot = await h.action(lease, 'screenshot'); assert.equal(screenshot.status, 'completed', JSON.stringify(screenshot));
  const image = await h.service.screenshot({ ...h.base, artifactId: screenshot.result.artifactId }); assert.deepEqual((await readFile(image.path)).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const waiting = h.action(lease, 'wait', { ms: 30000 }); await wait(1500);
  const start = Date.now(); const takeover = await h.service.takeover(h.base); assert.equal(takeover.controlState, 'human_control'); assert.ok(Date.now() - start < 3000);
  assert.equal((await waiting).status, 'cancelled'); await assert.rejects(h.action(lease, 'type', { elementId: edit.elementId, text: 'forbidden stale input' }), { code: 'LEASE_REQUIRED' });
  const next = await h.acquire(selected.id);
  const delayed = inspect.result.elements.find(e => e.automationId === '104'); assert.ok(delayed);
  const blocked = h.action(next, 'click', { elementId: delayed.elementId, timeoutMs: 30000 });
  // The exact owned fixture confirms its window handler is now executing the input.
  for (let n = 0;; n++) { try { await readFile(`${ready}.dispatch`); break; } catch { if (n > 100) throw new Error('Delayed owned native handler never received input'); await wait(50); } }
  const stopping = Date.now(); await h.service.stop({ ...h.base, ...next });
  assert.ok(Date.now() - stopping < 3000); assert.equal((await blocked).status, 'unknown');
  await assert.rejects(h.action(next, 'inspect'), { code: 'LEASE_REQUIRED' });
  const evidence = { scope: 'Live disposable Win32 controls in owned WinForms host; no existing owner window modified; not guest proof', status: 'PASSED', windows: health.identity.platform, sessionId: health.identity.sessionId, selectedIdentity: selected.identity, screenshot: image.path, textMode: typed.result.mode, clickMode: clicked.result.mode, checks: ['exact owned HWND/PID/start/session','UIA inspect','Unicode text + observed postcondition','click + observed postcondition','targeted native Edit key','target-only PNG capture','Take over aborts bounded wait','Stop kills helper during dispatched native handler; outcome unknown, not undone','stale lease input refused'] };
  await writeFile(path.join(h.dataDir, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ ...evidence, evidenceDir: h.dataDir }));
});
