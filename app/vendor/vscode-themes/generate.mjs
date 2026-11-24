// FORGE adaptation. Run from the repository root. No third-party theme packages.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REVISION = 'b57d5c9e1b27c4ede570c76940b7aa5207595a54';
const base = `https://raw.githubusercontent.com/microsoft/vscode/${REVISION}/`;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const refresh = process.argv.includes('--refresh');
const sources = new Map();
async function source(file) {
  if (sources.has(file)) return sources.get(file).text;
  const local = path.join(here, 'source', file);
  let text;
  if (refresh) {
    const response = await fetch(base + file);
    if (!response.ok) throw new Error(`${response.status}: ${file}`);
    text = await response.text();
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, text);
  } else text = await readFile(local, 'utf8');
  sources.set(file, { text, sha256: createHash('sha256').update(text).digest('hex') });
  return text;
}

// JSONC themes contain comments and trailing commas. Preserve quoted URLs.
function parse(text) {
  const uncommented = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g,
    match => match.startsWith('"') ? match : '');
  return JSON.parse(uncommented.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g,
    match => match.startsWith('"') ? match : ''));
}
async function resolveTheme(file) {
  const data = parse(await source(file));
  const parent = data.include ? await resolveTheme(path.posix.join(path.posix.dirname(file), data.include)) : {};
  return { ...parent, ...data.colors };
}

const specs = [
  ['dark-modern', 'Dark Modern', 'dark', 'theme-defaults', 'Dark Modern'],
  ['dark-plus', 'Dark+', 'dark', 'theme-defaults', 'Dark+'],
  ['light-modern', 'Light Modern', 'light', 'theme-defaults', 'Light Modern'],
  ['light-plus', 'Light+', 'light', 'theme-defaults', 'Light+'],
  ['monokai', 'Monokai', 'dark', 'theme-monokai'],
  ['monokai-dimmed', 'Monokai Dimmed', 'dark', 'theme-monokai-dimmed'],
  ['solarized-dark', 'Solarized Dark', 'dark', 'theme-solarized-dark'],
  ['solarized-light', 'Solarized Light', 'light', 'theme-solarized-light'],
  ['quiet-light', 'Quiet Light', 'light', 'theme-quietlight'],
  ['abyss', 'Abyss', 'dark', 'theme-abyss'],
  ['kimbie-dark', 'Kimbie Dark', 'dark', 'theme-kimbie-dark'],
  ['red', 'Red', 'dark', 'theme-red'],
  ['tomorrow-night-blue', 'Tomorrow Night Blue', 'dark', 'theme-tomorrow-night-blue'],
  ['high-contrast-dark', 'High Contrast Dark', 'dark', 'theme-defaults', 'Default High Contrast'],
  ['high-contrast-light', 'High Contrast Light', 'light', 'theme-defaults', 'Default High Contrast Light'],
];

