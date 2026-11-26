// App-shell screenshots from the real built app with disposable engineering data.
// No provider calls. npm run build; node app/web/tests/app-shell-media.mjs [outDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { chooseTheme, openPalette, openRoute } from '../../../tests/support/app-shell.mjs';
import { createApplication } from '../../server/main.mjs';

const out = path.resolve(process.argv[2] || 'docs/owner/forge-local-complete-20261124-v3/progress/media/app-shell-t3-style');
await mkdir(out, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'forge-app-shell-media-'));
const app = await createApplication({ dataDir: path.join(temp, 'state'), machineSecretDir: path.join(temp, 'vault'), port: 0 });
const browser = await chromium.launch({ headless: true, ...(process.env.FORGE_TEST_BROWSER ? { executablePath: process.env.FORGE_TEST_BROWSER } : {}) });
const errors = [], files = [];
try {
  const setup = await browser.newPage();
  const csrf = (await (await setup.request.get(app.url + '/api/session')).json()).csrf;
  const cmd = async (type, projectId, data, record) => {
    const response = await setup.request.post(app.url + '/api/command', { headers: { 'X-Forge-CSRF': csrf }, data: { operationId: crypto.randomUUID(), type, ...(projectId ? { projectId } : {}), data, ...(record ? { id: record.id, expectedRevision: record.revision } : {}) } });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).entity;
  };
  const project = await cmd('project.create', null, { name: 'ร้านกาแฟออนไลน์ (ตัวอย่าง)', workspace: path.join(temp, 'workspace'), description: 'ข้อมูลตัวอย่างสำหรับภาพหน้าจอ' });
  const bot = await cmd('bot.create', project.id, { name: 'ผู้ช่วยวิเคราะห์', role: 'วิเคราะห์ข้อมูลยอดขาย', kind: 'resident' });
  const plan = await cmd('plan.create', project.id, { name: 'แผนทำนายยอดขาย', approved: true });
  for (const [title, status] of [['รวบรวมไฟล์ยอดขาย 12 เดือน', 'done'], ['ตรวจคุณภาพชุดข้อมูล', 'running'], ['เทรนโมเดลทำนายรายสัปดาห์', 'ready']])
    await cmd('task.create', project.id, { title, status, planId: plan.id, botId: bot.id });
  for (const [name, text] of [['ทำนายยอดขายสัปดาห์หน้า', 'อยากรู้ว่าสัปดาห์หน้าควรสั่งเมล็ดกาแฟเท่าไร'], ['สรุปรีวิวลูกค้าเดือนนี้', 'ช่วยจัดหมวดรีวิวเป็น ชอบ / ไม่ชอบ / ข้อเสนอแนะ'], ['Plan the launch week', 'Draft a checklist for the new menu launch']]) {
    const room = await cmd('conversation.create', project.id, { name, kind: 'team' });
    await cmd('message.send', project.id, { conversationId: room.id, text, role: 'user' }, room);
  }
  await setup.close();

  for (const [vw, vh, label] of [[1440, 900, 'desktop-1440'], [390, 844, 'mobile-390']]) {
    for (const theme of ['Dark Modern', 'Light Modern']) {
      const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vw < 500 ? 2 : 1, reducedMotion: 'reduce' });
      await context.addInitScript(id => { if (window === window.top) { localStorage.setItem('forge.language', 'th'); localStorage.setItem('forge.project', id); } }, project.id);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.url + '/app');
      await page.getByRole('heading', { level: 1, name: 'วันนี้อยากทำอะไร' }).waitFor();
      await chooseTheme(page, theme);
      const slug = theme.toLowerCase().replace(' ', '-');
      const shot = async name => {
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(out, `${label}-${slug}-${name}.png`);
        await page.screenshot({ path: file }); files.push(path.relative(process.cwd(), file));
      };
      await shot('home');
      const box = await openPalette(page);
      await shot('palette');
      await box.fill('รายงาน');
      await shot('palette-search');
      await page.keyboard.press('Escape');
      await openRoute(page, 'แผนงาน');
      await page.locator('.crumb-page').filter({ hasText: 'แผนงาน' }).waitFor();
      await shot('tool-plan');
      if (vw < 960) {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.locator('.sidebar .side-new').waitFor();
        await shot('drawer');
      }
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(temp, 'evidence.json'), JSON.stringify({ qualification: 'Real built app, disposable sample data, no providers. HOME_UAT_NOT_RUN.', files }, null, 2));
  console.log(JSON.stringify({ result: 'PASSED', files }, null, 2));
} finally {
  await browser.close();
  await app.close();
}
