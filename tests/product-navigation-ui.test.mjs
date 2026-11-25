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

test('production navigation: every route, bilingual discovery, disclosures, Office guard, themes and narrow drawers', { timeout: 240000 }, async t => {
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
  assert.equal(routes.length, 23);
  const navigation = page.locator('.sidebar nav');
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const showNav = async () => {
    if (!await navigation.isVisible()) await click('Menu');
  };
  const nav = async name => {
    await showNav();
    const route = navigation.getByRole('button', { name, exact: true, includeHidden: true });
    const group = route.locator('xpath=ancestor::details[1]');
    if (await group.count() && !await group.evaluate(element => element.open)) await group.locator('summary').click();
    await route.click();
  };
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(directory, name + '.png');
    await page.screenshot({ path: file, fullPage: false }); captures.push(file);
  };
  const current = async name => {
    await navigation.getByRole('button', { name, exact: true, includeHidden: true }).and(page.locator('[aria-current="page"]')).waitFor({ state: 'attached' });
    assert.equal(await navigation.locator('[aria-current="page"]').count(), 1);
  };
  const fits = async label => {
    assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true, label + ' document overflow');
    const bad = await page.locator('.sidebar').evaluate(sidebar => {
      const bounds = sidebar.getBoundingClientRect();
      return [...sidebar.querySelectorAll('button,input,summary,.nav-label')].filter(e => {
        const r = e.getBoundingClientRect();
        return e.checkVisibility() && r.width && r.height && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
      }).map(e => e.textContent);
    });
    assert.deepEqual(bad, [], label + ' sidebar bounds');
  };
  const auditContrast = async label => {
    const result = await navigation.evaluate(nav => {
      const rgb = s => s.match(/[\d.]+/g).map(Number);
      const lum = a => a.slice(0, 3).map(c => (c /= 255) <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [.2126, .7152, .0722][i], 0);
      const results = [];
      for (const e of nav.querySelectorAll('summary,input,.nav-label,.workspace-nav-status')) {
        if (!e.checkVisibility() || !e.getBoundingClientRect().height) continue;
        const cs = getComputedStyle(e), placeholder = e.tagName === 'INPUT' && !e.value;
        let bg;
        for (let p = e; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c.length === 3 || c[3] === 1) { bg = c; break; } }
        const a = lum(rgb(placeholder ? getComputedStyle(e, '::placeholder').color : cs.color)), b = lum(bg);
        results.push({ text: e.textContent || e.placeholder || e.value, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) });
      }
      return results;
    });
    assert.ok(result.length > 0, label + ' visible text audited');
    assert.deepEqual(result.filter(row => row.ratio < 4.485), [], label + ' text contrast');
    contrast.push({ label, minimum: Math.min(...result.map(row => row.ratio)), elements: result.length });
  };

  await page.goto(app.url + '/app');
  await navigation.getByRole('button', { name: 'ภาพรวม', exact: true }).waitFor();
  assert.equal(app.store.read().projects.length, 0);
  assert.deepEqual(await navigation.locator('details').evaluateAll(nodes => nodes.map(e => e.open)), [true, false, false, false]);
  assert.equal(await navigation.getByRole('button').count(), 5, 'five initial route choices');
  await shot('empty-th-1440-dark-modern');
  await page.getByLabel('Language', { exact: true }).selectOption('en');

  const createGroup = navigation.locator('details').nth(1), summary = createGroup.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await createGroup.evaluate(e => e.open), true);
  await page.keyboard.press('Space');
  assert.equal(await createGroup.evaluate(e => e.open), false);
  assert.equal(await summary.evaluate(e => e === document.activeElement && e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'), true);
  await shot('summary-keyboard-focus');

  await click('+ Create project');
  await page.getByLabel('Project name', { exact: true }).fill('Navigation engineering fixture · ทดสอบ');
  await page.getByLabel('Workspace directory', { exact: true }).fill(path.join(directory, 'workspace'));
  await click('Create project');
  await page.getByRole('heading', { level: 1, name: 'Workspace overview', exact: true }).waitFor();
  assert.equal(app.store.read().projects.length, 1);

  // All existing accessible names survive, in both languages, with native disclosure.
  for (const lang of ['en', 'th']) {
    await page.getByLabel('Language', { exact: true }).selectOption(lang);
    for (const route of routes) {
      await nav(route[lang]); await current(route[lang]);
      const activeGroup = navigation.locator('details').filter({ has: navigation.getByRole('button', { name: route[lang], exact: true }) });
      if (await activeGroup.count()) assert.equal(await activeGroup.evaluate(e => e.open), true, route.id);
      assert.ok((await page.locator('.topbar-title').innerText()).includes(route.en));
    }
  }
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await nav('Overview');
  await page.getByRole('main').getByRole('button', { name: /Docs & sheets/ }).click();
  await current('Docs & sheets');
  assert.equal(await createGroup.evaluate(e => e.open), true, 'Overview quick action reopens active group');

  // Search works across TH/EN and returns the unchanged ordinary route buttons.
  for (const route of routes) {
    await navigation.getByRole('searchbox', { name: 'Find a tool', exact: true }).fill(route.en.toUpperCase());
    await navigation.getByRole('button', { name: route.en, exact: true }).click(); await current(route.en);
  }
  await navigation.getByRole('searchbox').fill('ความจำและความรู้');
  await navigation.getByRole('searchbox').press('Tab'); // clear search
  await page.keyboard.press('Tab'); // the ordinary result button
  assert.equal(await navigation.getByRole('button', { name: 'Memory Studio', exact: true }).evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Enter');
  await current('Memory Studio');
  await navigation.getByRole('searchbox').fill('no-such-tool-xyz');
  assert.ok(await page.getByRole('button', { name: 'Clear tool search', exact: true }).evaluate(e => e.getBoundingClientRect().width <= 44), 'clear is a compact end control');
  await navigation.getByRole('searchbox').click({ position: { x: 55, y: 20 } });
  assert.equal(await navigation.getByRole('searchbox').evaluate(e => e === document.activeElement), true, 'clear does not cover the search field');
  await navigation.getByRole('status').filter({ hasText: 'No tools found' }).waitFor();
  await shot('search-no-results');
  await navigation.getByRole('searchbox').press('Escape');
  assert.equal(await navigation.getByRole('searchbox').inputValue(), '');
  assert.equal(await navigation.getByRole('searchbox').evaluate(e => e === document.activeElement), true);
  assert.equal(await navigation.locator('details').nth(2).evaluate(e => e.open), true, 'clear reopens active route group');
  await navigation.getByRole('searchbox').fill('plan'); await click('Clear tool search');
  assert.equal(await navigation.getByRole('searchbox').evaluate(e => e === document.activeElement), true);

  await nav('Overview');
  await shot('default-project-en-1440-dark-modern');
  // Theme switching uses the real chooser and settings update, not token injection.
  assert.equal(THEMES.length, 15);
  for (const theme of THEMES) {
    await page.getByRole('button', { name: /^Choose theme:/ }).click();
    await page.getByRole('radio', { name: theme.label, exact: true }).click();
    await page.waitForFunction(id => document.documentElement.dataset.theme === id, theme.id);
    await auditContrast(theme.id + ' default');
    await navigation.locator('summary').nth(1).hover(); await auditContrast(theme.id + ' summary hover');
    await navigation.getByRole('button', { name: 'Overview', exact: true }).hover(); await auditContrast(theme.id + ' active hover');
    await navigation.getByRole('searchbox').fill('zz-no-tool'); await auditContrast(theme.id + ' no results');
    await click('Clear tool search');
    if (['light-modern', 'high-contrast-dark'].includes(theme.id)) await shot('navigation-' + theme.id);
  }
  await page.getByRole('button', { name: /^Choose theme:/ }).click();
  await page.getByRole('radio', { name: 'Dark Modern', exact: true }).click();

  for (const lang of ['en', 'th']) {
    await page.getByLabel('Language', { exact: true }).selectOption(lang);
    const label = routes.find(r => r.id === 'settings')[lang];
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await showNav(); await fits(lang + width);
      await shot(`drawer-${lang}-${width}`);
      await navigation.getByRole('searchbox').fill(lang === 'en' ? 'Settings' : 'ตั้งค่า');
      await navigation.getByRole('button', { name: label, exact: true }).click();
      if (width < 960) assert.equal(await navigation.isVisible(), false, 'route closes drawer');
      await showNav();
      await click(lang === 'en' ? 'Clear tool search' : 'ล้างการค้นหาเครื่องมือ');
      await current(label); await fits('active settings ' + lang + width);
      assert.equal(await navigation.locator('details').last().evaluate(e => e.open), true);
      await nav(lang === 'en' ? 'Overview' : 'ภาพรวม');
    }
  }

  // Real Office rename creates dirty state while the actual Univer editor is mounted.
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await nav('Docs & sheets'); await click('+ Create document');
  await page.getByLabel('Document name', { exact: true }).fill('Unsaved navigation guard fixture');
  await click('Create & open');
  const nameBox = page.locator('[data-u-comp="defined-name"] input');
  await nameBox.waitFor({ timeout: 45000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Bounded agent edit' && !button.disabled));
  await page.getByLabel('Rename document', { exact: true }).fill('Unsaved local document name');
  await page.locator('.editor-toolbar').getByText('unsaved', { exact: true }).waitFor();
  await navigation.getByRole('searchbox').fill('Settings');
  await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
  const guard = page.getByRole('alertdialog', { name: 'Unsaved document' });
  await guard.waitFor();
  assert.ok((await page.locator('.topbar-title').innerText()).includes('Docs & sheets'));
  await guard.getByRole('button', { name: 'Return to editor', exact: true }).click();
  await click('Clear tool search'); await current('Docs & sheets');
  await nav('Plan & tasks'); await guard.waitFor();
  await shot('unsaved-office-navigation-guard');
  await guard.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await current('Plan & tasks');
  assert.equal(app.store.read().documents[0].name, 'Unsaved navigation guard fixture', 'discard does not save unsaved document name');
  assert.equal(app.store.read().runs.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ qualification: 'Real built production App / HTTP / disposable SQLite. No providers. HOME_UAT_NOT_RUN. Independent design review pending.', routes, captures, contrast, pageErrors: errors }, null, 2));
});
