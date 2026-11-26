// Built production App + real loopback HTTP/SQLite. Disposable engineering data;
// no provider/compute calls, injected product state, or external accounts.
// Run: npm run build && node --test tests/product-navigation-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApplication } from '../app/server/main.mjs';
import { THEMES } from '../app/web/src/themes.mjs';
import { PINNED_PAGES } from '../app/web/src/shell-routes.mjs';
import { chooseTheme, openPalette, openRoute, setLanguage } from './support/app-shell.mjs';

test('production shell: every route via palette in TH/EN, sidebar threads, composer, tabs, Office guard, themes and narrow drawers', { timeout: 300000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forge-navigation-ui-'));
  t.diagnostic('Evidence: ' + directory);
  const app = await createApplication({ dataDir: path.join(directory, 'state'), machineSecretDir: path.join(directory, 'vault') });
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); });
  browser = await chromium.launch({ headless: true, ...(process.env.FORGE_TEST_BROWSER ? { executablePath: process.env.FORGE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' ? route.continue() : route.abort();
  });
  const page = await context.newPage(), errors = [], captures = [], contrast = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const source = await readFile(new URL('../app/web/src/App.jsx', import.meta.url), 'utf8');
  const navSource = source.slice(source.indexOf('  const nav = ['), source.indexOf('  const startT3'));
  const routes = [...navSource.matchAll(/\[['"]([^'"]+)['"],\s*\w+,\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\]/g)]
    .map(([, id, th, en]) => ({ id, th, en }));
  assert.equal(routes.length, 24);
  const sidebar = page.locator('aside.sidebar');
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const showNav = async () => {
    if (!await sidebar.locator('.side-new').isVisible()) await click('Menu');
    await sidebar.locator('.side-new').waitFor();
  };
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(directory, name + '.png');
    await page.screenshot({ path: file, fullPage: false }); captures.push(file);
  };
  // The breadcrumb names the shown page; a pinned route is also current in the sidebar
  // and every non-home route is the current tab. Never more than one current item each.
  const current = async (route, lang) => {
    const label = route[lang];
    await page.locator('.crumb-page').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}$`) }).waitFor();
    assert.ok(await sidebar.locator('[aria-current="page"]').count() <= 1, route.id + ' single sidebar current');
    if (PINNED_PAGES.includes(route.id) || route.id === 'settings')
      assert.equal(await sidebar.getByRole('button', { name: label, exact: true, includeHidden: true }).getAttribute('aria-current'), 'page', route.id + ' sidebar current');
    if (route.id !== 'overview') {
      const tab = page.getByRole('navigation', { name: lang === 'en' ? 'Open pages' : 'หน้าที่เปิดอยู่' }).locator('[aria-current="page"]');
      assert.equal(await tab.count(), 1, route.id + ' single current tab');
      assert.equal((await tab.innerText()).trim(), label, route.id + ' current tab label');
    }
  };
  const fits = async label => {
    assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true, label + ' document overflow');
    const bad = await sidebar.evaluate(aside => {
      const bounds = aside.getBoundingClientRect();
      return [...aside.querySelectorAll('button,a,.side-label,.thread-title')].filter(e => {
        const r = e.getBoundingClientRect();
        return e.checkVisibility() && r.width && r.height && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
      }).map(e => e.textContent);
    });
    assert.deepEqual(bad, [], label + ' sidebar bounds');
  };
  const auditContrast = async (label, root, selector) => {
    const result = await root.evaluate((node, selector) => {
      const rgb = s => s.match(/[\d.]+/g).map(Number);
      const lum = a => a.slice(0, 3).map(c => (c /= 255) <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [.2126, .7152, .0722][i], 0);
      const results = [];
      for (const e of node.querySelectorAll(selector)) {
        if (!e.checkVisibility() || !e.getBoundingClientRect().height || !(e.textContent || e.placeholder)) continue;
        const cs = getComputedStyle(e), placeholder = e.tagName === 'INPUT' && !e.value;
        let bg;
        for (let p = e; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c.length === 3 || c[3] === 1) { bg = c; break; } }
        bg ??= rgb(getComputedStyle(document.body).backgroundColor);
        const a = lum(rgb(placeholder ? getComputedStyle(e, '::placeholder').color : cs.color)), b = lum(bg);
        results.push({ text: (e.textContent || e.placeholder).trim().slice(0, 40), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) });
      }
      return results;
    }, selector);
    assert.ok(result.length > 0, label + ' visible text audited');
    assert.deepEqual(result.filter(row => row.ratio < 4.485), [], label + ' text contrast');
    contrast.push({ label, minimum: Math.min(...result.map(row => row.ratio)), elements: result.length });
  };
  const SHELL_TEXT = '.side-label,.thread-title,.thread-time,.side-heading span,.side-empty,.project-switcher-name,.brand-word,.crumb-project,.crumb-page,.page-tab-open span';
  const PALETTE_TEXT = '.palette-label,.palette-hint,.palette-group-label,.palette-empty,.palette-foot span,input';

  // First run: no project. Quiet sidebar, composer-style empty state.
  await page.goto(app.url + '/app');
  await page.getByRole('heading', { level: 1, name: 'เริ่มจากไอเดียของคุณ', exact: true }).waitFor();
  assert.equal(app.store.read().projects.length, 0);
  assert.equal(await sidebar.locator('.side-section').last().getByRole('button').count(), PINNED_PAGES.length + 1, 'six pinned surfaces and All tools');
  assert.equal(await sidebar.getByRole('button', { name: 'ทีมผู้ช่วย AI' }).count() + await sidebar.getByRole('button', { name: 'ความจำของ AI' }).count(), 0, 'unpinned routes stay in the palette');
  await shot('empty-th-1440-dark-modern');
  await setLanguage(page, 'en');

  // Keyboard: Ctrl+K opens a modal combobox, arrows move the active option, Escape restores focus.
  await sidebar.getByRole('button', { name: 'New AI product', exact: true }).focus();
  await page.keyboard.press('Control+K');
  const combo = page.getByRole('dialog', { name: 'Search and commands' }).getByRole('combobox');
  await combo.waitFor();
  assert.equal(await combo.evaluate(e => e === document.activeElement), true, 'palette focuses its input');
  const firstActive = await combo.getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await combo.getAttribute('aria-activedescendant'), firstActive, 'ArrowDown moves the active option');
  await page.keyboard.press('Tab');
  assert.equal(await combo.evaluate(e => e === document.activeElement), true, 'Tab stays inside the palette');
  assert.equal(await page.getByRole('listbox').getByRole('option').and(page.locator('[data-kind="page"]')).count(), routes.length, 'All tools lists every route');
  await shot('palette-all-tools');
  await page.keyboard.press('Escape');
  await combo.waitFor({ state: 'detached' });
  assert.equal(await sidebar.getByRole('button', { name: 'New AI product', exact: true }).evaluate(e => e === document.activeElement && e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'), true, 'focus restored with a visible ring');

  // Create the project from the project switcher.
  await sidebar.getByRole('button', { name: /^Switch project:/ }).click();
  await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Navigation engineering fixture · ทดสอบ');
  await page.getByLabel('Workspace directory', { exact: true }).fill(path.join(directory, 'workspace'));
  await click('Create project');
  await page.getByRole('heading', { level: 1, name: 'What do you want to do?', exact: true }).waitFor();
  assert.equal(app.store.read().projects.length, 1);

  // Required palette path: Ctrl+K → "report" → Enter opens Report Studio.
  await page.keyboard.press('Control+K');
  await combo.fill('report');
  await page.keyboard.press('Enter');
  await current(routes.find(r => r.id === 'reports'), 'en');
  await page.getByRole('heading', { level: 1, name: /Report Studio/ }).waitFor();

  // Every route by its visible name, in both languages.
  for (const lang of ['en', 'th']) {
    await setLanguage(page, lang);
    for (const route of routes) { await openRoute(page, route[lang]); await current(route, lang); }
  }
  await setLanguage(page, 'en');
  // Ranked search: an upper-case English name and a Thai name both resolve with Enter.
  for (const route of routes) {
    const box = await openPalette(page);
    await box.fill(route.en.toUpperCase()); await page.keyboard.press('Enter'); await current(route, 'en');
  }
  let box = await openPalette(page);
  await box.fill('ความจำของ AI'); await page.keyboard.press('Enter');
  await current(routes.find(r => r.id === 'memory'), 'en');
  box = await openPalette(page);
  await box.fill('no-such-tool-xyz');
  await page.getByRole('status').filter({ hasText: '0 results' }).waitFor();
  await page.getByText('Nothing matches “no-such-tool-xyz”. Try another word or the Thai name.', { exact: true }).waitFor();
  await shot('palette-no-results');
  await auditContrast('dark-modern palette empty', page.locator('.palette'), PALETTE_TEXT);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Search and commands' }).evaluate(e => e === document.activeElement), true, 'Escape returns focus to the trigger');

  // Home composer: chips route through the guard; "Start building" hands the prompt to
  // AI Product Studio; "Just chat" creates a real conversation with the message.
  await sidebar.getByRole('button', { name: 'FORGE home' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Write a doc or sheet', exact: true }).click();
  await current(routes.find(r => r.id === 'office'), 'en');
  await sidebar.getByRole('button', { name: 'New AI product', exact: true }).click();
  const composer = page.getByLabel('Describe what you want to do', { exact: true });
  await page.waitForFunction(() => document.activeElement?.matches('.composer textarea'));
  assert.equal(await page.getByRole('button', { name: 'Start building', exact: true }).isDisabled(), true, 'empty prompt cannot start');
  await composer.fill('Forecast weekly orders from the fixture CSV');
  await composer.press('Enter');
  await current(routes.find(r => r.id === 'studio'), 'en');
  await page.getByText('Forecast weekly orders from the fixture CSV', { exact: true }).waitFor();
  assert.equal(app.store.read().conversations.length, 0, 'building does not create a conversation');
  await sidebar.getByRole('button', { name: 'FORGE home' }).click();
  await composer.fill('Summarise the fixture records');
  await page.getByRole('button', { name: 'Just chat', exact: true }).click();
  await page.locator('.conversation h2').filter({ hasText: 'Summarise the fixture records' }).waitFor();
  let saved = app.store.read().conversations;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].text, 'Summarise the fixture records');
  assert.equal(await sidebar.locator('.thread-row[aria-current="page"]').innerText().then(s => s.includes('Summarise the fixture records')), true);

  // Sidebar threads open the chosen conversation in Chat.
  const csrf = (await (await page.request.get(app.url + '/api/session')).json()).csrf;
  const projectId = app.store.read().projects[0].id;
  await page.request.post(app.url + '/api/command', { headers: { 'X-Forge-CSRF': csrf }, data: { operationId: crypto.randomUUID(), type: 'conversation.create', projectId, data: { name: 'Second fixture thread', kind: 'team' } } });
  await sidebar.getByRole('button', { name: /Second fixture thread/ }).click();
  await page.locator('.conversation h2').filter({ hasText: 'Second fixture thread' }).waitFor();
  assert.equal(await sidebar.getByRole('button', { name: /Second fixture thread/ }).getAttribute('aria-current'), 'page');
  await shot('chat-from-sidebar-thread');

  // Collapse to the icon rail with Ctrl+B; rail and tabs survive a reload.
  await page.keyboard.press('Control+B');
  await page.waitForFunction(() => document.querySelector('aside.sidebar').getBoundingClientRect().width <= 60);
  const tabsBefore = await page.locator('.page-tab-open').allInnerTexts();
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'What do you want to do?' }).waitFor();
  assert.ok((await sidebar.boundingBox()).width <= 60, 'collapsed rail persists');
  assert.deepEqual(await page.locator('.page-tab-open').allInnerTexts(), tabsBefore, 'open tabs persist');
  await shot('rail-collapsed');
  await page.keyboard.press('Control+B');
  await page.waitForFunction(() => document.querySelector('aside.sidebar').getBoundingClientRect().width >= 250);

  // Theme switching uses the real chooser and settings update; audit chrome and palette text.
  assert.equal(THEMES.length, 15);
  await openRoute(page, 'Plan & tasks');
  for (const theme of THEMES) {
    await chooseTheme(page, theme.label);
    await page.waitForFunction(id => document.documentElement.dataset.theme === id, theme.id);
    await auditContrast(theme.id + ' shell', page.locator('.workbench'), SHELL_TEXT);
    await sidebar.getByRole('button', { name: 'Docs & sheets', exact: true }).hover(); await auditContrast(theme.id + ' row hover', sidebar, SHELL_TEXT);
    await sidebar.getByRole('button', { name: 'Plan & tasks', exact: true }).hover(); await auditContrast(theme.id + ' current hover', sidebar, SHELL_TEXT);
    const search = await openPalette(page);
    await auditContrast(theme.id + ' palette', page.locator('.palette'), PALETTE_TEXT);
    await search.fill('doc'); await auditContrast(theme.id + ' palette results', page.locator('.palette'), PALETTE_TEXT);
    await search.fill('zz-no-tool'); await auditContrast(theme.id + ' palette empty', page.locator('.palette'), PALETTE_TEXT);
    await page.keyboard.press('Escape');
    if (['light-modern', 'high-contrast-dark'].includes(theme.id)) await shot('shell-' + theme.id);
  }
  await chooseTheme(page, 'Dark Modern');

  // Narrow widths: the sidebar is a drawer that fits, and choosing a route closes it.
  for (const lang of ['en', 'th']) {
    await setLanguage(page, lang);
    const settings = routes.find(r => r.id === 'settings');
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await showNav(); await fits(lang + width);
      await shot(`drawer-${lang}-${width}`);
      if (width < 960) for (const target of await sidebar.locator('.side-row:visible, .thread-row:visible, .side-new').all())
        assert.ok((await target.boundingBox()).height >= 43.5, 'touch target height ' + width);
      await sidebar.getByRole('button', { name: settings[lang], exact: true }).click();
      if (width < 960) assert.equal(await sidebar.locator('.side-new').isVisible(), false, 'route closes drawer');
      await current(settings, lang); await fits('active settings ' + lang + width);
      const search = await openPalette(page);
      const usable = (await page.locator('.palette-backdrop').boundingBox()).width;
      assert.ok((await page.locator('.palette').boundingBox()).width >= Math.min(usable - 20, 600), 'palette uses the available width ' + width);
      await search.fill(lang === 'en' ? 'Overview' : 'หน้าแรก'); await page.keyboard.press('Enter');
    }
  }

  // Real Office rename creates dirty state while the actual Univer editor is mounted.
  await setLanguage(page, 'en');
  await openRoute(page, 'Docs & sheets'); await click('+ Create document');
  await page.getByLabel('Document name', { exact: true }).fill('Unsaved navigation guard fixture');
  await click('Create & open');
  const nameBox = page.locator('[data-u-comp="defined-name"] input');
  await nameBox.waitFor({ timeout: 45000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Bounded agent edit' && !button.disabled));
  await page.getByLabel('Rename document', { exact: true }).fill('Unsaved local document name');
  await page.locator('.editor-toolbar').getByText('unsaved', { exact: true }).waitFor();
  const guard = page.getByRole('alertdialog', { name: 'Unsaved document' });
  const office = routes.find(r => r.id === 'office');
  // Palette navigation is guarded.
  await openRoute(page, 'Settings').catch(() => {});
  await guard.waitFor();
  assert.equal((await page.locator('.crumb-page').innerText()).trim(), 'Docs & sheets');
  await guard.getByRole('button', { name: 'Return to editor', exact: true }).click();
  await current(office, 'en');
  // Closing the active Office tab is guarded.
  await page.getByRole('button', { name: 'Close Docs & sheets tab', exact: true }).click();
  await guard.waitFor();
  await guard.getByRole('button', { name: 'Return to editor', exact: true }).click();
  await current(office, 'en');
  // Sidebar navigation is guarded; discarding leaves without saving.
  await sidebar.getByRole('button', { name: 'Plan & tasks', exact: true }).click(); await guard.waitFor();
  await shot('unsaved-office-navigation-guard');
  await guard.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await current(routes.find(r => r.id === 'plan'), 'en');
  assert.equal(app.store.read().documents[0].name, 'Unsaved navigation guard fixture', 'discard does not save unsaved document name');
  assert.equal(app.store.read().runs.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ qualification: 'Real built production App / HTTP / disposable SQLite. No providers. HOME_UAT_NOT_RUN. Independent design review pending.', routes, captures, contrast, pageErrors: errors }, null, 2));
});
