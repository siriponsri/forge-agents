// Original FORGE geometry. Apache-2.0. No fonts or third-party logo artwork.
// Raster exports use resvg; install it in an isolated prefix, not this repo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'docs/brand');
const modules = process.argv[process.argv.indexOf('--modules') + 1];
if (!process.argv.includes('--modules') || !modules) {
  throw new Error('Pass --modules <isolated-prefix>/node_modules; see docs/brand/README.md');
}
const require = createRequire(path.join(path.resolve(modules), '_forge-brand.cjs'));
const { Resvg } = require('@resvg/resvg-js');
const rasterizerVersion = require('@resvg/resvg-js/package.json').version;
if (rasterizerVersion !== '2.6.2') throw new Error('Reviewed rasterizer version is 2.6.2');
await fs.mkdir(path.join(out, 'exports'), { recursive: true });
await fs.mkdir(path.join(out, 'evidence'), { recursive: true });

const mark = 'M8 8H56L44 20H20V28H48L36 40H20V56H8Z';
// Original lettering on a 48-unit cap-height grid, not an outlined font.
const letters = [
  [0, 'M0 0H32L24 8H8V20H28L20 28H8V48H0Z'],
  [44, 'M18 0C6 0 0 8 0 20V28C0 40 6 48 18 48S36 40 36 28V20C36 8 30 0 18 0ZM18 8C25 8 28 12 28 20V28C28 36 25 40 18 40S8 36 8 28V20C8 12 11 8 18 8Z'],
  [94, 'M0 0H17C29 0 34 6 34 15C34 22 30 27 24 29L36 48H26L15 30H8V48H0ZM8 8V22H17C23 22 26 20 26 15S23 8 17 8Z'],
  [142, 'M38 12L30 16C28 10 25 8 19 8C11 8 8 13 8 21V27C8 36 12 40 19 40C24 40 28 38 30 36V29H19V21H38V40C33 46 27 48 19 48C6 48 0 40 0 27V21C0 8 7 0 19 0C28 0 34 4 38 12Z'],
  [194, 'M0 0H32V8H8V20H28V28H8V40H32V48H0Z'],
];
const word = letters.map(([x, d]) => `<path transform="translate(${x} 0)" d="${d}"/>`).join('');
const geometry = {
  mark: { width: 64, height: 64, content: `<path d="${mark}"/>` },
  wordmark: { width: 258, height: 64, content: `<g transform="translate(16 8)" fill-rule="evenodd">${word}</g>` },
  lockup: { width: 314, height: 64, content: `<path d="${mark}"/><g transform="translate(80 8)" fill-rule="evenodd">${word}</g>` },
};
const colors = { 'for-light': '#20252b', 'for-dark': '#f5f5f5', black: '#000000', white: '#ffffff' };
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const svg = (name, color) => {
  const g = geometry[name];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-labelledby="title desc"><title id="title">FORGE${name === 'mark' ? ' mark' : ''}</title><desc id="desc">${name === 'mark' ? 'An F with two parallel cut-ended arms.' : name === 'wordmark' ? 'FORGE in original geometric lettering.' : 'A cut-ended F mark beside the FORGE wordmark.'}</desc><g fill="${color}">${g.content}</g></svg>\n`;
};
const inventory = [];
async function save(file, bytes) {
  await fs.writeFile(path.join(out, file), bytes);
  inventory.push({ file, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
}
function raster(source, width, fonts = false) {
  const renderer = new Resvg(source, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: fonts, defaultFontFamily: 'Segoe UI' },
  });
  const result = renderer.render();
  return { bytes: result.asPng(), width: result.width, height: result.height };
}
const exports = [];
for (const name of Object.keys(geometry)) for (const [variant, color] of Object.entries(colors)) {
  const source = svg(name, color);
  const stem = `exports/forge-${name}-${variant}`;
  await save(`${stem}.svg`, source);
  const png = raster(source, geometry[name].width * 4);
  await save(`${stem}.png`, png.bytes);
  exports.push({ name, variant, color, pngWidth: png.width, pngHeight: png.height, transparent: true });
}
for (const variant of ['for-light', 'for-dark']) for (const size of [16, 24, 32, 48, 64]) {
  await save(`exports/forge-mark-${variant}-${size}.png`, raster(svg('mark', colors[variant]), size).bytes);
}

// Offline proof only: system UI text labels are not part of the logo artwork.
const label = (x, y, content, color = '#20252b', size = 16) => `<text x="${x}" y="${y}" fill="${color}" font-family="Segoe UI" font-size="${size}">${escape(content)}</text>`;
const placed = (name, x, y, width, color) => `<g transform="translate(${x} ${y}) scale(${width / geometry[name].width})" fill="${color}">${geometry[name].content}</g>`;
let proof = '<rect width="1040" height="840" fill="#ffffff"/>';
proof += label(40, 45, 'FORGE / original vector identity', '#20252b', 24);
proof += label(40, 74, 'Cut-ended F · custom path lettering · transparent exports · no font dependency');
proof += '<rect x="0" y="100" width="520" height="250" fill="#f5f5f5"/><rect x="520" y="100" width="520" height="250" fill="#1f1f1f"/>';
for (const [x, ink, tag] of [[0, colors['for-light'], 'Light / graphite'], [520, colors['for-dark'], 'Dark / paper']]) {
  proof += label(x + 40, 134, tag, ink);
  proof += placed('lockup', x + 40, 164, 400, ink);
  proof += placed('mark', x + 40, 265, 48, ink);
  proof += placed('wordmark', x + 112, 265, 220, ink);
}
proof += label(40, 392, 'Small-size proof / native pixels (100% view)');
for (const [i, size] of [16, 24, 32, 48, 64].entries()) {
  const x = 40 + i * 96;
  proof += placed('mark', x, 422, size, colors['for-light']);
  proof += label(x, 518, `${size}px`, '#20252b', 14);
  proof += `<rect x="${x + 520 - 8}" y="414" width="80" height="88" fill="#1f1f1f"/>`;
  proof += placed('mark', x + 520, 422, size, colors['for-dark']);
  proof += label(x + 520, 518, `${size}px`, '#20252b', 14);
}
proof += label(40, 568, 'Minimum wordmark / lockup widths');
proof += placed('wordmark', 40, 594, 129, colors['for-light']);
proof += placed('lockup', 270, 594, 157, colors['for-light']);
proof += '<rect x="520" y="584" width="480" height="60" fill="#1f1f1f"/>';
proof += placed('wordmark', 560, 594, 129, colors['for-dark']);
proof += placed('lockup', 790, 594, 157, colors['for-dark']);
for (const x of [40, 560]) proof += label(x, 668, '129px wordmark', '#20252b', 14);
for (const x of [270, 790]) proof += label(x, 668, '157px lockup', '#20252b', 14);
proof += label(40, 708, 'One-color applications');
proof += '<rect x="520" y="724" width="480" height="84" fill="#000000"/>';
proof += placed('lockup', 40, 734, 314, colors.black);
proof += placed('lockup', 560, 734, 314, colors.white);
const proofSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="840" viewBox="0 0 1040 840" role="img" aria-labelledby="title"><title id="title">FORGE logo proof in light, dark, small-size and monochrome contexts</title>${proof}</svg>\n`;
await save('evidence/contact-sheet.svg', proofSVG);
await save('evidence/contact-sheet.png', raster(proofSVG, 1040, true).bytes);

function luminance(hex) {
  return hex.slice(1).match(/../g).map(s => parseInt(s, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
}
const contrast = (fg, bg) => (Math.max(luminance(fg), luminance(bg)) + 0.05) / (Math.min(luminance(fg), luminance(bg)) + 0.05);
const pairs = [
  [colors['for-light'], '#ffffff'], [colors['for-light'], '#f5f5f5'],
  [colors['for-dark'], '#1f1f1f'], [colors['for-dark'], '#0d1117'],
  [colors.black, '#ffffff'], [colors.white, '#000000'],
].map(([foreground, background]) => ({ foreground, background, ratio: contrast(foreground, background) }));
if (pairs.some(p => p.ratio < 7)) throw new Error('Logo context contrast below 7:1');
await fs.writeFile(path.join(out, 'evidence/exports.json'), JSON.stringify({
  generator: 'tools/brand/build.mjs', rasterizer: `@resvg/resvg-js ${rasterizerVersion}`,
  fontsInLogo: false, networkAssets: false, sourceGeometry: { mark, letters },
  exports, contrast: pairs, files: inventory,
}, null, 2) + '\n');
console.log(`Generated ${exports.length} SVG/PNG pairs, 10 small PNGs and contact sheet; all ${pairs.length} contrast pairs exceed 7:1.`);
