import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {validateManifest} from './release-policy.mjs';

validateManifest(JSON.parse(await readFile('public/releases.json','utf8')));
let origin='';
if(process.env.SITE_URL){const u=new URL(process.env.SITE_URL);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw new Error('SITE_URL must be an HTTPS origin, without a path, query or credentials');origin=u.origin}
const template=await readFile('dist/index.html','utf8');
if(template.includes('data-page='))throw new Error('Static output is already prerendered. Run npm run build to start from a fresh Vite template.');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const themeScript="try{const t=localStorage.getItem('forge.website.theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}";
const hash=createHash('sha256').update(themeScript).digest('base64');
// Radix emits these two fixed SSR style attributes. Permit only their exact
// values, rather than weakening script policy or allowing arbitrary inline CSS.
const styleHashes=['outline:none','animation-duration:0s'].map(value=>`'sha256-${createHash('sha256').update(value).digest('base64')}'`).join(' ');
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const urls=[];
try {
  const {App}=await server.ssrLoadModule('/src/App.tsx');
  const {pages,href,titles}=await server.ssrLoadModule('/src/site.ts');
  for(const lang of ['th','en'])for(const page of [...pages,'404']) {
    const path=page==='404'?`/${lang}/404/`:href(lang,page);
    const description=lang==='th'?'FORGE — พื้นที่ทำงาน AI บนเครื่องของคุณ แผน ทีม เอกสาร และหลักฐานอยู่ด้วยกัน ตรวจสถานะความสามารถและ public release ก่อนติดตั้ง':'FORGE — a local AI workspace for plans, agent teams, documents and evidence. Explore capabilities, architecture, setup and verified public release status.';
    const title=`FORGE — ${titles[page]}`;
    const canonical=origin?`<link rel="canonical" href="${origin}${path}"/><meta property="og:url" content="${origin}${path}"/>${['th','en'].map(l=>`<link rel="alternate" hreflang="${l}" href="${origin}${page==='404'?`/${l}/404/`:href(l,page)}"/>`).join('')}<link rel="alternate" hreflang="x-default" href="${origin}${href('th',page)}"/>`:'';
    const metadata=`${canonical}<meta name="robots" content="${origin&&page!=='404'?'index,follow':'noindex,nofollow'}"/><meta property="og:type" content="website"/><meta property="og:site_name" content="FORGE"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:locale" content="${lang==='th'?'th_TH':'en_US'}"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${escape(title)}"/><meta name="twitter:description" content="${escape(description)}"/>${origin?`<meta property="og:image" content="${origin}/forge-workbench.png"/><meta name="twitter:image" content="${origin}/forge-workbench.png"/>`:''}<script>${themeScript}</script>`;
    const body=renderToString(React.createElement(React.StrictMode,null,React.createElement(App,{lang,page})));
    const html=template.replace(/lang="th"/,`lang="${lang}" data-page="${page}"`).replace(/<title>.*?<\/title>/,`<title>${escape(title)}</title>`).replace(/<meta name="description"[^>]*\/>/,`<meta name="description" content="${escape(description)}"/>`).replace('</head>',metadata+'</head>').replace('<div id="root"></div>',`<div id="root">${body}</div>`);
    const dir=`dist${path}`;await mkdir(dir,{recursive:true});await writeFile(dir+'index.html',html);
    if(page==='home'&&lang==='th')await writeFile('dist/index.html',html);
    if(page==='404'&&lang==='th')await writeFile('dist/404.html',html);
    if(page!=='404')urls.push({path,lang,page});
  }
}finally{await server.close()}
await writeFile('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin?urls.map(({path})=>`<url><loc>${origin}${path}</loc></url>`).join(''):''}</urlset>\n`);
await writeFile('dist/robots.txt',origin?`User-agent: *\nAllow: /\nDisallow: /th/404/\nDisallow: /en/404/\nSitemap: ${origin}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n');
await writeFile('dist/_headers',`/*\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self'; style-src-attr 'unsafe-hashes' ${styleHashes}; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n  X-Frame-Options: DENY\n/forge-workbench.png\n  ! Content-Security-Policy\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
await writeFile('dist/_redirects','/ /th/ 302\n/docs /th/docs/ 302\n/install /th/install/ 302\n/download /th/download/ 302\n/changelog /th/changelog/ 302\n/github /th/github/ 302\n');
console.log(`Prerendered ${urls.length} localized pages. Canonical: ${origin||'unset; noindex'}. No runtime API.`);
