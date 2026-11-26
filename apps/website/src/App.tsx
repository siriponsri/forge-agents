import {useEffect, useState, type ReactNode} from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {ArrowUpRight, ArrowRight, Sun, Moon, Menu, X, GitBranch, Layers3, Monitor, FileCheck2, Check, Download, ExternalLink} from 'lucide-react';
import {href, repo, publicBaseline, publicCheckpoint, titles, type Lang, type Page} from './site';
import {releases, windows} from './releases';
import {StrategyStory} from './StrategyStory';

type T = (th:string,en:string) => string;
const Mark = () => <svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#f97316" d="M8 8H56L44 20H20V28H48L36 40H20V56H8Z"/><path fill="#f2c94c" d="M44 8H56L44 20H32Z"/><path fill="#8b9199" d="M40 28H48L36 40H28Z"/></svg>;
const Arrow = () => <ArrowRight size={17} aria-hidden="true"/>;
function Action({children,to,secondary=false}:{children:ReactNode;to:string;secondary?:boolean}) {
  return <a className={`action ${secondary?'secondary':''}`} href={to}>{children}<Arrow/></a>;
}
function External({children,to}:{children:ReactNode;to:string}) {
  return <a className="text-link" href={to}>{children}<ArrowUpRight size={16} aria-hidden="true"/></a>;
}
function Header({lang,page,t}:{lang:Lang;page:Page;t:T}) {
  const [theme,setTheme] = useState('light');
  const [menu,setMenu] = useState(false);
  useEffect(()=>{
    let saved;
    try {saved=localStorage.getItem('forge.website.theme')} catch {/* Storage is optional. */}
    const choice=saved==='light'||saved==='dark'?saved:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    setTheme(choice); document.documentElement.dataset.theme=choice;
    const media=matchMedia('(prefers-color-scheme: dark)');
    const follow=()=>{try{if(localStorage.getItem('forge.website.theme'))return}catch{}const v=media.matches?'dark':'light';setTheme(v);document.documentElement.dataset.theme=v};
    media.addEventListener('change',follow);return()=>media.removeEventListener('change',follow);
  },[]);
  useEffect(()=>{if(!menu)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);document.getElementById('menu-toggle')?.focus()}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[menu]);
  const toggleTheme=()=>{const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.dataset.theme=next;try{localStorage.setItem('forge.website.theme',next)}catch{}};
  return <header className="site-header"><div className="header-inner">
    <a className="brand" href={href(lang)} aria-label="FORGE home"><Mark/><span>FORGE</span></a>
    <nav className={menu?'nav open':'nav'} id="main-navigation" aria-label={t('เมนูหลัก','Main navigation')}>
      <a aria-current={page==='home'?'page':undefined} href={href(lang)+'#product'}>Product</a>
      <a href={href(lang)+'#architecture'}>Architecture</a>
      <a aria-current={page==='docs'?'page':undefined} href={href(lang,'docs')}>Docs</a>
      <a aria-current={page==='changelog'?'page':undefined} href={href(lang,'changelog')}>Changelog</a>
      <a className="mobile-source" href={repo}>GitHub <ArrowUpRight size={14}/></a>
    </nav>
    <div className="header-actions">
      <a className="language" href={href(lang==='th'?'en':'th',page)} lang={lang==='th'?'en':'th'} aria-label={t('Switch to English','เปลี่ยนเป็นภาษาไทย')}>{lang==='th'?'EN':'ไทย'}</a>
      <button className="icon-button" onClick={toggleTheme} aria-label={t(theme==='light'?'ใช้ธีมมืด':'ใช้ธีมสว่าง',theme==='light'?'Use dark theme':'Use light theme')}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button>
      <a className="header-cta" href={href(lang,'download')}>{t('เริ่มต้นใช้งาน','Get started')}<ArrowUpRight size={15}/></a>
      <button id="menu-toggle" className="icon-button menu-toggle" aria-label={t(menu?'ปิดเมนู':'เปิดเมนู',menu?'Close menu':'Open menu')} aria-expanded={menu} aria-controls="main-navigation" onClick={()=>setMenu(!menu)}>{menu?<X size={21}/>:<Menu size={21}/>}</button>
    </div>
  </div></header>;
}

