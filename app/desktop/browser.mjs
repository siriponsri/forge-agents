import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fault, aborted, text } from './common.mjs';

export const browserCapabilities = ['inspect', 'screenshot', 'focus', 'type', 'click', 'key', 'navigate', 'wait'];

export function browserConfig(input = {}) {
  if (input.mode && input.mode !== 'owned') throw fault('VALIDATION', 'Only FORGE-owned isolated browser sessions are supported; existing owner sessions are never attached');
  return { mode: 'owned', headless: input.headless !== false };
}

export function createBrowserDriver({ config, targetId }) {
  let browser, context, page, starting;
  async function library() {
    try { return await import('playwright'); }
    catch { throw fault('DEPENDENCY', 'Playwright runtime is missing. Run FORGE dependency setup, then Install browser in Desktop Targets.', 503); }
  }
  async function ensure() {
    if (page && !page.isClosed()) return;
    if (!starting) starting = (async () => {
      const { chromium } = await library();
      try {
        browser = await chromium.launch({ headless: config.headless });
        context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
        // Popups are never adopted as another control surface.
        page = await context.newPage();
        context.on('page', p => { if (p !== page) void p.close().catch(() => {}); });
      } catch { await close(); throw fault('BROWSER_MISSING', 'Chromium could not launch. Use Install browser in Desktop Targets; check interactive desktop when headed.', 503); }
    })().finally(() => { starting = undefined; });
    return starting;
  }
  async function close() {
    const owned = browser; browser = context = page = undefined;
    await owned?.close().catch(() => {});
  }
  return {
    resourceKey: `browser:${targetId}`,
    async install() {
      await library();
      const require = createRequire(import.meta.url);
      const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      // Fixed package CLI and argument vector: no caller supplied executable/arguments.
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'install', 'chromium'], { windowsHide: true, stdio: 'ignore', timeout: 180000 });
        child.once('error', () => reject(fault('BROWSER_INSTALL', 'Chromium installation failed; check network and disk space', 503)));
        child.once('exit', code => code === 0 ? resolve() : reject(fault('BROWSER_INSTALL', 'Chromium installation failed; check network and disk space', 503)));
      });
      return { installed: true };
    },
    async health() {
      try { await ensure(); return { ready: true, capabilities: browserCapabilities, identity: { kind: 'browser', targetId, ownership: 'FORGE isolated context', engine: 'chromium' } }; }
      catch (e) { return { ready: false, capabilities: [], blocker: { code: e.code ?? 'BROWSER_UNAVAILABLE', message: e.message, action: 'installBrowser' } }; }
    },
    async listWindows() { await ensure(); return [{ id: targetId, title: await page.title(), identity: { kind: 'browser', targetId, ownership: 'FORGE isolated context' } }]; },
    async acquire(windowId) { await ensure(); if (windowId !== targetId) throw fault('TARGET_IDENTITY', 'Select this FORGE-owned browser window'); return { windowId }; },
    async action(name, args, { signal, dispatch }) {
      aborted(signal); await ensure(); aborted(signal);
      const ownedPage = page;
      const timeout = args.timeoutMs ?? 5000;
      const locator = () => {
        const selector = text(args.selector, 'selector', 1000);
        if (!selector.startsWith('css=') && !selector.startsWith('role=')) throw fault('VALIDATION', 'Use css= or role= selectors from inspection; script selectors are unsupported');
        return ownedPage.locator(selector);
      };
      if (name === 'inspect') return { title: await ownedPage.title(), url: ownedPage.url(), tree: (await ownedPage.locator('body').ariaSnapshot({ timeout })).slice(0, 60000) };
      if (name === 'screenshot') return { png: await ownedPage.screenshot({ timeout, animations: 'disabled', fullPage: false }) };
      if (name === 'focus') { dispatch(); await ownedPage.bringToFront(); return { focused: true }; }
      if (name === 'navigate') {
        let url; try { url = new URL(text(args.url, 'url', 8192)); } catch { throw fault('VALIDATION', 'Choose an http(s) URL'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fault('VALIDATION', 'Only http(s) navigation without embedded credentials is supported');
        dispatch(); await ownedPage.goto(url.href, { timeout, waitUntil: 'domcontentloaded' }); return { url: ownedPage.url() };
      }
      const selected = locator();
      // Resolve before dispatch so a missing selector is a definite no-input outcome.
      if (await selected.count() !== 1) throw fault('ELEMENT_SCOPE', 'Selector must identify exactly one element');
      if (name === 'click') { dispatch(); await selected.click({ timeout, noWaitAfter: true }); return { clicked: true }; }
      if (name === 'type') { dispatch(); await selected.fill(args.text, { timeout }); return { typed: true, mode: 'replace' }; }
      if (name === 'key') { dispatch(); await selected.press(args.key, { timeout }); return { key: args.key }; }
      throw fault('CAPABILITY', 'Unsupported browser action');
    },
    // Closing this owned browser interrupts pending Playwright calls; never closes an external session.
    async stop() { const pending = starting; await close(); if (pending) { await pending.catch(() => {}); await close(); } },
    async shutdown() { await this.stop(); },
  };
}