// Literal defaults verified in the pinned registry files below. Themes override
// these in the same order as VS Code; FORGE does not implement a full IDE registry.
const defaults = {
  dark: { bg: '#1E1E1E', fg: '#BBBBBB', sidebar: '#252526', topbar: '#3C3C3C', input: '#3C3C3C', accent: '#0E639C', focus: '#007FD4', link: '#3794FF' },
  light: { bg: '#FFFFFF', fg: '#333333', sidebar: '#F3F3F3', topbar: '#DDDDDD', input: '#FFFFFF', accent: '#007ACC', focus: '#0090F1', link: '#006AB1' },
  hcDark: { bg: '#000000', fg: '#FFFFFF', sidebar: '#000000', topbar: '#000000', input: '#000000', accent: '#000000', focus: '#F38518', link: '#21A6FF', border: '#6FC3DF' },
  hcLight: { bg: '#FFFFFF', fg: '#292929', sidebar: '#FFFFFF', topbar: '#FFFFFF', input: '#FFFFFF', accent: '#0F4A85', focus: '#006BBD', link: '#0F4A85', border: '#0F4A85' },
};
const rgb = hex => {
  let h = hex.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map(c => c+c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i+2), 16));
};
const hex = colors => '#' + colors.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, amount) => hex(rgb(a).map((v, i) => v * (1-amount) + rgb(b)[i] * amount));
const opaque = (value, background) => {
  if (!value || !/^#[\da-f]{3,8}$/i.test(value)) return background;
  let h = value.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map(c => c+c).join('');
  return h.length === 8 ? mix(background, '#' + h.slice(0, 6), parseInt(h.slice(6), 16)/255) : '#' + h;
};
const lum = color => rgb(color).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((s,v,i) => s+v*[.2126,.7152,.0722][i],0);
const ratio = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
function readable(color, surfaces, kind, minimum=4.5) {
  const endpoint = kind === 'dark' ? '#ffffff' : '#000000';
  for (let n=0; n<=100; n++) {
    const candidate = mix(color, endpoint, n/100);
    if (surfaces.every(bg => ratio(candidate,bg) >= minimum)) return candidate;
  }
  throw new Error(`Cannot make ${color} readable on ${surfaces}`);
}

const themes = [];
for (const [id, label, kind, extension, name] of specs) {
  const packageFile = `extensions/${extension}/package.json`;
  const pkg = JSON.parse(await source(packageFile));
  if (pkg.license !== 'MIT') throw new Error(`Unapproved license: ${extension}`);
  const entry = name ? pkg.contributes.themes.find(item => item.id === name) : pkg.contributes.themes[0];
  if (!entry) throw new Error(`Theme missing: ${label}`);
  const file = path.posix.join('extensions', extension, entry.path);
  const c = await resolveTheme(file);
  const highContrast = entry.uiTheme.startsWith('hc-');
  const d = defaults[highContrast ? kind === 'dark' ? 'hcDark' : 'hcLight' : kind];
  const bg = opaque(c['editor.background'], d.bg);
  const rawFg = opaque(c['editor.foreground'], d.fg);
  const sidebar = opaque(c['sideBar.background'], d.sidebar);
  const topbar = opaque(c['titleBar.activeBackground'], d.topbar);
  const panel = opaque(c['editorWidget.background'], mix(bg, rawFg, .025));
  const input = opaque(c['input.background'], d.input);
  const hover = mix(panel, rawFg, .055);
  const elevated = mix(panel, rawFg, .025);
  const surfaces = [bg, sidebar, topbar, panel, input, hover, elevated];
  const fg = readable(rawFg, surfaces, kind);
  const muted = readable(opaque(c.descriptionForeground, mix(rawFg,bg,.27)), surfaces, kind);
  const accent = opaque(c['button.background'], d.accent);
  const originalAccentText = opaque(c['button.foreground'], '#ffffff');
  const accentText = ratio(originalAccentText, accent) >= 4.5 ? originalAccentText : ['#ffffff','#000000'].sort((a,b) => ratio(b,accent)-ratio(a,accent))[0];
  const accentHover = readable(opaque(c['button.hoverBackground'], mix(accent, kind === 'dark' ? '#ffffff' : '#000000', .08)), [accentText], accentText === '#ffffff' ? 'light' : 'dark');
  const link = readable(opaque(c['textLink.foreground'], d.link), surfaces, kind);
  const selection = mix(bg, link, .12);
  const selectionFg = readable(link, [selection], kind);
  const success = readable(opaque(c['terminal.ansiGreen'], kind === 'dark' ? '#89c997' : '#28723e'), surfaces, kind);
  const warning = readable(opaque(c['terminal.ansiYellow'], kind === 'dark' ? '#e2bc7e' : '#805300'), surfaces, kind);
  const danger = readable(opaque(c.errorForeground || c['terminal.ansiRed'], kind === 'dark' ? '#f18c86' : '#b32f32'), surfaces, kind);
  const semanticBg = color => mix(bg,color,highContrast ? 0 : .08);
  const tokens = {
    bg, fg, muted, sidebar, topbar, paper: panel, elevated, input, hover,
    accent, 'accent-hover': accentHover, 'on-accent': accentText, link,
    line: d.border || opaque(c['panel.border'] || c['sideBar.border'], mix(bg,fg,.14)),
    'line-strong': d.border || mix(bg,fg,.32),
    focus: readable(opaque(c.focusBorder, d.focus), surfaces, kind, 3),
    'selected-bg': selection, 'selected-fg': selectionFg,
    success, 'success-bg': semanticBg(success), warning, 'warning-bg': semanticBg(warning), danger, 'danger-bg': semanticBg(danger),
    'forge-accent': readable(kind === 'dark' ? '#eaa378' : '#a44921', surfaces, kind),
    'forge-surface': mix(bg, '#ce7947', .1),
    'canvas-dot': mix(bg,fg,.14),
    'code-bg': opaque(c['textCodeBlock.background'], sidebar),
    backdrop: kind === 'dark' ? '#000000a6' : '#15171c70',
    'shadow-color': kind === 'dark' ? '#00000040' : '#1118270c',
    'shadow-deep-color': kind === 'dark' ? '#00000080' : '#11182726',
    'document-paper': '#ffffff',
  };
  for (const key of ['fg','muted','link','forge-accent']) tokens[key] = readable(tokens[key], [...surfaces,selection,tokens['code-bg']], kind);
  // Semantic tints need their own guaranteed AA foreground.
  for (const key of ['success','warning','danger']) tokens[key] = readable(tokens[key], [...surfaces,tokens[`${key}-bg`]], kind);
  const record = {id,label,kind,highContrast,source:file,preview:{background:bg,foreground:rawFg,sidebar,accent},tokens};
  themes.push(record);
}

for (const file of ['LICENSE.txt','src/vs/platform/theme/common/colors/baseColors.ts','src/vs/platform/theme/common/colors/editorColors.ts','src/vs/platform/theme/common/colors/inputColors.ts','src/vs/workbench/common/theme.ts']) await source(file);
await writeFile(path.join(here,'LICENSE.txt'), await source('LICENSE.txt'));
await writeFile(path.join(here,'sources.json'), JSON.stringify({repository:'https://github.com/microsoft/vscode',revision:REVISION,license:'MIT',files:[...sources].map(([file,entry])=>({file,url:base+file,sha256:entry.sha256}))},null,2)+'\n');
const moduleText = `// Generated by app/vendor/vscode-themes/generate.mjs. Microsoft VS Code: MIT.\n// Palettes pinned at ${REVISION}. Workbench text is adjusted for WCAG AA.\nexport const DEFAULT_THEME = 'dark-modern';\nexport const VSCODE_REVISION = '${REVISION}';\nexport const THEMES = Object.freeze(${JSON.stringify(themes,null,2)}.map(theme => Object.freeze({ ...theme, preview: Object.freeze(theme.preview), tokens: Object.freeze(theme.tokens) })));\nexport function getTheme(id) { return THEMES.find(theme => theme.id === id) || THEMES[0]; }\n`;
await writeFile(path.join(root,'app/web/src/themes.mjs'),moduleText);
let css = `/* Microsoft VS Code built-in palettes (MIT), revision ${REVISION}.\n * Generated by app/vendor/vscode-themes/generate.mjs; see its source mapping. */\n`;
for (const theme of themes) {
  css += `${theme.id === 'dark-modern' ? ':root,\n' : ''}:root[data-theme="${theme.id}"] {\n  color-scheme: ${theme.kind};\n`;
  css += Object.entries(theme.tokens).map(([key,value])=>`  --${key}: ${value};`).join('\n');
  css += '\n}\n';
}
await writeFile(path.join(root,'app/web/src/themes.css'),css);
console.log(`Generated ${themes.length} themes from ${sources.size} pinned files.`);
