import React, { useEffect, useState } from "react";
import {
  ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Command,
  Download, FileCheck2, FileText, GitBranch, Github, Layers3,
  LoaderCircle, Monitor, RotateCw, Sheet, SlidersHorizontal, Users,
} from "lucide-react";
import "./landing.css";

const SOURCE_URL = "https://github.com/siriponsri/forge-agents";
const PLATFORMS = [
  { id: "windows", label: "Windows", filename: "FORGE-Windows.zip", Icon: Monitor },
  { id: "macos", label: "macOS", filename: "FORGE-macOS.zip", Icon: Command },
];

// Downloads are available only after the local server supplies complete metadata.
// The landing page cannot redirect a launcher download to a remote executable.
function readRelease(value) {
  if (!value || value.status !== "alpha" || typeof value.version !== "string" ||
      !value.version.trim() || typeof value.commit !== "string" ||
      !value.commit.trim() || !Array.isArray(value.platforms)) throw new Error("metadata");
  const seen = new Set();
  const platforms = value.platforms.map((entry) => {
    const platform = PLATFORMS.find((item) => item.id === entry?.id);
    if (!platform || seen.has(entry.id)) throw new Error("platform");
    seen.add(entry.id);
    const url = new URL(entry.url, window.location.origin);
    if (url.origin !== window.location.origin ||
        url.pathname !== `/downloads/${platform.filename}` || url.search || url.hash ||
        entry.filename !== platform.filename || !/^[a-f\d]{64}$/i.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
        !["developer-verified", "not-run"].includes(entry.qualification) ||
        !Array.isArray(entry.requirements) ||
        !entry.requirements.every((item) => typeof item === "string")) throw new Error("package");
    return { ...entry, url: url.pathname };
  });
  return { ...value, platforms };
}