const layers = [
  {id:'core',name:'FORGE core',caption:'Projects · Teams · Plans',icon:Layers3,
    th:'แผน ทีม งาน และหลักฐานอยู่ในบันทึกชุดเดียวกัน มุมมอง Kanban และเอกสารอ้างอิงข้อมูลเดียวกัน โดย FORGE เป็นเจ้าของการอนุมัติและขอบเขตงาน',
    en:'Projects, teams, tasks and evidence share canonical records. Planning views and documents stay connected, with FORGE owning scope and approvals.',
    boundaryTh:'บันทึกสถานะงานไม่ใช่หลักฐานว่าเอเจนต์ทำงานสำเร็จ',boundaryEn:'A task status alone is never proof of successful execution.'},
  {id:'harness',name:'T3 + AG-UI',caption:'Execution · Events · Recovery',icon:GitBranch,
    th:'T3 เป็นเจ้าของ provider turn ส่วน AG-UI ส่งสถานะ ข้อความ และเหตุการณ์สู่หน้าจอ การเชื่อมต่อใหม่ต้องตรวจสอบสถานะเดิมก่อนเริ่มงานซ้ำ',
    en:'T3 owns provider turns. AG-UI projects lifecycle, messages and state into the workbench. Reconnect reconciles existing work before any new execution.',
    boundaryTh:'AG-UI เป็นสะพานข้อมูล ไม่ใช่ตัววางแผนหรือฐานข้อมูลงานอีกชุด',boundaryEn:'AG-UI is a projection layer, not another planner or task store.'},
  {id:'connections',name:'Your connections',caption:'MCP · Models · Compute',icon:Monitor,
    th:'ตั้งค่าบัญชี เครื่องมือ MCP โมเดล compute และเป้าหมาย desktop แยกตามโปรเจกต์ แต่ละการเชื่อมต่อต้องรายงานสิทธิ์และความพร้อมจริง',
    en:'Configure models, MCP tools, compute and desktop targets per project. Each connection has its own credentials, capabilities and qualification.',
    boundaryTh:'การทดสอบ browser ไม่ได้ยืนยันว่า native desktop หรือบริการ cloud พร้อมใช้',boundaryEn:'Browser checks do not qualify native desktop control or cloud services.'},
  {id:'artifacts',name:'Work you can inspect',caption:'Univer · WordCraft · PdfCraft',icon:FileCheck2,
    th:'แก้เอกสารและตารางด้วย Univer สร้างรายงานผ่าน WordCraft และ PdfCraft พร้อมบันทึก revision และ checksum ของไฟล์ที่สร้างจริง',
    en:'Edit documents and sheets with Univer. Produce reports through WordCraft and PdfCraft, keeping source revisions and checksums with actual output files.',
    boundaryTh:'การส่งออกขึ้นอยู่กับ engine และฟอนต์ที่ผ่านการตรวจสอบ ไม่รับรองความเหมือนทุกไฟล์ Office',boundaryEn:'Exports depend on qualified engines and fonts; universal Office fidelity is not claimed.'},
];
function Architecture({t,lang}:{t:T;lang:Lang}) {
  const [active,setActive] = useState('core');
  return <section className="architecture section" id="architecture" aria-labelledby="architecture-heading">
    <div className="section-intro"><h2 id="architecture-heading">Connected by design.<br/><span>Owned by you.</span></h2><p>{t('เข้าใจว่าแต่ละส่วนทำหน้าที่อะไร ตั้งแต่แผนแรกไปจนถึงไฟล์สุดท้าย เลือกแต่ละชั้นเพื่อดูขอบเขตการทำงาน','Follow the work from the first plan to the final artifact. Select a layer to see what it owns, and where its responsibility ends.')}</p></div>
    <Tabs.Root value={active} onValueChange={setActive} className="architecture-tabs" orientation="vertical">
      <div className="diagram" aria-label={t('โครงสร้าง FORGE แบบโต้ตอบ','Interactive FORGE architecture')}>
        <div className="diagram-heading"><Mark/><span>FORGE workspace</span><span className="local-label">{t('บนเครื่องของคุณ','On your machine')}</span></div>
        <Tabs.List className="layer-list" aria-label={t('เลือกชั้นสถาปัตยกรรม','Choose architecture layer')}>
          {layers.map(({id,name,caption,icon:Icon})=><Tabs.Trigger key={id} value={id} className="layer"><Icon size={22} aria-hidden="true"/><span>{name}<small>{caption}</small></span><span className="layer-dot" aria-hidden="true"/></Tabs.Trigger>)}
        </Tabs.List>
        <div className="diagram-output"><span>Plan</span><Arrow/><span>Execute</span><Arrow/><span>Verify</span></div>
      </div>
      <div className="layer-details">{layers.map(layer=><Tabs.Content key={layer.id} value={layer.id} className="layer-content"><h3>{layer.name}</h3><p className="detail-type">{layer.caption}</p><p>{t(layer.th,layer.en)}</p><div className="boundary"><Check size={17} aria-hidden="true"/><p>{t(layer.boundaryTh,layer.boundaryEn)}</p></div><External to={href(lang,'github')}>{t('ดูสถานะ source','Development source status')}</External></Tabs.Content>)}</div>
    </Tabs.Root>
  </section>;
}

