// Offline documentation readability fixture; not GitHub sanitizer qualification.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = flag => process.argv[process.argv.indexOf(flag) + 1];
if (!process.argv.includes('--modules') || !process.argv.includes('--browser-modules')) {
  throw new Error('Pass --modules <brand-prefix>/node_modules --browser-modules <playwright-prefix>/node_modules');
}
const require = createRequire(path.join(path.resolve(arg('--modules')), '_readme.cjs'));
const browserRequire = createRequire(path.join(path.resolve(arg('--browser-modules')), '_readme.cjs'));
const MarkdownIt = require('markdown-it');
const { chromium } = browserRequire('playwright');
const markdown = await fs.readFile(path.join(root, 'README.md'), 'utf8');
const html = new MarkdownIt({ html: true }).render(markdown);
const out = path.join(root, 'docs/brand/evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Local Markdown layout fixture. Not actual GitHub CSS/sanitization or assembled app/site qualification.', readmeSHA256: hash(markdown), generatorSHA256: hash(await fs.readFile(fileURLToPath(import.meta.url))), logos: [], variants: [] };
for (const ref of [...markdown.matchAll(/src="(docs\/brand\/exports\/forge-lockup-[^"]+)"/g)].map(m => m[1])) {
  const file = ref.split('#')[0];
  const source = await fs.readFile(path.join(root, file));
  for (const color of ['#f97316', '#f2c94c', '#8b9199']) if (!source.toString().includes(`fill="${color}"`)) throw new Error(`Missing colored default facet: ${file} ${color}`);
  report.logos.push({ file, sha256: hash(source), colored: true });
}
if (report.logos.length !== 2) throw new Error('Expected exactly two colored theme-logo references');
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['light', 'dark']) {
    const dark = theme === 'dark';
    const colors = dark ? { bg: '#0d1117', fg: '#f0f6fc', muted: '#b1bac4', line: '#3d444d', link: '#79c0ff' }
      : { bg: '#ffffff', fg: '#20252b', muted: '#59636e', line: '#d1d9e0', link: '#0969da' };
    const opposite = dark ? 'light' : 'dark';
    const fixture = path.join(out, `readme-${theme}.html`);
    await fs.writeFile(fixture, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="../../../"><title>FORGE README ${theme} layout proof</title><style>
      *{box-sizing:border-box}body{margin:0;background:${colors.bg};color:${colors.fg};font:16px/1.6 'Segoe UI',sans-serif}main{max-width:980px;padding:24px 32px;margin:auto;min-width:0}h1,h2{line-height:1.3;margin:28px 0 16px}h1{font-size:32px;margin-top:0}h2{font-size:24px;border-bottom:1px solid ${colors.line};padding-bottom:8px}p,ul,ol,blockquote,table,details{margin:16px 0}a{color:${colors.link};text-underline-offset:3px}img{max-width:100%;height:auto}img[src$="#gh-${opposite}-mode-only"]{display:none}blockquote{border-left:3px solid ${colors.line};padding:0 16px;color:${colors.muted}}pre{padding:16px;overflow:auto;border:1px solid ${colors.line};border-radius:6px}code{font-family:Consolas,monospace;font-size:14px}table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse}td,th{border:1px solid ${colors.line};padding:8px 12px;min-width:130px}th{text-align:left}summary{cursor:pointer}li+li{margin-top:6px}em{color:${colors.muted}}:focus-visible{outline:2px solid ${colors.link};outline-offset:3px}@media(max-width:500px){main{padding:16px}td,th{min-width:120px}}
      </style></head><body><main>${html}</main></body></html>\n`);
    for (const width of [900, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme: theme });
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(fixture).href);
      await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
      const result = await page.evaluate(() => ({
        viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        visibleLogoCount: [...document.querySelectorAll('img[src*="forge-lockup"]')].filter(i => getComputedStyle(i).display !== 'none').length,
        visibleLogo: [...document.querySelectorAll('img[src*="forge-lockup"]')].filter(i => getComputedStyle(i).display !== 'none').map(i => i.getAttribute('src')),
        images: [...document.images].map(i => ({ src: i.currentSrc.split('/').pop(), decoded: i.complete && i.naturalWidth > 0, displayWidth: i.width })),
        headings: [...document.querySelectorAll('h1,h2')].map(h => ({ text: h.textContent, fits: h.scrollWidth <= h.clientWidth })),
      }));
      if (result.documentWidth !== width || result.visibleLogoCount !== 1 || result.images.some(i => !i.decoded) || result.headings.some(h => !h.fits)) throw new Error(JSON.stringify(result));
      if (requests.length || errors.length) throw new Error(JSON.stringify({ requests, errors }));
      const capture = `readme-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(out, capture), animations: 'disabled' });
      report.variants.push({ theme, ...result, externalRequests: requests, pageErrors: errors, capture });
      await context.close();
    }
  }
  report.browser = browser.version();
  report.playwright = browserRequire('playwright/package.json').version;
  report.markdownIt = require('markdown-it/package.json').version;
} finally { await browser.close(); }
report.files = [];
for (const file of [...report.variants.map(v => v.capture), 'readme-light.html', 'readme-dark.html']) {
  report.files.push({ file, sha256: hash(await fs.readFile(path.join(out, file))) });
}
await fs.writeFile(path.join(out, 'readme-layout.json'), JSON.stringify(report, null, 2) + '\n');
console.log('PASS: 900/375px light/dark README fixtures; all images decoded; exactly one visible theme logo; no document overflow or network requests.');
