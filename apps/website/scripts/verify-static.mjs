import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.env.SITE_URL?new URL(process.env.SITE_URL).origin:'';
for(const lang of ['th','en'])for(const page of ['','docs/','install/','download/','changelog/','github/']){
  const html=await readFile(`dist/${lang}/${page}index.html`,'utf8');
  assert.ok(html.includes(`lang="${lang}"`));assert.ok(html.includes('<h1>'),'prerendered heading');
  assert.ok(html.includes('name="description"'));assert.ok(html.includes('og:title'));
  assert.equal(html.includes('name="robots" content="index,follow"'),!!origin);
  assert.equal(html.includes('rel="canonical"'),!!origin);
  if(origin){assert.ok(html.includes(`href="${origin}/${lang}/${page}"`));assert.ok(html.includes('hreflang="x-default"'))}
  assert.ok(!/(?:src|href)=["']https?:\/\/(?:localhost|127\.0\.0\.1)|(?:src|href)=["']\/api\//.test(html),'No private API or loopback links in shipping HTML');
}
const html=await readFile('dist/en/index.html','utf8');
// Publication claims must distinguish the authentic public baseline from the
// unpublished development integrations, without turning fixtures into live proof.
const baseline='01ee779ffd049ba875ad85bd36f2c8accd274ca0';
for(const lang of ['th','en']){
  const source=await readFile(`dist/${lang}/github/index.html`,'utf8');
  assert.ok(source.includes(`/tree/${baseline}`),'Pinned public baseline link');
  assert.ok(source.includes(`/blob/${baseline}/app/web/src/Office.jsx`),'Actual public Office source link');
  assert.ok(source.includes('Public baseline')&&source.includes('Current development'),'Separate source qualifications');
  const changes=await readFile(`dist/${lang}/changelog/index.html`,'utf8');
  assert.ok(changes.includes('2026-11-25')&&changes.includes('2026-11-24'),'Exact development and baseline dates');
  assert.ok(changes.includes('NOT_QUALIFIED'),'Native all-action execution gap remains explicit');
}
assert.ok(html.includes('Developer verified')&&html.includes('labelled injected provider/native observations'),'Developer evidence qualifier');
assert.ok(html.includes('shared app integration is pending'),'Research module is not presented as integrated');
const image=await readFile('public/forge-workbench.png');
assert.equal(createHash('sha256').update(image).digest('hex'),'053c352b7c1a0235d8e9e866ed2b5b2a5f58dd4125312062faffa7f1da0bf705','Authentic screenshot remains unchanged');
const script=html.match(/<script>([^]*?)<\/script>/)[1];
const csp=await readFile('dist/_headers','utf8');
assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`),'Exact prepaint script CSP hash');
for(const style of ['outline:none','animation-duration:0s'])assert.ok(csp.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`),'Exact Radix style attribute hash');
assert.ok(!csp.includes("'unsafe-inline'"));assert.ok(!csp.includes("'unsafe-eval'"));
assert.ok(csp.split('\n').every(line=>line.length<2000),'Cloudflare header line limit');
assert.ok((await readFile('dist/_redirects','utf8')).startsWith('/ /th/ 302'));
assert.ok((await readFile('dist/404.html','utf8')).includes('Page not found.'));
const robots=await readFile('dist/robots.txt','utf8'),sitemap=await readFile('dist/sitemap.xml','utf8');
assert.ok(origin?robots.includes(`${origin}/sitemap.xml`):robots.includes('Disallow: /'));
assert.equal((sitemap.match(/<loc>/g)||[]).length,origin?12:0);
for(const license of ['manrope-OFL','ibm-plex-sans-thai-OFL','lucide-ISC','radix-MIT','react-MIT'])assert.ok((await readFile(`dist/licenses/${license}.txt`,'utf8')).length>100);
console.log(JSON.stringify({result:'PASSED',pages:12,canonical:origin||'unset; noindex',sitemapEntries:origin?12:0,csp:'hashed script and exact Radix style values; no unsafe-inline/eval',licenses:5}));