const capabilities = [
  ['Missions & Delivery Pack','local','จากโจทย์สู่แผน ตรวจไฟล์ รันทดสอบ เปิด preview และรวมผลลัพธ์เป็นแพ็ก พร้อมหลักฐานการตรวจของนักพัฒนา','Turn a brief into a plan, check files, run tests, open a preview and package outputs with developer verification evidence.','app/missions/index.mjs'],
  ['Parallel Workspace','local','แยก Git workspace ต่อชิ้นงาน ตรวจผลและขออนุมัติก่อนรวม; ยังไม่ได้ทดสอบโมเดลจริงทำงานพร้อมกัน','Separate Git workspaces with checks and review before integration; simultaneous live model runs are not yet verified.','app/workspaces/index.mjs'],
  ['Chat ↔ Visualization','local','สลับแชตกลุ่มกับกราฟ agent และ run ตรวจหลักฐานและใช้ปุ่มควบคุมเดิม โดย T3 เป็นเจ้าของการรันเพียงรายเดียว','Switch between group chat and the agent/run graph. Inspect evidence and use existing controls; T3 remains the sole execution owner.','app/web/src/AgentWorkspace.jsx'],
  ['Proactive recipes & Inbox','local','ตั้งสูตรงานและตรวจข้อยกเว้นใน Inbox ได้ การรันอัตโนมัติยังถูกบล็อกจนกว่าจะยืนยันการควบคุมทุก action','Configure recipes and review exceptions in Inbox. Automatic execution stays blocked until every action is proven guarded.','app/proactive/index.mjs'],
  ['Budget policies','local','กำหนดวงเงินและคงยอดสำรองเมื่อ usage ไม่ชัดเจน; การรับใบเสร็จ billing จาก native provider ยังไม่ครบ','Set budgets and retain reservations when usage is unknown; native provider billing receipt ingestion is incomplete.','app/budgets/index.mjs'],
  ['Research Lab','local','ทดสอบ CPU/ไฟล์ในเครื่อง ตรวจซ้ำ เปรียบเทียบและส่งออกผ่านแอปได้ นักพัฒนาตรวจแล้ว; การเชื่อม agent/native และการรับรองยังไม่ครบ ไม่มีผลทดสอบโมเดลหรือคะแนน benchmark','Local CPU/file trials, recheck, comparison and export are mounted and developer verified. Agent/native execution bridging and qualification remain pending; no model trials or benchmark scores.','app/research/index.mjs'],
  ['Multi-Agent Teams','experimental','ทีมประจำและผู้ช่วยตามงาน พร้อมบทบาทและขอบเขตงาน; การทำงานพร้อมกันขึ้นอยู่กับ harness ที่เชื่อมต่อ','Resident bots and task-scoped helpers with roles and ownership; concurrency depends on connected harnesses.','app/web/src/work.jsx'],
  ['Adaptive Harness','experimental','นโยบายเลือกทักษะและบริบท; ยังไม่อ้างว่าเรียนรู้หรือปรับปรุงตัวเองได้โดยอัตโนมัติ','Capability-based routing and context policies; autonomous learned improvement is not claimed.','app/context/index.mjs'],
  ['AG-UI','experimental','สะพานเหตุการณ์ T3 สู่หน้าจอ; ต้องตรวจ lifecycle และ recovery ตาม provider จริง','T3 lifecycle projection into the UI; end-to-end lifecycle and recovery require provider qualification.','app/protocol/controller.mjs'],
  ['Cognitive Memory','experimental','บริบทและความจำแยกขอบเขต; memory backend ต้องตั้งค่าและผ่านการตรวจสอบ','Scoped context and memory; external memory backends require setup and qualification.','app/memory/index.mjs'],
  ['AI Engineering','experimental','notebook, jobs, artifacts และ serving; cloud และโมเดลจริงต้องตรวจแยก','Notebooks, jobs, artifacts and serving; cloud targets and actual model inference need separate checks.','app/serving/service.mjs'],
  ['Computer Use','experimental','เป้าหมายและ controller มีขอบเขตชัดเจน; native desktop แต่ละชนิดต้องตรวจจริง','Target-aware control boundaries; each native desktop driver requires its own verification.','app/desktop/index.mjs'],
  ['MCP','experimental','ค้นพบและจำกัดเครื่องมือตามโปรเจกต์; บริการภายนอกต้องเชื่อมต่อและตรวจสิทธิ์','Tool discovery and project scope; live services need connection and authorization checks.','app/providers/mcp.mjs'],
  ['Univer','local','แก้เอกสารและตารางแบบ native snapshot พร้อม revision; การแลกเปลี่ยน Office เป็นคนละความสามารถ','Native document and sheet snapshots with revisions; Office exchange is a separate capability.','app/web/src/Office.jsx'],
  ['WordCraft + PdfCraft','local','สร้าง DOCX/PDF ผ่าน engine ในเครื่องที่ตรวจแล้ว; ปัจจุบัน engine qualification อยู่ที่ Windows x64','Local engine-generated DOCX/PDF; current native engine qualification is Windows x64.','app/reports/service.mjs'],
  ['Autonomous skill promotion','planned','การเลื่อนทักษะจากผลประเมินยังเป็นเป้าหมาย ไม่ใช่ความสามารถที่ปล่อยแล้ว','Evaluation-backed autonomous skill promotion remains a target, not a released capability.','docs/owner/forge-local-complete-20261124-v3/05_ARCHITECTURE_AND_SETTINGS.md'],
] as const;
function CapabilityTable({t,lang}:{t:T;lang:Lang}) {
  const [filter,setFilter] = useState('all');
  return <section className="section capabilities" id="capabilities" aria-labelledby="capabilities-heading">
    <div className="section-intro"><h2 id="capabilities-heading">Know what’s ready.</h2><p>{t('สถานะรุ่นพัฒนา 25 พ.ย. 2026 หน้าจอที่ตรวจแล้วเชื่อมกับแอปหลัก โดยใช้ข้อมูล provider/native ที่ป้อนเพื่อการทดสอบและติดป้ายกำกับ ไม่ใช่ผลทดสอบโมเดลจริง','Development status, 25 Nov 2026. Verified screens are mounted in the app and checked with labelled injected provider/native observations, not live model runs.')}</p></div>
    <div className="capability-filters" role="group" aria-label={t('กรองสถานะความสามารถ','Filter capability status')}>{[['all',t('ทั้งหมด','All capabilities')],['local',t('นักพัฒนาตรวจแล้ว','Developer verified')],['experimental','Experimental'],['planned','Planned']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    <p className="sr-only" role="status">{t('แสดง','Showing')} {capabilities.filter(c=>filter==='all'||c[1]===filter).length} {t('รายการ','capabilities')}</p>
    <div className="capability-table">{capabilities.filter(c=>filter==='all'||c[1]===filter).map(([name,status,th,en])=><article className="capability" key={name}><div><h3>{name}</h3><span className={`status ${status}`}>{status==='local'?t('นักพัฒนาตรวจแล้ว','Developer verified'):status==='planned'?'Planned':'Experimental'}</span></div><p>{t(th,en)}</p><a href={href(lang,'github')} aria-label={`${name}: ${t('สถานะ source','source availability')}`}><ArrowUpRight size={19}/></a></article>)}</div>
    <p className="qualification-note">{t('Source checkpoint d928e9c เป็นสาธารณะแล้ว · ยังอยู่ระหว่างพัฒนาและไม่มี public release · Home UAT และ macOS native: NOT_RUN','Development checkpoint d928e9c is public · In development; no public release · Home UAT and native macOS: NOT_RUN')} <a href={href(lang,'changelog')}>{t('อ่านสถานะและข้อจำกัด','Read status and limits')}<ArrowUpRight size={14}/></a></p>
  </section>;
}

function Home({lang,t}:{lang:Lang;t:T}) {
  return <div className="landing">
    <section className="hero wrap" id="product">
      <div className="hero-context"><span>{t('พื้นที่ทำงาน AI บนเครื่องของคุณ','The local workspace for connected AI work')}</span><a href={href(lang,'github')}>{t('Open source · กำลังพัฒนา','Open source · In development')}<ArrowUpRight size={14} aria-hidden="true"/></a></div>
      <div className="hero-copy"><h1>One workspace.<br/>Every part of<br/>the <span className="hero-work">work<span className="orange-period">.</span></span></h1><div className="hero-aside"><div className="hero-thesis"><span className="thesis-line" aria-hidden="true"/><p>{t('จากไอเดีย ถึงสิ่งที่ตรวจสอบได้','From a first idea to work you can inspect.')}</p></div><p>{t('เปลี่ยนไอเดียเป็นแผน ให้ทีมเอเจนต์ลงมือทำ แล้วเก็บเอกสาร ผลลัพธ์ และหลักฐานไว้ด้วยกัน ในพื้นที่ทำงานบนเครื่องของคุณ','Turn an idea into a plan. Put your agents to work. Keep the documents, outputs and evidence together in a workspace on your machine.')}</p><div className="hero-actions"><Action to={href(lang,'install')}>{t('ดูวิธีเริ่มต้น','Explore FORGE')}</Action><External to={repo}>View on GitHub</External></div><p className="hero-note">{t('ใช้บัญชีและโมเดลที่คุณเชื่อมต่อ · ยังไม่มี signed release','Bring your connected accounts and models · No signed release')}</p></div></div>
      <div className="hero-index"><a href="#strategies">{t('สำรวจกลยุทธ์','Explore formations')}<Arrow/></a><span>Plan <span aria-hidden="true">/</span> Execute <span aria-hidden="true">/</span> Inspect</span><a href="#workbench">{t('ดูพื้นที่ทำงานจริง','See the real workbench')}<Arrow/></a></div>
    </section>
    <div className="wrap"><StrategyStory lang={lang} t={t}/></div>
    <section className="workbench-proof wrap" id="workbench" aria-labelledby="workbench-heading">
      <div className="proof-heading"><h2 id="workbench-heading">The work has<br/>a home.</h2><div><p>{t('แผน ทีม และงานจริงในพื้นที่เดียวกัน ภาพจากแอป FORGE ที่นักพัฒนาเปิดตรวจ ไม่ใช่ภาพจำลอง UI','Plans, teams and tasks in one place. An actual FORGE capture from developer verification.')}</p><a className="text-link" href={href(lang,'changelog')}>{t('อ่านสิ่งที่ตรวจแล้วและข้อจำกัด','Read verification and limits')}<ArrowUpRight size={16} aria-hidden="true"/></a></div></div>
      <figure className="product-figure"><a className="screenshot-button" href="/forge-workbench.png" aria-label={t('เปิดภาพพื้นที่ทำงานความละเอียดเต็ม','Open full-resolution workbench screenshot')}><img src="/forge-workbench.png" width="1440" height="1000" fetchPriority="high" alt={t('หน้าจอ FORGE จริงรุ่นพื้นฐาน 24 พ.ย. 2026 ในธีม Dark Modern แสดงแผน งาน และสมาชิกทีม พร้อมข้อมูลตัวอย่างสำหรับการตรวจสอบของนักพัฒนา','Actual FORGE baseline workbench, 24 Nov 2026, in Dark Modern, showing plans, tasks and team ownership with disposable developer verification data')}/></a><figcaption><span><span className="caption-dot"/>FORGE workbench · Dark Modern</span><span>{t('ภาพจริง 24 พ.ย. 2026 · ข้อมูลทดสอบของนักพัฒนา · ก่อน integration ใหม่','Actual capture · 24 Nov 2026 · Developer fixtures · Before newer integrations')}</span></figcaption></figure>
      <div className="product-principles"><span><Layers3 size={18}/> {t('แผนและทีมในพื้นที่เดียว','Plans and teams, together')}</span><span><Monitor size={18}/> {t('ทำงานบนเครื่องของคุณ','A workspace on your machine')}</span><span><FileCheck2 size={18}/> {t('ผลลัพธ์ที่ตรวจสอบย้อนกลับได้','Outputs with a traceable source')}</span></div>
    </section>
    <section className="section workflow" aria-labelledby="workflow-heading"><div className="section-intro"><h2 id="workflow-heading">From intention<br/>to something real.</h2><p>{t('งานไม่ได้จบที่คำตอบในแชต FORGE เชื่อมขั้นตอนการทำงานกับสิ่งที่บันทึกและตรวจได้จริง','Work goes beyond a chat response. FORGE connects the steps of a project to records and artifacts you can actually inspect.')}</p></div>
      <div className="workflow-rows">{[
        ['Plan with your team.','กำหนดเป้าหมาย แบ่งงาน และเลือกผู้รับผิดชอบ ให้คนและเอเจนต์เห็นแผนเดียวกัน','Set a goal, break it into tasks and assign ownership. People and agents work from the same plan.','Teams · Plans · Approvals'],
        ['Work in context.','เลือก harness โมเดล และเครื่องมือตามขอบเขตของโปรเจกต์ พร้อมเก็บสถานะและบริบทของงาน','Choose harnesses, models and tools within project scope. Keep work state and relevant context connected.','T3 · AG-UI · MCP · Memory'],
        ['Leave a useful result.','แก้เอกสาร รัน notebook และสร้างรายงาน แล้วตรวจไฟล์จริงและ revision ก่อนรับรองผล','Edit documents, run notebooks and produce reports. Inspect the real files and their source revisions before accepting work.','Univer · WordCraft · PdfCraft'],
      ].map(([heading,th,en,tools])=><article key={heading}><h3>{heading}</h3><div><p>{t(th,en)}</p><span>{tools}</span></div></article>)}</div>
    </section>
    <Architecture t={t} lang={lang}/><CapabilityTable t={t} lang={lang}/>
    <section className="closing section"><h2>Your next idea.<br/>A place to begin.</h2><div><p>{t('เริ่มจากคู่มือติดตั้ง ตรวจข้อกำหนด และเชื่อมต่อบริการเมื่อคุณพร้อม','Start with the setup guide. Check the requirements, then connect your services when you’re ready.')}</p><Action to={href(lang,'install')}>{t('อ่านคู่มือติดตั้ง','Read the installation guide')}</Action><a className="subtle-link" href={href(lang,'download')}>{t('ดูสถานะ Windows download','Check Windows download status')}<Arrow/></a></div></section>
  </div>;
}

function DownloadPage({lang,t}:{lang:Lang;t:T}) {
  return <><div className="page-heading"><h1>Downloads &<br/>release status.</h1><p>{t('ตรวจสถานะก่อนติดตั้ง ลิงก์ดาวน์โหลดจะแสดงเฉพาะแพ็กเกจจาก GitHub Release ที่ตรวจสอบ metadata และ SHA-256 ได้','Check the status before installing. Download links appear only for GitHub Release assets with verified metadata and SHA-256.')}</p></div>
    <section className="download-panel"><div><Monitor size={28}/><h2>FORGE for Windows</h2><span className="status experimental">{windows?'Public GitHub Release':t('ยังไม่มี public download','Public download unavailable')}</span><p>{windows?`${windows.release.tag} · ${windows.name}`:t('ยังไม่มีแพ็กเกจ Windows สาธารณะที่ผ่านเงื่อนไขการแสดงลิงก์ ใน metadata ที่บันทึกไว้ จึงไม่มีปุ่มดาวน์โหลดไฟล์ติดตั้ง','The recorded metadata contains no public Windows package that meets the download requirements. No installer download is offered.')}</p>{windows?<><Action to={windows.url}><Download size={17}/>{t('ดาวน์โหลดแพ็กเกจ','Download package')}</Action><p className="checksum">SHA-256: {windows.sha256}</p><p>{Math.round(windows.bytes/1024/1024)} MiB · <a href={windows.release.url}>Release notes</a></p></>:<Action to={href(lang,'install')}>{t('อ่านวิธีติดตั้งจาก source','Read source setup instructions')}</Action>}</div><aside><h3>{t('สิ่งที่มีใน source','Available in source')}</h3><p>{t('launcher สำหรับ Windows ผ่านการตรวจติดตั้งและเปิด localhost ในเครื่องนักพัฒนา แต่ archive จาก launcher เป็น source package ไม่ใช่ signed binary release','Windows launchers have developer-local install and localhost startup evidence. Launcher archives are source packages, not signed binary releases.')}</p><h3>macOS</h3><p>{t('มี launcher ใน source แต่การทดสอบบน macOS จริงยังเป็น NOT_RUN และยังไม่มีแพ็กเกจ macOS ที่รับรองบนเว็บนี้','Launchers exist in source. Native macOS qualification is NOT_RUN. This website offers no qualified macOS package.')}</p><External to={`${repo}/releases`}>{t('ตรวจสอบ GitHub Releases','Check GitHub Releases')}</External></aside></section>
    <div className="metadata-note"><h2>Release metadata</h2><dl><div><dt>{t('ตรวจล่าสุด (UTC)','Last checked (UTC)')}</dt><dd>{releases.checkedAt||t('ยังไม่ได้ตรวจ','Not checked')}</dd></div><div><dt>Public API</dt><dd>{releases.state}{releases.httpStatus?` · HTTP ${releases.httpStatus}`:''}</dd></div><div><dt>{t('แหล่งข้อมูล','Source')}</dt><dd><a href={`https://api.github.com/repos/${releases.repository}/releases`}>GitHub Releases API<ExternalLink size={14}/></a></dd></div></dl><p>{t('ข้อมูลนี้เป็น snapshot ที่บันทึกขณะเตรียมเว็บ ไม่ใช่การตรวจแบบสด เบราว์เซอร์ไม่เรียก API ของ FORGE ในเครื่องคุณ','This is a checked-in build snapshot, not a live availability check. Your browser does not contact a local FORGE runtime.')}</p></div>
  </>;
}

function Install({lang,t}:{lang:Lang;t:T}) {
  return <><div className="page-heading"><h1>Start on<br/>your own machine.</h1><p>{t('คู่มือนี้สำหรับ source รุ่นพัฒนา Windows คือแพลตฟอร์มที่มีหลักฐานการทดสอบในเครื่อง ส่วน Home UAT ยังไม่ได้ทดสอบ','This guide covers the development source. Windows has local verification evidence; home UAT has not been run.')}</p></div>
    <div className="reading-layout"><aside className="reading-aside"><h2>Before you begin</h2><ul><li>Windows x64</li><li>Node.js 24.13+</li><li>{t('อินเทอร์เน็ตในการเริ่มครั้งแรก','Internet on first start')}</li><li>{t('บัญชีบริการของคุณเอง','Your own provider accounts')}</li></ul><a href={href(lang,'download')}>{t('ตรวจสถานะ public release','Check public release status')}<Arrow/></a></aside><div className="prose">
      <section><h2>Get the source</h2><p>{t('Checkpoint d928e9c เผยแพร่บน main แล้ว พร้อม Missions, isolated workspaces และ integration รุ่นพัฒนา เลือก revision นี้ แล้วใช้ Code → Download ZIP หรือ clone แตกทั้งโฟลเดอร์ก่อนเริ่ม ห้ามรัน launcher ภายใน ZIP','Checkpoint d928e9c is published on main, including Missions, isolated workspaces and development integrations. Select that revision, then use Code → Download ZIP or clone. Extract the whole folder before starting; do not run a launcher inside a ZIP.')}</p><External to={publicCheckpoint}>{t('เปิด source checkpoint','Open source checkpoint')}</External><p>{t('เป็น development checkpoint ที่ยังมีงานค้าง อ่าน handoff ก่อนเริ่ม เครื่องใหม่นี้จะไม่ได้รับ credentials หรือ runtime ส่วนตัวจาก Git และเว็บนี้ไม่ขอ token','This development checkpoint has remaining work; read its handoff before starting. Git does not transfer machine credentials or private runtimes. This website never asks for a token.')}</p></section>
      <section><h2>Open FORGE</h2><p>{t('ติดตั้ง Node.js 24.13 ขึ้นไป แล้วดับเบิลคลิก Start-FORGE.cmd ที่ root ของ source การเริ่มครั้งแรกติดตั้ง dependency ที่ pin ไว้และ build แอป จากนั้นเปิดที่อยู่ localhost ที่ launcher แสดง','Install Node.js 24.13 or later. Double-click Start-FORGE.cmd at the source root. First launch installs pinned dependencies and builds the app, then opens the localhost address reported by the launcher.')}</p><p>{t('ใช้ Stop-FORGE.cmd เพื่อหยุด และ Restart-FORGE.cmd เพื่อเริ่มใหม่ ข้อมูลบนเครื่องแยกจาก source; การอัปเดตควรสำรองข้อมูลตามคู่มือก่อน','Use Stop-FORGE.cmd to stop and Restart-FORGE.cmd to restart. Machine data is separate from source; follow the backup guide before updating.')}</p><External to="https://nodejs.org/en/download">Node.js downloads</External></section>
      <section><h2>Connect deliberately</h2><p>{t('สร้างโปรเจกต์ใน GUI แล้วเพิ่มบัญชีและ connection ที่ต้องใช้ใน Settings ตรวจสิทธิ์ เครื่องมือ และสถานะจริงก่อนรัน งานและผู้ช่วยต้องอยู่ในขอบเขตที่คุณอนุญาต','Create a project in the GUI, then add the accounts and connections you need in Settings. Check permissions, tools and actual readiness before running. Work and helpers stay within the scope you authorize.')}</p></section>
      <section id="first-flow"><h2>Check your first flow</h2><p>{t('สร้างแผนและงาน บันทึกเอกสาร แล้วปิดและเปิดใหม่เพื่อตรวจการคงอยู่ของข้อมูล ทดสอบ provider และรายงานแยกตามบริการและ engine ที่ตั้งค่าไว้','Create a plan and task, save a document, then reopen to check persistence. Qualify providers and reports separately against the services and engines you configured.')}</p><p>{t('macOS: มี Start-FORGE.command ใน source แต่ native qualification ยังเป็น NOT_RUN และ report engines ปัจจุบันตรวจบน Windows x64 เท่านั้น','macOS: Start-FORGE.command exists in source, but native qualification is NOT_RUN. Current report engine qualification covers Windows x64 only.')}</p><External to={href(lang,'docs')}>{t('ดูเอกสารเพิ่มเติม','More documentation')}</External></section>
    </div></div></>;
}

function Docs({lang,t}:{lang:Lang;t:T}) {
  return <><div className="page-heading"><h1>A clearer way<br/>into the work.</h1><p>{t('เริ่มต้นใช้งาน ทำความเข้าใจขอบเขตของระบบ และอ่านหลักฐานจาก source โดยเอกสารเป้าหมายไม่ใช่คำยืนยันว่าทุกความสามารถเสร็จแล้ว','Start here, understand the system boundaries, and follow evidence into the source. Requirement documents describe targets, not completed capability claims.')}</p></div>
    <div className="doc-links">{[
      ['Installation guide',t('ข้อกำหนด วิธีเปิด และสิ่งที่ต้องตรวจบนเครื่องคุณ','Requirements, launch steps and checks on your machine.'),href(lang,'install')],
      ['Architecture & ownership',t('FORGE, T3, AG-UI และขอบเขตของ adapter','FORGE, T3, AG-UI and adapter responsibility boundaries.'),href(lang)+'#architecture'],
      ['Office & reports',t('Univer, WordCraft และ PdfCraft และข้อจำกัดการส่งออก','Univer, WordCraft and PdfCraft qualification and export boundaries.'),href(lang)+'#capabilities'],
      ['Implementation status',t('แยกสิ่งที่ทำแล้ว ช่องว่าง และ live checks ที่ยังไม่ได้รัน','Implemented work, remaining gaps and live checks not yet run.'),href(lang,'changelog')],
      ['Release status',t('ข้อมูล public GitHub Release และสถานะ download','Recorded public GitHub Release metadata and download status.'),href(lang,'download')],
      ['Home verification',t('รายการตรวจสำหรับเครื่องเจ้าของ — Home UAT ยังไม่ได้ทดสอบ','Owner-machine verification checklist — Home UAT not run.'),href(lang,'install')+'#first-flow'],
    ].map(([title,description,to])=><a href={to} key={title}><div><h2>{title}</h2><p>{description}</p></div><ArrowUpRight size={24}/></a>)}</div></>;
}

function Changelog({lang,t}:{lang:Lang;t:T}) {
  return <><div className="page-heading"><h1>Work in progress.<br/>Out in the open.</h1><p>{t('บันทึกนี้สรุปสถานะการพัฒนา ไม่ใช่ประกาศ public release หรือการรับรองผลบนเครื่องของคุณ','These notes describe development work. They are not public release announcements or qualification on your machine.')}</p></div>
    <div className="changelog">
      <article><div><time dateTime="2026-11-25">25 Nov 2026</time><span className="status experimental">{t('Source checkpoint สาธารณะ','Public source checkpoint')}</span></div><section><h2>Missions, workspaces & visualization</h2><p>{t('Missions/Delivery Pack, Parallel Workspace แบบแยก Git, Chat ↔ Node–Edge Visualization, Proactive recipes/Inbox และนโยบายงบประมาณเชื่อมกับแอปแล้วและผ่านการตรวจของนักพัฒนา โดยใช้ข้อมูล provider/native ที่ป้อนเพื่อการทดสอบและติดป้ายกำกับ ไม่ใช่การรันโมเดลจริง','Missions/Delivery Pack, isolated Parallel Workspace, Chat ↔ Node–Edge Visualization, Proactive recipes/Inbox and budget policies are mounted and developer verified with labelled injected provider/native observations. These are not live model runs.')}</p><p>{t('Guarded แบบจำกัด read/propose/edit และการส่ง selection กลับ native turn ผ่านการตรวจ runtime จริงกับ model protocol บน localhost แล้ว การรับรอง Research ทั้งทีมยังไม่ครบและใบเสร็จ monetary billing ยังไม่รองรับ เส้นทางนอกชุดที่ตรวจเป็น NOT_QUALIFIED','Bounded Guarded read/propose/edit and supervised selection return passed actual native runtime checks with loopback model protocol. Full Research cohort qualification is pending; authoritative monetary billing receipts are unsupported. Routes outside the checked subset remain NOT_QUALIFIED.')}</p><p>{t('ไม่ได้อ้างว่าโมเดลทำงานดีขึ้นหรือมีคะแนน benchmark และยังไม่ได้ทดสอบ live account, Home UAT หรือ macOS native ภาพในหน้าหลักเป็นรุ่นพื้นฐาน 24 พ.ย. ไม่ใช่หลักฐานของ integration ใหม่','No model-quality improvement or benchmark scores are claimed. Live-account, Home UAT and native macOS checks are not run. The home-page screenshot shows the 24 Nov baseline, not these newer integrations.')}</p><External to={publicCheckpoint}>{t('เปิด checkpoint d928e9c','Open checkpoint d928e9c')}</External></section></article>
      <article><div><time dateTime="2026-11-24">24 Nov 2026</time><span className="status local">{t('Source เป็นสาธารณะ','Public source')}</span></div><section><h2>Complete Local v3 baseline</h2><p>{t('พื้นที่ทำงานพื้นฐานเชื่อมแผน ทีม notebook เอกสาร Univer และ report pipeline พร้อมธีม VS Code 15 แบบในแอป ภาพจริงบนเว็บนี้อ้างอิง source รุ่นนี้พร้อมข้อมูลทดสอบของนักพัฒนา','The baseline workbench connects plans, teams, notebooks, Univer documents and report pipelines, with 15 VS Code themes in the app. This site’s actual screenshot references this source baseline with developer fixture data.')}</p><External to={publicBaseline}>{t('ดู source พื้นฐาน 01ee779','Inspect baseline 01ee779')}</External></section></article>
      <article><div><span>Public releases</span></div><section><h2>{t('ตรวจสอบก่อนดาวน์โหลด','Check before downloading')}</h2><p>{t('การมี source และ launcher ไม่เท่ากับการมี signed binary release ข้อมูล GitHub Releases ที่ตรวจวันที่ 25 พ.ย. 2026 ยังว่าง จึงไม่มีปุ่มดาวน์โหลดแพ็กเกจ','Source and launchers do not establish a signed binary release. The GitHub Releases check on 25 Nov 2026 returned no releases, so no package download is offered.')}</p><a className="text-link" href={href(lang,'download')}>{t('ดูสถานะ release','View release status')}<Arrow/></a></section></article>
    </div></>;
}
function Github({t}:{t:T}) {
  return <><div className="page-heading"><h1>Follow the source.<br/>Inspect the work.</h1><p>{t('แกนหลักแบบ open source ทำงานบนเครื่องของคุณ ส่วนบริการ remote และทีมเป็นทางเลือกในอนาคต เว็บนี้ build แยกจาก runtime โดยไม่มีข้อมูลส่วนตัว ความจำ หรือ credential','The open-source core runs on your machine. Optional remote and team services are future work. This site builds independently of the runtime, without private workspace data, memory or credentials.')}</p></div><section className="source-panel"><GitBranch size={36}/><h2>siriponsri / forge-agents</h2>
    <h3>Public baseline</h3><p>{t('ภาพจริงวันที่ 24 พ.ย. แสดง source พื้นฐาน 01ee779 ซึ่งมี Office รวมอยู่ด้วย และยังเปิดดู revision เดิมได้ ภาพนี้ไม่ได้แทนหน้าจอ integration ที่เพิ่มภายหลัง','The actual 24 Nov screenshot shows public baseline 01ee779, including Office. That historical revision remains available. The image does not represent integrations added later.')}</p>
    <div className="source-links"><External to={publicBaseline}>{t('ดู source พื้นฐาน 01ee779','Inspect baseline 01ee779')}</External><External to={`${repo}/blob/01ee779ffd049ba875ad85bd36f2c8accd274ca0/app/web/src/Office.jsx`}>{t('ดู source ของ Office','Inspect Office source')}</External></div>
    <h3>Current development</h3><p>{t('ตรวจ GitHub API แบบไม่ใช้บัญชีวันที่ 26 พ.ย. 2026: main และ commit d928e9c ตอบ HTTP 200 เป็น development checkpoint ที่เผยแพร่แล้ว รวม Missions, Parallel Workspace, Visualization และ Proactive/budget งานที่กลับมาทำต่อวันที่ 26 พ.ย. ยังไม่รวมใน checkpoint นี้','Anonymous GitHub API check, 26 Nov 2026: main and commit d928e9c return HTTP 200. This published development checkpoint includes Missions, Parallel Workspace, Visualization and Proactive/budget. Resumed work from 26 Nov is not included in that checkpoint.')}</p><p>{t('ข้อมูลนี้เป็นผลตรวจที่บันทึกไว้ ไม่ใช่การตรวจสด และยังไม่มี public release หรือแพ็กเกจดาวน์โหลดในข้อมูลที่บันทึก','This is a recorded check, not a live lookup. There is still no public release or downloadable package in the recorded metadata.')}</p><Action to={publicCheckpoint}>Open published checkpoint</Action>
  </section></>;
}
function Footer({lang,t}:{lang:Lang;t:T}) {
  return <footer className="site-footer wrap"><div className="footer-top"><a className="brand" href={href(lang)}><Mark/><span>FORGE</span></a><p>{t('พื้นที่ทำงานของคุณ ตั้งแต่ไอเดียถึงหลักฐาน','Your workspace. From idea to evidence.')}</p><div><a href={href(lang,'docs')}>Docs</a><a href={href(lang,'install')}>Install</a><a href={href(lang,'changelog')}>Changelog</a><a href={href(lang,'github')}>GitHub<ArrowUpRight size={14}/></a></div></div><div className="footer-bottom"><span>FORGE · {t('กำลังพัฒนา','In development')}</span><span>{t('เว็บสาธารณะแยกจากข้อมูลและ runtime ส่วนตัว','Public website · Independent of your private runtime')}</span><a href={href(lang,'download')}>Release status<ArrowUpRight size={14}/></a></div></footer>;
}
export function App({lang,page}:{lang:Lang;page:Page}) {
  const t:T=(th,en)=>lang==='th'?th:en;
  useEffect(()=>{document.documentElement.lang=lang;document.title=`FORGE — ${titles[page]}`},[lang,page]);
  return <><a className="skip-link" href="#main">{t('ข้ามไปเนื้อหา','Skip to content')}</a><Header lang={lang} page={page} t={t}/><main id="main" tabIndex={-1} className={page==='home'?'':'wrap inner-page'}>{page==='home'?<Home lang={lang} t={t}/>:page==='docs'?<Docs lang={lang} t={t}/>:page==='install'?<Install lang={lang} t={t}/>:page==='download'?<DownloadPage lang={lang} t={t}/>:page==='changelog'?<Changelog lang={lang} t={t}/>:page==='github'?<Github t={t}/>:<div className="page-heading"><h1>Page not found.</h1><p>{t('ลิงก์นี้ไม่มีในเว็บ FORGE กลับไปหน้าหลักเพื่อดู product คู่มือ และสถานะ release','This page is not part of the FORGE website. Return home for the product, documentation and release status.')}</p><Action to={href(lang)}>{t('กลับหน้าหลัก','Back to FORGE')}</Action></div>}</main><Footer lang={lang} t={t}/></>;
}
