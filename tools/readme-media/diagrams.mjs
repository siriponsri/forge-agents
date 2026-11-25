/** Offline editorial diagrams. See docs/diagrams/README.md for pinned tool setup. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/diagrams');
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const fonts = [
  ['Geist', 400, 'normal', 'geist-400-normal.ttf'],
  ['Geist', 600, 'normal', 'geist-600-normal.ttf'],
  ['Geist Mono', 400, 'normal', 'geist-mono-400-normal.ttf'],
  ['Instrument Serif', 400, 'normal', 'instrument-serif-400-normal.ttf'],
  ['Instrument Serif', 400, 'italic', 'instrument-serif-400-italic.ttf'],
];
const fontCSS = (await Promise.all(fonts.map(async ([family, weight, style, file]) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};font-display:block;src:url(data:font/ttf;base64,${(await fs.readFile(path.join(out, 'fonts', file))).toString('base64')}) format('truetype');}`))).join('\n');
const palettes = {
  light: { paper:'#f5f5f5', ink:'#2d3142', muted:'#4f5d75', soft:'#616d84', rule:'#c8cbd1', accent:'#eb6c36', tint:'#f7e9e2', node:'#ffffff', store:'#e9eaec' },
  dark: { paper:'#2d3142', ink:'#f5f5f5', muted:'#bfc0c0', soft:'#b1b8c8', rule:'#63697b', accent:'#f08a59', tint:'#443a44', node:'#363b4e', store:'#3b4053' },
};
// Coordinates are authored for a left-to-right fit canvas; never imported from Mermaid.
const workflow = {
  slug:'software-delivery', title:'From an idea to a delivery.', eyebrow:'FORGE / THE WORKFLOW', width:1040, height:492,
  subtitle:'Five stages. One reviewed trail of decisions, files and evidence.',
  desc:'Idea / Mission becomes an Owner-approved Plan, then T3 Executor Build with Asst advice when needed, Verify of actual outputs, local tests, static preview, QA and Owner acceptance, and a selected-files Delivery Pack ZIP.',
  nodes:[
    {id:'idea',x:40,y:184,w:160,h:188,tag:'01 / DEFINE',name:['Idea / Mission'],lines:['Outcome + inputs','Acceptance criteria','Open decisions']},
    {id:'plan',x:240,y:184,w:160,h:188,tag:'02 / APPROVE',name:['Approved Plan'],lines:['Tasks + dependencies','Owner approves','before execution']},
    {id:'build',x:440,y:184,w:160,h:188,tag:'03 / EXECUTE',name:['Build'],lines:['T3 Executor','Asst advice when','needed']},
    {id:'verify',x:640,y:184,w:160,h:188,tag:'04 / REVIEW',name:['Verify'],lines:['Actual output files','Local tests + preview','QA + Owner accepts'],focal:true},
    {id:'pack',x:840,y:184,w:160,h:188,tag:'05 / HAND OVER',name:['Delivery Pack'],lines:['Selected-files ZIP','Manifest + evidence','Limits included']},
  ],
  edges:[
    {from:'idea',to:'plan',points:[[200,256],[240,256]]},
    {from:'plan',to:'build',points:[[400,256],[440,256]]},
    {from:'build',to:'verify',points:[[600,256],[640,256]]},
    {from:'verify',to:'pack',points:[[800,256],[840,256]]},
  ],
  note:'Preview covers registered static files. Unknown outcomes are reconciled, never replayed.',
  legend:'Left to right: reviewed handoffs', key:'Tangerine: evidence and acceptance gate',
  editorial:[['The plan sets the scope.','An approved plan connects the Mission to canonical tasks and their dependencies. Executor and Asst remain roles within the existing execution authority.'],['Evidence travels with the files.','The Verify stage groups file registration, reviewed local tests, immutable static preview, QA and Owner acceptance. The Delivery Pack includes selected files and recorded limitations.']],
};
const architecture = {
  slug:'architecture', title:'One authority. Connected views.', eyebrow:'FORGE / THE SYSTEM', width:1040, height:676,
  subtitle:'FORGE owns domain records. T3 owns each provider turn.',
  desc:'Owner decisions enter FORGE canonical domain records, which coordinate the matching T3 provider-turn owner; AG-UI projects observed state into Chat and Node-Edge views, with scoped Context / Memory, Office / Reports, compute adapters and artifacts as supporting components.',
  nodes:[
    {id:'owner',x:40,y:200,w:160,h:144,tag:'HUMAN',name:['Owner'],lines:['Decisions + approvals','TH / EN GUI'],type:'input'},
    {id:'forge',x:240,y:200,w:220,h:144,tag:'DOMAIN AUTHORITY',name:['FORGE'],lines:['Projects · plans · tasks','Approvals + evidence','SQLite + durable events'],focal:true},
    {id:'t3',x:508,y:200,w:232,h:144,tag:'EXECUTION OWNER',name:['Matching T3 runtime'],lines:['One owner per provider turn','Executor / Asst roles','Scoped tools + operations'],focal:true},
    {id:'views',x:788,y:200,w:212,h:144,tag:'OBSERVED VIEWS',name:['Chat + Node-Edge'],lines:['AG-UI state + events','Same canonical identities','Controls checked by FORGE'],type:'store'},
    {id:'office',x:40,y:416,w:160,h:132,tag:'OFFICE / REPORTS',name:['Docs + Sheets'],lines:['Univer revisions','Saved report sources','WordCraft / PdfCraft']},
    {id:'memory',x:240,y:416,w:220,h:132,tag:'CONTEXT / MEMORY',name:['Scoped references'],lines:['Exact source revisions','Explicit Owner grants'],type:'store'},
    {id:'compute',x:508,y:416,w:232,h:132,tag:'CAPABILITY ADAPTERS',name:['Compute + targets'],lines:['Jobs · serving · storage','Configured scope + permissions'],type:'optional'},
    {id:'artifacts',x:788,y:416,w:212,h:132,tag:'ARTIFACTS / EVIDENCE',name:['Registered outputs'],lines:['Content hashes + provenance','Receipts + verification'],type:'store'},
  ],
  edges:[
    {from:'owner',to:'forge',points:[[200,272],[240,272]]},
    {from:'forge',to:'t3',points:[[460,272],[508,272]]},
    {from:'t3',to:'views',points:[[740,272],[788,272]],dashed:true},
    {from:'forge',to:'memory',points:[[350,344],[350,416]],dashed:true},
    {from:'memory',to:'t3',points:[[460,480],[488,480],[488,368],[568,368],[568,344]],dashed:true,bridge:{x:488,y:400},d:'M 460 480 H 480 Q 488 480 488 472 V 408 A 8 8 0 0 0 488 392 V 376 Q 488 368 496 368 H 560 Q 568 368 568 360 V 344'},
    {from:'forge',to:'office',points:[[292,344],[292,384],[120,384],[120,416]]},
    {from:'forge',to:'compute',points:[[408,344],[408,400],[624,400],[624,416]]},
    {from:'t3',to:'artifacts',points:[[680,344],[680,368],[900,368],[900,416]]},
    {from:'compute',to:'artifacts',points:[[740,484],[788,484]]},
    {from:'office',to:'artifacts',points:[[120,548],[120,584],[844,584],[844,548]]},
  ],
  note:'Unknown outcome or cost stays unknown. Reconcile the existing identity before another effect.',
  legend:'Solid: coordination / outputs', key:'Dashed: observations / scoped context',
  editorial:[['Authority stays explicit.','FORGE owns the domain and checks commands. T3 remains the single provider-turn owner. AG-UI is a projection of observed lifecycle events, not another execution controller.'],['Capability is not qualification.','Supporting components describe integration boundaries. This drawing does not claim live account access, remote compute qualification, native automation coverage or completed Home UAT.']],
};
const models = [workflow, architecture];

function rounded(points) {
  let d=`M ${points[0].join(' ')}`;
  for(let i=1;i<points.length;i++) {
    const [x,y]=points[i], p=points[i-1], n=points[i+1];
    if(!n) {d+=` L ${x} ${y}`;continue;}
    const r=8;
    const a=[x-Math.sign(x-p[0])*r,y-Math.sign(y-p[1])*r];
    const b=[x+Math.sign(n[0]-x)*r,y+Math.sign(n[1]-y)*r];
    d+=` L ${a.join(' ')} Q ${x} ${y} ${b.join(' ')}`;
  }
  return d;
}

function diagram(model, variant) {
  const dark=variant==='dark', p=palettes[dark?'dark':'light'], slug=model.slug+(variant==='light'?'':`-${variant}`);
  const text=(x,y,value,{size=12,family='Geist',weight=400,fill=p.ink,italic=false,track=0}={})=>
    `<text x="${x}" y="${y}" font-family="'${family}', ${family==='Instrument Serif'?'serif':family==='Geist Mono'?'monospace':'sans-serif'}" font-size="${size}" font-weight="${weight}" font-style="${italic?'italic':'normal'}" letter-spacing="${track}" fill="${fill}">${esc(value)}</text>`;
  const rect=(x,y,w,h,fill,stroke=p.rule,rx=6,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1" ${extra}/>`;
  const header=text(40,44,model.eyebrow,{size:8,family:'Geist Mono',fill:p.muted,track:1.4})+text(40,100,model.title,{size:40,family:'Instrument Serif'})+text(40,136,model.subtitle,{size:12,fill:p.muted});
  const arrows=model.edges.map((edge,i)=>({edge,i})).sort((a,b)=>Boolean(a.edge.bridge)-Boolean(b.edge.bridge)).map(({edge,i})=>`${edge.bridge?`<path d="M 488 408 A 8 8 0 0 0 488 392" fill="none" stroke="${p.paper}" stroke-width="6"/>`:''}<path data-edge="${i}" d="${edge.d??rounded(edge.points)}" fill="none" stroke="${p.muted}" stroke-width="1.2" ${edge.dashed?'stroke-dasharray="5 4"':''} marker-end="url(#${slug}-arrow)"/>`).join('\n');
  const nodes=model.nodes.map(n=>{
    let fill=n.focal?p.tint:n.type==='store'?p.store:n.type==='input'?p.store:p.node;
    const stroke=n.focal?p.accent:n.type==='optional'?p.rule:p.ink;
    const arch=model.slug==='architecture';
    const labelY=n.y+(arch?56:64), bodyY=labelY+(arch?24:32);
    return `<g data-node="${n.id}">${rect(n.x,n.y,n.w,n.h,fill,stroke,6,n.type==='optional'?'stroke-dasharray="5 4"':'')}
    ${text(n.x+16,n.y+28,n.tag,{size:8,family:'Geist Mono',fill:n.focal?(dark?p.accent:'#a6431c'):p.muted,track:.5})}
    ${n.name.map((v,i)=>text(n.x+16,labelY+i*20,v,{size:16,weight:600})).join('')}
    ${n.lines.map((v,i)=>text(n.x+16,bodyY+i*(arch?18:20),v,{size:12,fill:p.muted})).join('')}</g>`;
  }).join('\n');
  const ly=model.height-40;
  const legend=`<line x1="40" y1="${ly-20}" x2="1000" y2="${ly-20}" stroke="${p.rule}"/>`+
    `<line x1="40" y1="${ly}" x2="68" y2="${ly}" stroke="${p.muted}" marker-end="url(#${slug}-arrow)"/>`+text(80,ly+4,model.legend,{size:11,fill:p.muted})+
    (model.slug==='architecture'?`<line x1="440" y1="${ly}" x2="468" y2="${ly}" stroke="${p.muted}" stroke-dasharray="5 4" marker-end="url(#${slug}-arrow)"/>`:rect(440,ly-8,20,16,p.tint,p.accent,2))+
    text(480,ly+4,model.key,{size:11,fill:p.muted});
  return {slug,p,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-labelledby="${slug}-title ${slug}-desc">
  <title id="${slug}-title">${esc(model.title)}</title><desc id="${slug}-desc">${esc(model.desc)}</desc>
  <defs><marker id="${slug}-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M 0 0 L 8 3 L 0 6 Z" fill="${p.muted}"/></marker></defs>
  <rect width="${model.width}" height="${model.height}" fill="${p.paper}"/>
  ${header}${arrows}${nodes}
  ${text(40,model.slug==='architecture'?608:412,model.note,{size:12,fill:p.muted})}
  ${legend}</svg>`};
}

await fs.mkdir(path.join(out,'evidence'),{recursive:true});
for(const m of models) for(const variant of ['light','dark','full']) {
  const {slug,p,svg}=diagram(m,variant);
  const extra=variant==='full'?`<section class="editorial" aria-label="Reading the diagram">${m.editorial.map(([h,t])=>`<article><h2>${h}</h2><p>${t}</p></article>`).join('')}</section><footer>FORGE · Architecture and workflow · Documentation overview<br/>Visual system: Diagram Design by Cathryn Lavery · Source and licenses in credits/</footer>`:'';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)} · FORGE</title><style>
  ${fontCSS}
  *{box-sizing:border-box}body{margin:0;background:${p.paper};color:${p.ink};font-family:'Geist',sans-serif;font-kerning:none;font-variant-ligatures:none}.frame{width:100%;max-width:1040px;margin:0 auto;min-width:0}.diagram-container{width:100%;overflow-x:auto}.diagram-container:focus-visible{outline:2px solid ${p.accent};outline-offset:-2px}svg{display:block;width:100%;min-width:${m.width}px}text{font-kerning:none;font-variant-ligatures:none}.scroll-help{font-size:12px;color:${p.muted};margin:12px 24px 20px}.editorial{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;margin:0 40px 32px}.editorial article{border:1px solid ${p.rule};background:${p.node};border-radius:6px;padding:24px}h2{font:400 28px/1.1 'Instrument Serif',serif;margin:0 0 12px}p{font-size:14px;line-height:1.7;margin:0}footer{border-top:1px solid ${p.rule};margin:0 40px 32px;padding-top:20px;font:11px/1.8 'Geist Mono',monospace;color:${p.muted}}@media(max-width:640px){.editorial{grid-template-columns:1fr;margin:0 24px 24px}footer{margin:0 24px 24px}}@media print{.diagram-container{overflow:visible}svg{min-width:0}.scroll-help{display:none}}
  </style></head><body><main class="frame"><div class="diagram-container" tabindex="0" role="region" aria-label="${esc(m.title)} Horizontal diagram; scroll to read every stage.">${svg}</div><p class="scroll-help">On a narrow screen, scroll the diagram horizontally. README images open at full size for zoom.</p>${extra}</main></body></html>\n`;
  await fs.writeFile(path.join(out,`${slug}.html`),html);
}
await fs.writeFile(path.join(out,'source/model.json'),JSON.stringify(models,null,2)+'\n');
console.log('Generated 6 self-contained HTML sources.');

if(!args.includes('--render')) process.exit(0);
if(!args.includes('--modules')) throw new Error('--render requires --modules <isolated npm prefix>/node_modules; see docs/diagrams/README.md');
const require=createRequire(path.join(path.resolve(flag('--modules')),'_diagram.cjs'));
const {chromium}=require('playwright');
const opentype=require('opentype.js');
const parsedFonts=new Map(fonts.map(([f,w,s,file])=>[`${f}/${w}/${s}`,opentype.loadSync(path.join(out,'fonts',file))]));
const browser=await chromium.launch({headless:true});
const evidence={browser:browser.version(),playwright:require('playwright/package.json').version,opentype:require('opentype.js/package.json').version,generatedBy:'node tools/readme-media/diagrams.mjs --render --modules <isolated-prefix>/node_modules',variants:[]};
try {
 for(const m of models) for(const variant of ['light','dark','full']) {
  const {slug}=diagram(m,variant);
  const context=await browser.newContext({viewport:{width:1040,height:900},deviceScaleFactor:2});
  const page=await context.newPage();
  const requests=[],errors=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(out,`${slug}.html`)).href);
  await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({
    fonts:[...document.fonts].map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status})),
    text:[...document.querySelectorAll('svg text')].map(t=>{const s=getComputedStyle(t);return {text:t.textContent,x:+t.getAttribute('x'),y:+t.getAttribute('y'),family:s.fontFamily.split(',')[0].replaceAll('"','').replaceAll("'",''),weight:+s.fontWeight,style:s.fontStyle,size:parseFloat(s.fontSize),spacing:parseFloat(s.letterSpacing)||0,fill:s.fill,length:t.getComputedTextLength()};}),
    containment:[...document.querySelectorAll('[data-node]')].flatMap(n=>{const r=n.querySelector('rect');const x=+r.getAttribute('x'),y=+r.getAttribute('y'),w=+r.getAttribute('width'),h=+r.getAttribute('height');return [...n.querySelectorAll('text')].map(t=>{const b=t.getBBox();return {node:n.dataset.node,text:t.textContent,inside:b.x>=x+10&&b.y>=y+8&&b.x+b.width<=x+w-10&&b.y+b.height<=y+h-8};});}),
  }));
  if(metrics.containment.some(x=>!x.inside)) throw new Error(`${slug}: clipped node labels: ${JSON.stringify(metrics.containment.filter(x=>!x.inside))}`);
  if(requests.length||errors.length) throw new Error(`${slug}: unexpected requests or browser errors`);
  await page.locator('svg').evaluate(el=>{for(let a=el.parentElement;a;a=a.parentElement)a.style.overflow='visible';});
  await page.locator('svg').screenshot({path:path.join(out,`${slug}.png`),omitBackground:true});
  // Outline the exported SVG: GitHub need not retain CSS, load fonts, or run JS.
  const outlines=metrics.text.map(t=>{
    const font=parsedFonts.get(`${t.family}/${t.weight}/${t.style}`);
    if(!font) throw new Error(`Unmapped font ${JSON.stringify(t)}`);
    const opt={kerning:false,letterSpacing:t.spacing/t.size};
    const width=font.getAdvanceWidth(t.text,t.size,opt);
    if(Math.abs(width-t.length)>2) throw new Error(`${slug}: font metric mismatch for ${t.text}: ${width} vs ${t.length}`);
    return {text:t.text,fill:t.fill,paths:font.getPaths(t.text,t.x,t.y,t.size,opt).map(p=>p.toPathData(3))};
  });
  await page.evaluate(outlines=>{
    document.querySelectorAll('svg text').forEach((t,i)=>{const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('data-text',outlines[i].text);g.setAttribute('fill',outlines[i].fill);for(const d of outlines[i].paths){const p=document.createElementNS(g.namespaceURI,'path');p.setAttribute('d',d);g.append(p);}t.replaceWith(g);});
  },outlines);
  const svg=await page.locator('svg').evaluate(el=>{el.setAttribute('width',el.viewBox.baseVal.width);el.setAttribute('height',el.viewBox.baseVal.height);return el.outerHTML;});
  await fs.writeFile(path.join(out,`${slug}.svg`),'<?xml version="1.0" encoding="UTF-8"?>\n'+svg+'\n');
  const record={slug,width:m.width,height:m.height,nodeCount:m.nodes.length,edgeCount:m.edges.length,externalRequests:requests,errors,fonts:metrics.fonts,textStyles:[...new Map(metrics.text.map(t=>[`${t.family}/${t.size}/${t.weight}/${t.style}`,{family:t.family,size:t.size,weight:t.weight,style:t.style}])).values()],labelContainment:metrics.containment,viewports:[]};
  await context.close();
  for(const width of [1040,900,375]) {
    const c=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
    const p=await c.newPage();await p.goto(pathToFileURL(path.join(out,`${slug}.html`)).href);await p.evaluate(()=>document.fonts.ready);
    const check=await p.evaluate(()=>{const s=document.querySelector('.diagram-container'),svg=document.querySelector('svg');s.scrollLeft=s.scrollWidth;const reached=s.scrollLeft;s.scrollLeft=0;return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,scrollerWidth:s.clientWidth,scrollWidth:s.scrollWidth,minWidth:getComputedStyle(svg).minWidth,reachableEnd:reached>=s.scrollWidth-s.clientWidth-1};});
    if(check.documentWidth!==width||!check.reachableEnd||check.minWidth!==`${m.width}px`) throw new Error(`${slug}: scrolling failure ${JSON.stringify(check)}`);
    const capture=`evidence/${slug}-${width}.png`;await p.screenshot({path:path.join(out,capture),fullPage:true});
    if(width===375) {
      await p.locator('.diagram-container').evaluate(s=>{s.scrollLeft=s.scrollWidth;});
      await p.screenshot({path:path.join(out,`evidence/${slug}-375-end.png`),fullPage:true});
      check.endCapture=`evidence/${slug}-375-end.png`;
    }
    record.viewports.push({...check,capture});
    await p.emulateMedia({media:'print'});
    record.print={minWidth:await p.locator('svg').evaluate(s=>getComputedStyle(s).minWidth),overflow:await p.locator('.diagram-container').evaluate(s=>getComputedStyle(s).overflowX)};
    await c.close();
  }
  evidence.variants.push(record);console.log(`Rendered ${slug}: ${m.nodes.length} nodes, labels contained, offline fonts and local scroll checked.`);
 }
 // Exercise the exact picture integration against local SVG images and PNG fallback.
 const readme=await fs.readFile(path.join(root,'README.md'),'utf8');
 const pictures=[...readme.matchAll(/<picture>[\s\S]*?<\/picture>/g)].map(x=>x[0]);
 evidence.readme=[];
 for(const colorScheme of ['light','dark']) for(const width of [900,375]) {
   const c=await browser.newContext({viewport:{width,height:1000},colorScheme,deviceScaleFactor:1});
   const p=await c.newPage();
   const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>README picture integration fixture</title><base href="../../../"><style>body{margin:0;background:${colorScheme==='dark'?'#0d1117':'#ffffff'}}img{display:block;width:100%;height:auto}</style></head><body>${pictures.join('')}</body></html>`;
   const fixture=path.join(out,`source/readme-${colorScheme}.html`);
   await fs.writeFile(fixture,html);
   await p.goto(pathToFileURL(fixture).href);await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
   const selected=await p.locator('img').evaluateAll(imgs=>imgs.map(i=>({currentSrc:i.currentSrc.split('/').pop(),naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,displayWidth:i.clientWidth})));
   if(selected.length!==2||selected.some(s=>!s.naturalWidth)) throw new Error('README image integration failed');
   const capture=`evidence/readme-${colorScheme}-${width}.png`;await p.screenshot({path:path.join(out,capture),fullPage:true});
   await p.locator('source').evaluateAll(ss=>ss.forEach(s=>s.remove()));
   await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
   const fallback=await p.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.currentSrc.split('/').pop(),naturalWidth:i.naturalWidth})));
   if(fallback.some(s=>!s.src.endsWith('.png')||!s.naturalWidth)) throw new Error('PNG fallback failed');
   evidence.readme.push({colorScheme,width,selected,fallback,capture});await c.close();
 }
} finally {await browser.close();}
// Structural routing checks use the source orthogonal polylines, conservatively including corner boxes.
const routeChecks=models.map(m=>{
 const failures=[];
 const crossings=[];
 const segments=m.edges.flatMap((e,i)=>e.points.slice(1).map((b,j)=>({a:e.points[j],b,edge:i})));
 const ports=new Map();
 for(const [i,e] of m.edges.entries()) for(const [id,p] of [[e.from,e.points[0]],[e.to,e.points.at(-1)]]) {
   const n=m.nodes.find(n=>n.id===id);
   const side=p[0]===n.x?'left':p[0]===n.x+n.w?'right':p[1]===n.y?'top':p[1]===n.y+n.h?'bottom':null;
   if(!side) failures.push(`edge ${i} endpoint off node border`);
   const key=`${id}/${side}`;const prior=ports.get(key)||[];
   if(prior.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<12)) failures.push(`edge ${i} shared attach point`);
   ports.set(key,[...prior,p]);
 }
 for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++) {
   const a=segments[i],b=segments[j];if(a.edge===b.edge)continue;
   const ah=a.a[1]===a.b[1],bh=b.a[1]===b.b[1];
   const between=(x,a,b)=>x>=Math.min(a,b)&&x<=Math.max(a,b);
   if(ah===bh) {
     if(ah?a.a[1]===b.a[1]&&Math.max(Math.min(a.a[0],a.b[0]),Math.min(b.a[0],b.b[0]))<Math.min(Math.max(a.a[0],a.b[0]),Math.max(b.a[0],b.b[0])):a.a[0]===b.a[0]&&Math.max(Math.min(a.a[1],a.b[1]),Math.min(b.a[1],b.b[1]))<Math.min(Math.max(a.a[1],a.b[1]),Math.max(b.a[1],b.b[1]))) failures.push(`stacked edges ${a.edge}/${b.edge}`);
   } else {
     const h=ah?a:b,v=ah?b:a;
     const x=v.a[0],y=h.a[1];
     if(between(x,h.a[0],h.b[0])&&between(y,v.a[1],v.b[1])) {
       const bridge=[m.edges[a.edge].bridge,m.edges[b.edge].bridge].find(p=>p?.x===x&&p?.y===y);
       if(!bridge)failures.push(`unbridged crossing ${a.edge}/${b.edge} at ${x},${y}`);
       crossings.push({edges:[a.edge,b.edge],x,y,bridged:Boolean(bridge)});
     }
   }
 }
 for(const [i,e] of m.edges.entries()) for(let j=1;j<e.points.length;j++) {
   const a=e.points[j-1],b=e.points[j];if(a[0]!==b[0]&&a[1]!==b[1]) failures.push(`edge ${i} diagonal`);
   for(const n of m.nodes.filter(n=>n.id!==e.from&&n.id!==e.to)) {
     const horizontal=a[1]===b[1];
     if(horizontal?a[1]>n.y&&a[1]<n.y+n.h&&Math.max(a[0],b[0])>n.x&&Math.min(a[0],b[0])<n.x+n.w:a[0]>n.x&&a[0]<n.x+n.w&&Math.max(a[1],b[1])>n.y&&Math.min(a[1],b[1])<n.y+n.h) failures.push(`edge ${i} transits ${n.id}`);
   }
 }
 return {slug:m.slug,failures,crossings,orthogonal:true,cornerRadius:8,attachSpacingMinimum:12};
});
if(routeChecks.some(r=>r.failures.length)) throw new Error(JSON.stringify(routeChecks));
evidence.routes=routeChecks;
evidence.files=[];
for(const file of (await fs.readdir(out)).filter(f=>/\.(html|svg|png)$/.test(f))) {const b=await fs.readFile(path.join(out,file));evidence.files.push({file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await fs.writeFile(path.join(out,'evidence/render-checks.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('Saved actual browser metrics, captures, source routing checks and SHA-256 file inventory.');