function useRelease() {
  const [attempt, setAttempt] = useState(0);
  const [release, setRelease] = useState({ status: "loading", data: null });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRelease({ status: "loading", data: null });
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    fetch("/api/downloads", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json();
      })
      .then(readRelease)
      .then((data) => { if (active) setRelease({ status: "ready", data }); })
      .catch(() => { if (active) setRelease({ status: "error", data: null }); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return [release, () => setAttempt((n) => n + 1)];
}

function ForgeMark({ large = false }) {
  return (
    <svg className={`landing-mark${large ? " landing-mark-large" : ""}`} viewBox="0 0 32 36" fill="none" aria-hidden="true">
      <path d="M7 3H31L27 11H13L10 17H24L20 25H6L2 33H-2L7 3Z" fill="currentColor" />
    </svg>
  );
}

function DownloadLink({ platform, release, t, secondary = false }) {
  const item = release.data?.platforms.find((entry) => entry.id === platform.id);
  const className = `landing-button ${secondary ? "landing-button-secondary" : "landing-button-primary"}`;
  const { Icon } = platform;
  const label = t(`ดาวน์โหลดสำหรับ ${platform.label}`, `Download for ${platform.label}`);
  if (!item) {
    return (
      <button className={className} type="button" disabled aria-label={`${label} — ${release.status === "loading" ? t("กำลังตรวจสอบ", "Checking availability") : t("ยังไม่พร้อมดาวน์โหลด", "Download unavailable")}`}>
        {release.status === "loading" ? <LoaderCircle aria-hidden="true" className="landing-spinner" size={18} /> : <Icon aria-hidden="true" size={18} />}
        <span>{label}</span>
        <Download aria-hidden="true" size={16} />
      </button>
    );
  }
  return (
    <a className={className} href={item.url} download={item.filename}>
      <Icon aria-hidden="true" size={18} /><span>{label}</span><Download aria-hidden="true" size={16} />
    </a>
  );
}

function ProductPreview({ t }) {
  const [missing, setMissing] = useState(false);
  return (
    <figure className="landing-preview" id="workbench">
      <div className="landing-preview-image">
        {!missing ? (
          <img src="/forge-workbench-preview.png" width="1600" height="1000" fetchPriority="high"
            alt={t("ภาพหน้าจอ FORGE Workbench แสดงแผนงานและพื้นที่ทำงานของโปรเจกต์ในธีมกราไฟต์", "FORGE Workbench screenshot showing a project plan and workspace in the graphite theme")}
            onError={() => setMissing(true)} />
        ) : (
          <div className="landing-preview-unavailable">
            <Layers3 aria-hidden="true" size={32} />
            <p>{t("ยังไม่มีภาพหน้าจอจากแอปจริงในแพ็กเกจนี้", "The actual workbench screenshot is not included in this package yet.")}</p>
            <a href="/app">{t("เปิดดู Workbench", "Open the workbench")}<ArrowUpRight aria-hidden="true" size={16} /></a>
          </div>
        )}
      </div>
      <figcaption>
        <span><span className="landing-status-dot" />FORGE Workbench</span>
        <span>{t("หน้าจอจริง · ข้อมูลสำหรับตรวจการทำงาน", "Actual app · engineering fixture data")}</span>
      </figcaption>
    </figure>
  );
}

function Workflow({ t }) {
  const steps = [
    { Icon: Layers3, name: t("วางแผน", "Plan"), text: t("แยกโจทย์เป็นงานที่ติดตามได้", "Turn a goal into trackable tasks.") },
    { Icon: Users, name: t("จัดทีม AI", "Bring your team"), text: t("กำหนดบทบาทและบริบทของงาน", "Give each agent a role and context.") },
    { Icon: FileText, name: t("ลงมือทำ", "Make it tangible"), text: t("ทำงานกับโค้ด เอกสาร และตาราง", "Work with code, documents and sheets.") },
    { Icon: FileCheck2, name: t("ตรวจชิ้นงาน", "Review the output"), text: t("เปิดดูไฟล์และหลักฐานของผลลัพธ์", "Inspect artifacts and their evidence.") },
  ];
  return (
    <ol className="landing-flow">
      {steps.map(({ Icon, name, text }, index) => (
        <li key={name}>
          <div className="landing-flow-top"><Icon aria-hidden="true" size={24} /><span>0{index + 1}</span></div>
          <h3>{name}</h3><p>{text}</p>
          {index < steps.length - 1 && <ArrowRight className="landing-flow-arrow" size={20} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function PlatformCard({ platform, release, t }) {
  const item = release.data?.platforms.find((entry) => entry.id === platform.id);
  const { Icon } = platform;
  const verified = item?.qualification === "developer-verified";
  const readyText = item
    ? verified ? t("ตรวจโดยผู้พัฒนาแล้ว", "Developer verified") : t("ยังไม่ทดสอบบนแพลตฟอร์มจริง", "Live platform test not run")
    : release.status === "loading" ? t("กำลังตรวจสอบแพ็กเกจ", "Checking package") : t("ยังไม่มีแพ็กเกจพร้อมดาวน์โหลด", "No package available");
  return (
    <article className="landing-platform">
      <div className="landing-platform-heading"><Icon aria-hidden="true" size={26} /><h3>{platform.label}</h3><span>Alpha</span></div>
      <p className={`landing-qualification${verified ? " is-verified" : ""}`}>
        {verified ? <Check aria-hidden="true" size={15} /> : <span className="landing-qualification-dot" />}{readyText}
      </p>
      <p className="landing-platform-description">{platform.id === "windows"
        ? t("ซอร์สพร้อมตัวเปิดใช้งานสำหรับ Windows เปิด FORGE ผ่าน localhost ในเบราว์เซอร์ของคุณ", "Source and launcher for Windows. Open FORGE on localhost in your browser.")
        : t("ซอร์สพร้อมตัวเปิดใช้งานสำหรับ macOS ยังไม่ผ่านการทดสอบบน Mac และยังไม่รับรอง report engine แบบ native", "Source and launcher for macOS. Mac testing is pending; native report engines are not qualified.")}</p>
      <DownloadLink platform={platform} release={release} t={t} secondary={platform.id === "macos"} />
      <div className="landing-package-details">
        <p><span>ZIP + launcher</span>{item && <span>{new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(item.bytes / 1024 / 1024)} MiB</span>}</p>
        {item && <>
          <p className="landing-package-filename">{item.filename}</p>
          <details>
            <summary>SHA-256<ChevronDown aria-hidden="true" size={14} /></summary>
            <code>{item.sha256}</code>
          </details>
          {item.requirements.length > 0 && <div className="landing-requirements">
            <h4>{t("สิ่งที่ต้องเตรียม", "Requirements")}</h4>
            <ul>{item.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul>
          </div>}
        </>}
      </div>
    </article>
  );
}

export default function Landing() {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("forge.landing.language") === "en" ? "en" : "th"; }
    catch { return "th"; }
  });
  const t = (th, en) => lang === "th" ? th : en;
  const [release, retry] = useRelease();
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "th" ? "FORGE — พื้นที่ทำงานของคุณและทีม AI" : "FORGE — Your AI team. Your work, connected.";
    try { localStorage.setItem("forge.landing.language", lang); } catch { /* Storage is optional. */ }
  }, [lang]);

  return (
    <div className="landing" lang={lang}>
      <a className="landing-skip" href="#landing-main">{t("ข้ามไปเนื้อหา", "Skip to content")}</a>
      <header className="landing-header">
        <div className="landing-nav landing-container">
          <a className="landing-brand" href="#" aria-label="FORGE"><ForgeMark /><span>FORGE</span></a>
          <nav className="landing-nav-links" aria-label={t("เมนูหลัก", "Main navigation")}>
            <a href="#workbench">{t("รู้จัก FORGE", "Workbench")}</a>
            <a href="#workflow">{t("วิธีทำงาน", "Workflow")}</a>
            <a href="#download">{t("ดาวน์โหลด", "Downloads")}</a>
          </nav>
          <div className="landing-nav-actions">
            <div className="landing-language" role="group" aria-label="Language / ภาษา">
              <button type="button" lang="th" aria-label="ภาษาไทย" aria-pressed={lang === "th"} onClick={() => setLang("th")}>TH</button>
              <button type="button" lang="en" aria-label="English" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
            <a className="landing-nav-open" href="/app"><span>{t("เปิด Workbench", "Open workbench")}</span><ArrowUpRight aria-hidden="true" size={17} /></a>
          </div>
        </div>
      </header>

      <main id="landing-main">
        <section className="landing-hero landing-container" aria-labelledby="landing-title">
          <a className="landing-alpha-link" href="#release-status"><span className="landing-status-dot" />Alpha{t(" · กำลังพัฒนาอย่างต่อเนื่อง", " · A workbench in the making")}<ArrowRight aria-hidden="true" size={14} /></a>
          <h1 id="landing-title">{t("พื้นที่ทำงาน", "Your AI team.")}<br /><span>{t("ของคุณและทีม AI", "Your work, connected.")}</span></h1>
          <p className="landing-hero-description">{t("วางแผน ทำงานกับ AI เขียนโค้ด และจัดการเอกสาร", "Plan with agents. Work with code, documents and reports.")}<br className="landing-desktop-break" />{t("ใน FORGE Workbench ที่เปิดบนเครื่องของคุณ", "Bring the work together in FORGE, on your own machine.")}</p>
          <div className="landing-hero-downloads">
            {PLATFORMS.map((platform, index) => <DownloadLink key={platform.id} platform={platform} release={release} t={t} secondary={index === 1} />)}
          </div>
          <p className="landing-hero-note" role="status" aria-live="polite">
            {release.status === "loading" ? t("กำลังตรวจสอบไฟล์ดาวน์โหลด…", "Checking download availability…")
              : release.status === "error" ? <>{t("ยังโหลดข้อมูลดาวน์โหลดไม่ได้", "Download metadata is unavailable")} <a href="#download">{t("ดูสถานะและลองอีกครั้ง", "View status and retry")}</a></>
                : <>ZIP + launcher <span>·</span> Node.js 24.13+ <span>·</span> {t("รุ่นทดลอง Alpha", "Alpha release")}</>}
          </p>
          <div className="landing-hero-links">
            <a href="/app">{t("เปิด Workbench", "Open workbench")}<ArrowUpRight aria-hidden="true" size={15} /></a>
            <a href={SOURCE_URL}><Github aria-hidden="true" size={16} />{t("ดูซอร์สโค้ด", "View source")}<ArrowUpRight aria-hidden="true" size={15} /></a>
          </div>
          <ProductPreview t={t} />
        </section>

        <div className="landing-capabilities landing-container" aria-label={t("พื้นที่ใน FORGE", "FORGE workspaces")}>
          <span><Layers3 aria-hidden="true" size={17} />Plan & tasks</span>
          <span><GitBranch aria-hidden="true" size={17} />AI & code</span>
          <span><Sheet aria-hidden="true" size={17} />Docs & sheets</span>
          <span><FileText aria-hidden="true" size={17} />Reports</span>
        </div>

        <section className="landing-workflow landing-section landing-container" id="workflow" aria-labelledby="workflow-title">
          <div className="landing-section-heading">
            <h2 id="workflow-title">{t("จากโจทย์ที่คิดไว้", "From a plan")}<br />{t("สู่ชิ้นงานที่เปิดดูได้", "to something you can open.")}</h2>
            <p>{t("จัดระเบียบแผน ทีม และผลลัพธ์ในบริบทเดียวกัน ใช้ GUI ติดตามงาน พร้อมกลับมาตรวจรายละเอียดได้เมื่อคุณต้องการ", "Keep plans, agents and outputs in the same project context. Follow the work through the GUI and inspect the details when you need them.")}</p>
          </div>
          <Workflow t={t} />
          <p className="landing-section-footnote">{t("เส้นทางการทำงานของ FORGE · ความพร้อมของแต่ละส่วนแสดงใน Workbench", "The FORGE workflow · Individual capabilities show their readiness in the workbench.")}</p>
        </section>

        <section className="landing-tools landing-container" aria-label={t("เอกสารและรายงาน", "Documents and reports")}>
          <article className="landing-editor-feature">
            <div className="landing-tool-symbols" aria-hidden="true"><Sheet aria-hidden="true" size={30} /><span>+</span><FileText aria-hidden="true" size={30} /></div>
            <h2>{t("เอกสาร ตาราง", "Documents. Sheets.")}<br />{t("และบริบทของงาน", "And the context behind them.")}</h2>
            <p>{t("เปิด Univer Docs และ Sheets ในพื้นที่ทำงานเดียว บันทึกฉบับแก้ไขและกลับมาทำงานต่อในโปรเจกต์เดิม", "Open Univer Docs and Sheets in the workbench. Save revisions and return to your documents in their original project.")}</p>
            <div className="landing-tool-footer"><span>Univer Docs & Sheets</span><span>{t("บันทึกเป็น native snapshot", "Native snapshot saves")}</span></div>
          </article>
          <article className="landing-report-feature">
            <div className="landing-report-art" aria-hidden="true">
              <svg viewBox="0 0 210 140" fill="none">
                <path className="landing-art-paper-back" d="M66 9H148L168 29V120H66V9Z" />
                <path className="landing-art-paper" d="M44 24H123L145 46V134H44V24Z" />
                <path className="landing-art-fold" d="M123 24V46H145" />
                <path className="landing-art-line" d="M62 64H125M62 76H111M62 88H125M62 100H98" />
                <path className="landing-art-check" d="M111 113L120 122L138 102" />
              </svg>
            </div>
            <h2>{t("รายงานที่ย้อนดู", "Reports with")}<br />{t("ต้นทางได้", "a source to return to.")}</h2>
            <p>{t("เก็บต้นฉบับรายงานแยกจากไฟล์ส่งออก ตรวจความพร้อมของ engine ก่อนสร้าง DOCX หรือ PDF และเปิดดูผลลัพธ์จากโปรเจกต์", "Keep report sources separate from exports. Check engine readiness before generating DOCX or PDF, then inspect the project artifacts.")}</p>
            <div className="landing-tool-footer"><span>Report Studio</span><span>{t("ขึ้นกับ engine และฟอนต์ที่ติดตั้ง", "Requires qualified engines & fonts")}</span></div>
          </article>
        </section>

        <section className="landing-local landing-section landing-container" aria-labelledby="local-title">
          <div className="landing-local-intro"><ForgeMark large /><h2 id="local-title">{t("เครื่องของคุณ", "Your machine.")}<br />{t("พื้นที่ทำงานของคุณ", "Your workbench.")}</h2></div>
          <div className="landing-local-points">
            <div><Monitor aria-hidden="true" size={20} /><div><h3>{t("เปิดผ่าน localhost", "Open on localhost")}</h3><p>{t("FORGE ทำงานเป็นบริการในเครื่อง แล้วเปิด GUI ในเบราว์เซอร์", "FORGE runs as a local service with a browser-based GUI.")}</p></div></div>
            <div><SlidersHorizontal aria-hidden="true" size={20} /><div><h3>{t("เชื่อมต่อเมื่อพร้อม", "Connect when you are ready")}</h3><p>{t("ตั้งค่า provider และเครื่องมือของคุณตามความพร้อม บริการภายนอกยังต้องใช้บัญชีและสิทธิ์ของคุณ", "Configure your providers and tools as available. External services still need your accounts and permissions.")}</p></div></div>
            <div><GitBranch aria-hidden="true" size={20} /><div><h3>{t("เปิดดูซอร์สได้", "Inspect the source")}</h3><p>{t("ตรวจโค้ดและขอบเขตของรุ่น Alpha ได้ใน repository ของ FORGE", "Review FORGE’s code and the scope of this alpha in the repository.")}</p></div></div>
          </div>
        </section>

        <section className="landing-download-section" id="download" aria-labelledby="download-title">
          <div className="landing-container">
            <div className="landing-download-heading"><div><h2 id="download-title">{t("เริ่มต้นกับ FORGE", "Make room for your next idea.")}</h2><p>{t("เลือกแพ็กเกจให้ตรงกับเครื่องของคุณ", "Choose the package for your machine.")}</p></div><ArrowDown size={32} aria-hidden="true" /></div>
            <div className="landing-release-state" role="status" aria-live="polite" aria-atomic="true">
              {release.status === "loading" && <><LoaderCircle aria-hidden="true" className="landing-spinner" size={16} />{t("กำลังตรวจสอบรุ่นและไฟล์ดาวน์โหลด…", "Checking release and download files…")}</>}
              {release.status === "error" && <><span>{t("ยังโหลดข้อมูลดาวน์โหลดไม่ได้ ลองอีกครั้ง หรือเปิด Workbench ที่มีอยู่แล้ว", "Download metadata could not be loaded. Retry, or open your existing workbench.")}</span><button className="landing-retry" type="button" onClick={retry}><RotateCw aria-hidden="true" size={15} />{t("ลองอีกครั้ง", "Retry")}</button></>}
              {release.status === "ready" && <><span className="landing-status-dot" />{release.data.version}<span className="landing-release-divider">/</span><span>Alpha</span><span className="landing-release-divider">/</span><span className="landing-release-commit" title={release.data.commit}>{release.data.commit.slice(0, 12)}</span></>}
            </div>
            <div className="landing-platforms">{PLATFORMS.map((platform) => <PlatformCard key={platform.id} platform={platform} release={release} t={t} />)}</div>
            <div className="landing-install">
              <h3>{t("จาก ZIP ถึง Workbench", "From ZIP to workbench")}</h3>
              <ol>
                <li><span>1</span><div><h4>{t("เตรียม Node.js", "Prepare Node.js")}</h4><p>{t("ใช้ Node.js 24.13 ขึ้นไป และดูข้อกำหนดของแพ็กเกจ", "Use Node.js 24.13 or later and check package requirements.")}</p></div></li>
                <li><span>2</span><div><h4>{t("แตกไฟล์และเปิด launcher", "Extract and launch")}</h4><p>{t("แตก ZIP ไปยังโฟลเดอร์ที่เขียนได้ แล้วใช้ launcher ตามคู่มือในแพ็กเกจ", "Extract the ZIP to a writable folder and follow the included launcher guide.")}</p></div></li>
                <li><span>3</span><div><h4>{t("เปิดพื้นที่ทำงาน", "Open your workbench")}</h4><p>{t("เปิด localhost ที่ launcher แสดง แล้วตั้งค่าโปรเจกต์และการเชื่อมต่อ", "Open the localhost address shown by the launcher, then configure your project and connections.")}</p></div></li>
              </ol>
              <p className="landing-install-note">{t("แพ็กเกจนี้เป็นซอร์สพร้อม launcher ไม่ใช่ signed installer การติดตั้งครั้งแรกอาจต้องใช้อินเทอร์เน็ตเพื่อดาวน์โหลด dependencies", "These packages contain source and launchers, rather than signed installers. First setup may need internet access to download dependencies.")}</p>
            </div>
            <aside className="landing-alpha-notice" id="release-status" aria-labelledby="release-status-title">
              <div><span className="landing-status-dot" /><h3 id="release-status-title">{t("Alpha ที่บอกสถานะตามจริง", "An alpha, with its status in the open.")}</h3></div>
              <p>{t("FORGE ยังพัฒนาไม่ครบทุกความสามารถ การตรวจของผู้พัฒนาแยกจากการทดสอบใช้งานที่บ้าน ซึ่งยังไม่ได้รัน การเชื่อมต่อบริการจริงต้องตั้งค่าบัญชีและสิทธิ์เพิ่มเติม", "FORGE is still under development. Developer checks are separate from home acceptance testing, which has not run. Live service connections require your accounts and permissions.")}</p>
              <div className="landing-status-labels"><span>IMPLEMENTATION_INCOMPLETE</span><span>HOME_UAT_NOT_RUN</span></div>
            </aside>
          </div>
        </section>
      </main>

      <footer className="landing-footer landing-container">
        <a className="landing-brand" href="#"><ForgeMark /><span>FORGE</span></a>
        <p>{t("พื้นที่ให้ไอเดียกลายเป็นงาน", "A place to turn ideas into work.")}</p>
        <div><a href={SOURCE_URL}><Github aria-hidden="true" size={16} />{t("ซอร์สโค้ด", "Source")}<ArrowUpRight aria-hidden="true" size={14} /></a><a href="/app">Workbench<ArrowUpRight aria-hidden="true" size={14} /></a></div>
      </footer>
    </div>
  );
}
