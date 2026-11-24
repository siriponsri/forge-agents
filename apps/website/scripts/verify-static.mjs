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
