import React, { useEffect, useState } from "react";
import {
  ArrowUpRight, Check, ChevronDown, Command, Download, Github,
  LoaderCircle, Monitor, RotateCw,
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

const mebibytes = (bytes) =>
  `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MiB`;

// Thai has no spaces between words and browsers break display lines mid-word.
// Display copy keeps each space-separated phrase whole.
const keep = (text) => text.split(" ").map((phrase, index) => (
  <React.Fragment key={index}>{index > 0 && " "}<span className="landing-keep">{phrase}</span></React.Fragment>
));

function ForgeMark() {
  return (
    <svg className="landing-mark" viewBox="0 0 32 36" fill="none" aria-hidden="true">
      <path d="M7 3H31L27 11H13L10 17H24L20 25H6L2 33H-2L7 3Z" fill="currentColor" />
    </svg>
  );
}

// Steel magnets hold the printouts; the single orange one marks the page's focal action.
function Magnet({ className = "", accent = false }) {
  return <span className={`landing-magnet${accent ? " is-accent" : ""} ${className}`} aria-hidden="true" />;
}

function DownloadLink({ platform, release, t, tone = "primary" }) {
  const item = release.data?.platforms.find((entry) => entry.id === platform.id);
  const className = `landing-button landing-button-${tone}`;
  const { Icon } = platform;
  const label = t(`ดาวน์โหลดสำหรับ ${platform.label}`, `Download for ${platform.label}`);
  if (!item) {
    return (
      <button className={className} type="button" disabled aria-label={`${label} — ${release.status === "loading" ? t("กำลังตรวจสอบไฟล์", "Checking availability") : t("ยังดาวน์โหลดไม่ได้", "Download unavailable")}`}>
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

function qualificationText(item, release, t) {
  if (item) return item.qualification === "developer-verified"
    ? t("ผู้พัฒนาทดสอบแล้ว", "Developer verified")
    : t("ยังไม่ได้ทดสอบบนเครื่องจริง", "Live platform test not run");
  return release.status === "loading" ? t("กำลังตรวจสอบ…", "Checking…") : t("ยังไม่มีไฟล์", "No package");
}

// The hero's work order: the real Windows package, printed as its own fields.
function HeroTicket({ release, retry, t }) {
  const windows = release.data?.platforms.find((entry) => entry.id === "windows");
  const pending = release.status === "loading" ? t("กำลังตรวจสอบ…", "Checking…") : "—";
  return (
    <div className="landing-ticket landing-hero-ticket">
      <Magnet className="landing-ticket-magnet" accent />
      <h2 className="landing-ticket-title">{keep(t("ลองใช้บน Windows", "Try it on Windows"))}</h2>
      <dl className="landing-ticket-fields">
        <div><dt>{t("รุ่น", "Release")}</dt><dd>{release.data ? `${release.data.version} · Alpha` : pending}</dd></div>
        <div><dt>{t("ไฟล์", "File")}</dt><dd>{windows ? `${windows.filename} · ${mebibytes(windows.bytes)}` : pending}</dd></div>
        <div><dt>{t("สถานะ", "Status")}</dt><dd className={windows?.qualification === "developer-verified" ? "is-verified" : ""}>{windows?.qualification === "developer-verified" && <Check aria-hidden="true" size={14} />}{qualificationText(windows, release, t)}</dd></div>
        <div><dt>{t("ต้องมี", "Needs")}</dt><dd>Node.js 24.13+</dd></div>
      </dl>
      <div className="landing-ticket-actions">
        <DownloadLink platform={PLATFORMS[0]} release={release} t={t} />
        <DownloadLink platform={PLATFORMS[1]} release={release} t={t} tone="quiet" />
      </div>
      <p className="landing-hero-note" role="status" aria-live="polite">
        {release.status === "loading" && t("กำลังตรวจสอบไฟล์ดาวน์โหลด…", "Checking the download files…")}
        {release.status === "error" && <>
          <span>{t("โหลดข้อมูลไฟล์ดาวน์โหลดไม่สำเร็จ ลองโหลดอีกครั้ง", "Download details didn’t load. Try loading them again.")}</span>
          <button className="landing-retry" type="button" onClick={retry}><RotateCw aria-hidden="true" size={14} />{t("โหลดอีกครั้ง", "Load again")}</button>
        </>}
        {release.status === "ready" && t("ไฟล์ ZIP พร้อมตัวเปิดโปรแกรม ยังไม่ใช่ตัวติดตั้งที่มีลายเซ็นรับรอง", "A ZIP with a launcher, not a signed installer.")}
      </p>
    </div>
  );
}

function Printout({ src, width, height, alt, caption, className = "", priority = false, onMissing }) {
  return (
    <figure className={`landing-printout ${className}`}>
      <Magnet className="landing-magnet-left" />
      <Magnet className="landing-magnet-right" />
      <img src={src} width={width} height={height} alt={alt} loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"} decoding="async" onError={onMissing} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function HeroPreview({ t }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="landing-preview landing-preview-missing">
        <p>{t("ไม่มีภาพหน้าจอในแพ็กเกจนี้ เปิด Workbench เพื่อดูของจริง", "The screenshot is missing from this package. Open the workbench to see the real thing.")}</p>
        <a href="/app">{t("เปิด Workbench", "Open workbench")}<ArrowUpRight aria-hidden="true" size={16} /></a>
      </div>
    );
  }
  return (
    <Printout className="landing-preview" priority src="/landing/overview.webp" width="2880" height="1800"
      alt={t("หน้าภาพรวมโปรเจกต์ใน FORGE แสดงงานที่กำลังทำ งานล่าสุด และทางลัดไปยังแผนงาน เอกสาร รายงาน และสมุดโค้ด Python",
        "FORGE project overview showing the task in progress, recent tasks and shortcuts to plans, documents, reports and Python notebooks")}
      caption={t("หน้าจอจริงจาก FORGE · โปรเจกต์ร้านกาแฟเป็นข้อมูลตัวอย่าง", "Real FORGE screen · the café project is sample data")}
      onMissing={() => setMissing(true)} />
  );
}

const STATUS = {
  ready: { th: "ใช้ได้ในรุ่นนี้", en: "Works in this alpha", lamp: "is-green" },
  setup: { th: "ต้องตั้งค่าเพิ่ม", en: "Needs setup", lamp: "is-amber" },
  building: { th: "กำลังพัฒนา", en: "In development", lamp: "is-off" },
};

function Status({ kind, note, t }) {
  const status = STATUS[kind];
  return (
    <p className="landing-status">
      <span className={`landing-lamp ${status.lamp}`} aria-hidden="true" />
      <strong>{t(status.th, status.en)}</strong>
      {note && <span>{note}</span>}
    </p>
  );
}

function Lane({ id, step, title, lead, children, status, media, className = "" }) {
  return (
    <article className={`landing-lane ${media ? "" : "landing-lane-compact"} ${className}`} aria-labelledby={id}>
      <h3 className="landing-tape" id={id}><span className="landing-tape-step">{step}</span>{keep(title)}</h3>
      <div className="landing-lane-copy">
        <p className="landing-lane-lead">{keep(lead)}</p>
        {children}
        {status}
      </div>
      {media}
    </article>
  );
}

function Path({ t }) {
  return (
    <section className="landing-stations" id="path" aria-labelledby="path-title">
      <div className="landing-container">
        <header className="landing-stations-head">
          <h2 id="path-title">{keep(t("จากโจทย์ ถึงโมเดลที่เปิดใช้งาน", "From a prompt to a running model"))}</h2>
          <p>{t("ตามดูโปรเจกต์ตัวอย่าง “ร้านกาแฟ” ที่อยากทำนายยอดขายรายวัน ทุกภาพเป็นหน้าจอจริงจาก FORGE รุ่น Alpha และแต่ละขั้นบอกสถานะตามจริงของรุ่นนี้",
            "Follow a sample café project that wants to predict daily sales. Every picture is a real FORGE alpha screen, and each step shows its honest status in this release.")}</p>
          <ul className="landing-legend" aria-label={t("ความหมายของสถานะ", "Status key")}>
            {Object.entries(STATUS).map(([key, status]) => <li key={key}><span className={`landing-lamp ${status.lamp}`} aria-hidden="true" />{t(status.th, status.en)}</li>)}
          </ul>
        </header>

        <Lane id="step-talk" step="1" title={t("คุยโจทย์", "Talk it through")}
          lead={t("เล่าสิ่งที่อยากได้ในแชต", "Describe what you want in a chat.")}
          status={<Status kind="setup" t={t} note={t("ผู้ช่วย AI ตอบได้เมื่อเชื่อมต่อบริการ AI ด้วยบัญชีของคุณ", "The AI assistant replies once you connect an AI service with your account.")} />}
          media={<Printout src="/landing/chat.webp" width="2304" height="1520"
            alt={t("แชตชื่อ “คุยโจทย์โมเดลยอดขาย” มีข้อความถามเรื่องโมเดลทำนายยอดขายกาแฟจากอุณหภูมิ และข้อมูลยอดขายย้อนหลังเป็นไฟล์ CSV", "Chat “sales model brief” with messages asking for a model that predicts coffee sales from temperature, using three months of CSV sales history")}
            caption={t("แชตในโปรเจกต์ · ตัวอย่างนี้ยังไม่ได้เชื่อมต่อบริการ AI จึงยังไม่มีคำตอบ", "Project chat · no AI service is connected in this sample, so there is no reply yet")} />}>
          <p>{t("ผู้ช่วย AI ถามรายละเอียดที่ยังขาด เช่น อยากทำนายอะไร มีชุดข้อมูลแบบไหน และอยากวัดผลอย่างไร",
            "The AI assistant asks about what’s missing: what to predict, which dataset you have and how you want to measure results.")}</p>
        </Lane>

        <Lane id="step-plan" step="2" title={t("อนุมัติแผน", "Approve the plan")}
          lead={t("อ่านแผนงานก่อน แล้วค่อยอนุมัติ", "Read the plan, then approve it.")}
          status={<Status kind="ready" t={t} />}
          media={<Printout src="/landing/kanban.webp" width="2304" height="1368"
            alt={t("แผนงาน “เปิดร้านภายใน 6 สัปดาห์” แบบ Kanban มีช่องอนุมัติแผนก่อนเริ่มงาน และงานย่อยในช่องรอทำ พร้อมทำ กำลังทำ และตรวจงาน", "Kanban plan “open within six weeks” with the approve-before-starting checkbox and tasks in backlog, ready, running and review")}
            caption={t("แผนงาน · มุมมอง Kanban", "Plan · Kanban view")} />}>
          <p>{t("แผนงานแบ่งเป็นช่วงงานและงานย่อย แต่ละงานมีผู้รับผิดชอบ ทั้งคุณและทีมผู้ช่วย AI งานย่อยต้องมีหลักฐานก่อนปิดงาน",
            "The plan splits into phases and tasks. Each task has an owner, you or someone on your AI team, and needs evidence before it closes.")}</p>
        </Lane>

        <Lane id="step-train" step="3" title={t("เทรนโมเดล", "Train")}
          lead={t("เทรนหรือปรับจูน บนเครื่องที่คุณเลือก", "Train or fine-tune on the machine you choose.")}
          status={<Status kind="setup" t={t} note={t("ตอนนี้ใช้สมุดโค้ด Python ส่วนการเทรนแบบไม่ต้องเขียนโค้ดกำลังพัฒนา", "Today this runs as a Python notebook. No-code training is in development.")} />}
          media={<Printout src="/landing/notebook.webp" width="2304" height="1520"
            alt={t("สมุดโค้ด Python ชื่อ “เทรนโมเดลทำนายยอดขาย” หาความสัมพันธ์ระหว่างอุณหภูมิกับจำนวนแก้วที่ขายได้", "Python notebook “train a sales model” fitting cups sold against temperature")}
            caption={t("สมุดโค้ด Python · ชุดข้อมูลตัวอย่าง 5 วัน", "Python notebook · five-day sample dataset")} />}>
          <p>{t("รันบนเครื่องของคุณ หรือบนเครื่องประมวลผลที่เชื่อมต่อไว้ ถ้าอยากเขียนโค้ดเอง เปิดพื้นที่เขียนโค้ด T3 จากโปรเจกต์เดียวกันได้",
            "Run on your own computer or a compute target you’ve connected. If you want to write code yourself, open the T3 coding workspace from the same project.")}</p>
        </Lane>

        <Lane id="step-evaluate" step="4" title={t("วัดผล", "Evaluate")}
          lead={t("วัดผลก่อนตัดสินใจใช้งาน", "Measure before you rely on it.")}
          status={<Status kind="building" t={t} note={t("ระหว่างนี้วัดผลในสมุดโค้ด Python และเก็บผลเป็นไฟล์ผลลัพธ์ของโปรเจกต์", "Meanwhile, measure in a Python notebook and keep the results as project files.")} />}>
          <p>{t("หน้าวัดผลโมเดลแบบไม่ต้องเขียนโค้ดยังไม่พร้อมในรุ่นนี้", "A no-code model evaluation screen isn’t ready in this release.")}</p>
        </Lane>

        <Lane id="step-deploy" step="5" title={t("เปิดใช้งานโมเดล", "Deploy")}
          lead={t("เปิดใช้งานโมเดลบนเครื่องของคุณ", "Run the model on your own machine.")}
          status={<Status kind="setup" t={t} note={t("ต้องมีไฟล์โมเดลในโปรเจกต์ก่อน", "Needs a model file in the project first.")} />}
          media={<Printout src="/landing/serving.webp" width="2304" height="1360"
            alt={t("หน้าโมเดลและการทำนาย ตั้งค่าเปิดใช้งานด้วย LitServe บนเครื่อง และช่องลองทำนายผ่าน REST", "Models and predictions screen with LitServe on this computer and a REST prediction test panel")}
            caption={t("หน้าเปิดใช้งานโมเดล · ตัวอย่างนี้ยังไม่ได้เลือกไฟล์โมเดล", "Model deployment · no model file chosen in this sample")} />}>
          <p>{t("เลือกไฟล์โมเดล แล้วเปิดใช้งานด้วย LitServe บนเครื่อง ลองส่งข้อมูลเพื่อดูการทำนาย ผลทุกครั้งเก็บไว้ในโปรเจกต์",
            "Pick a model file and start it with LitServe on your computer. Send sample input to see a prediction; every result stays in the project.")}</p>
        </Lane>

        <Lane id="step-docs" step="+" title={t("เอกสารและรายงาน", "Docs & reports")} className="landing-lane-aside"
          lead={t("เขียนสรุปผล ในโปรเจกต์เดียวกัน", "Write up the results in the same project.")}
          status={<Status kind="ready" t={t} note={t("การส่งออก DOCX และ PDF ต้องติดตั้ง WordCraft และ PdfCraft ก่อน", "DOCX and PDF export need WordCraft and PdfCraft installed.")} />}
          media={<Printout src="/landing/sheet.webp" width="1812" height="940"
            alt={t("ตาราง Univer ชื่อ “ต้นทุนต่อแก้ว” รวมต้นทุน 23 บาท ราคาขาย 55 บาท กำไรต่อแก้ว 32 บาท บันทึกแล้ว", "Univer sheet “cost per cup”: total cost 23 baht, price 55 baht, profit 32 baht, saved")}
            caption={t("ตาราง Univer · ข้อมูลตัวอย่าง", "Univer sheet · sample data")} />}>
          <p>{t("แก้เอกสารและตารางด้วย Univer ในแอป บันทึกแล้วย้อนกลับฉบับเก่าได้ แล้วสร้างรายงานเป็น DOCX และ PDF",
            "Edit documents and sheets with Univer in the app, go back to earlier saves, then build a report as DOCX and PDF.")}</p>
        </Lane>
      </div>
    </section>
  );
}

function LocalSchematic({ t }) {
  return (
    <section className="landing-local" id="local" aria-labelledby="local-title">
      <div className="landing-container landing-local-grid">
        <div className="landing-local-copy">
          <h2 id="local-title">{keep(t("ทุกอย่างอยู่ ในเครื่องของคุณ", "Everything stays on your machine"))}</h2>
          <p>{t("FORGE ทำงานบนคอมพิวเตอร์ของคุณ แล้วเปิดผ่านเบราว์เซอร์ โปรเจกต์ ชุดข้อมูล และไฟล์ผลลัพธ์เก็บในโฟลเดอร์งานบนเครื่องคุณ",
            "FORGE runs on your computer and opens in your browser. Projects, datasets and output files live in work folders on your machine.")}</p>
          <p>{t("บริการ AI และเครื่องประมวลผลภายนอกใช้เฉพาะเมื่อคุณเชื่อมต่อเองด้วยบัญชีของคุณ", "AI services and outside compute only take part when you connect them with your own account.")}</p>
          <a className="landing-text-link" href={SOURCE_URL}><Github aria-hidden="true" size={16} />{t("ดูซอร์สโค้ดบน GitHub", "Read the source on GitHub")}<ArrowUpRight aria-hidden="true" size={15} /></a>
        </div>
        <figure className="landing-schematic" aria-labelledby="schematic-caption">
          <div className="landing-schematic-machine">
            <p className="landing-schematic-label">{t("คอมพิวเตอร์ของคุณ", "Your computer")}</p>
            <div className="landing-schematic-row">
              <div className="landing-schematic-node is-forge"><ForgeMark /><strong>FORGE</strong><code>localhost:4317</code></div>
              <div className="landing-schematic-node"><strong>{t("โมเดลที่เปิดใช้งาน", "Deployed model")}</strong><code>127.0.0.1:8000</code></div>
            </div>
            <div className="landing-schematic-row">
              <div className="landing-schematic-node"><strong>{t("โฟลเดอร์งาน", "Work folders")}</strong><span>{t("ชุดข้อมูลและไฟล์ผลลัพธ์", "Datasets and output files")}</span></div>
              <div className="landing-schematic-node"><strong>{t("ข้อมูลโปรเจกต์", "Project data")}</strong><span>{t("แผนงาน แชต และฉบับที่บันทึก", "Plans, chats and saved versions")}</span></div>
            </div>
          </div>
          <div className="landing-schematic-outside">
            <span className="landing-schematic-wire" aria-hidden="true" />
            <div className="landing-schematic-node is-outside"><strong>{t("บริการ AI และเครื่องประมวลผลภายนอก", "AI services and outside compute")}</strong><span>{t("ใช้เมื่อคุณเชื่อมต่อเอง", "Only when you connect them")}</span></div>
          </div>
          <figcaption id="schematic-caption">{t("FORGE บนเครื่องของคุณ · ตัวเลขพอร์ตเป็นค่าเริ่มต้น", "FORGE on your computer · port numbers are defaults")}</figcaption>
        </figure>
      </div>
    </section>
  );
}

function PlatformTicket({ platform, release, t }) {
  const item = release.data?.platforms.find((entry) => entry.id === platform.id);
  const { Icon } = platform;
  const verified = item?.qualification === "developer-verified";
  return (
    <article className="landing-ticket landing-platform">
      <Magnet className="landing-ticket-magnet" accent={platform.id === "windows"} />
      <div className="landing-platform-heading"><Icon aria-hidden="true" size={22} /><h3>{platform.label}</h3></div>
      <p className={`landing-qualification${verified ? " is-verified" : ""}`}>
        {verified ? <Check aria-hidden="true" size={15} /> : <span className="landing-lamp is-amber" aria-hidden="true" />}{qualificationText(item, release, t)}
      </p>
      <p className="landing-platform-description">{platform.id === "windows"
        ? t("ซอร์สโค้ดพร้อมตัวเปิดโปรแกรมสำหรับ Windows เปิด FORGE ในเบราว์เซอร์บนเครื่องของคุณ", "Source and launcher for Windows. Open FORGE on localhost in your browser.")
        : t("ซอร์สโค้ดพร้อมตัวเปิดโปรแกรมสำหรับ macOS ยังไม่ได้ทดสอบบน Mac และตัวสร้างรายงานยังรองรับเฉพาะ Windows", "Source and launcher for macOS. Mac testing is pending; native report engines are not qualified.")}</p>
      <DownloadLink platform={platform} release={release} t={t} />
      <div className="landing-package-details">
        <p><span>{t("ZIP พร้อมตัวเปิดโปรแกรม", "ZIP + launcher")}</span>{item && <span>{mebibytes(item.bytes)}</span>}</p>
        {item && <>
          <p className="landing-package-filename">{item.filename}</p>
          <details>
            <summary>{t("ดูรหัสตรวจไฟล์ (SHA-256)", "Show SHA-256")}<ChevronDown aria-hidden="true" size={14} /></summary>
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
    document.title = lang === "th" ? "FORGE — จากโจทย์หนึ่งประโยค สู่โมเดล AI บนเครื่องคุณ" : "FORGE — From one sentence to an AI model on your machine";
    try { localStorage.setItem("forge.landing.language", lang); } catch { /* Storage is optional. */ }
  }, [lang]);

  return (
    <div className="landing" lang={lang}>
      <a className="landing-skip" href="#landing-main">{t("ข้ามไปที่เนื้อหา", "Skip to content")}</a>
      <header className="landing-rail">
        <div className="landing-nav landing-container">
          <a className="landing-brand" href="#" aria-label="FORGE"><ForgeMark /><span>FORGE</span></a>
          <nav className="landing-nav-links" aria-label={t("เมนูหลัก", "Main navigation")}>
            <a href="#path">{t("ขั้นตอน", "How it works")}</a>
            <a href="#local">{t("ในเครื่องคุณ", "Local")}</a>
            <a href="#download">{t("ดาวน์โหลด", "Download")}</a>
          </nav>
          <div className="landing-nav-actions">
            <div className="landing-language" role="group" aria-label="Language / ภาษา">
              <button type="button" lang="th" aria-label="ภาษาไทย" aria-pressed={lang === "th"} onClick={() => setLang("th")}>TH</button>
              <button type="button" lang="en" aria-label="English" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
            <a className="landing-nav-open" href="/app"><span>{t("เปิด Workbench", "Open workbench")}</span><ArrowUpRight aria-hidden="true" size={16} /></a>
          </div>
        </div>
      </header>

      <main id="landing-main" className="landing-board">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-container landing-hero-grid">
            <h1 id="landing-title">{t(<>{keep("จากโจทย์หนึ่งประโยค")}<br />{keep("สู่โมเดล AI บนเครื่องคุณ")}</>, <>From one sentence to an AI model on your machine.</>)}</h1>
            <div className="landing-hero-copy">
              <p className="landing-hero-description">{t("บอกสิ่งที่อยากได้ ผู้ช่วย AI จะถามรายละเอียดและร่างแผนงานให้คุณอ่านและอนุมัติ จากนั้น FORGE พาไปต่อถึงการเทรน วัดผล และเปิดใช้งานโมเดลบนเครื่องของคุณ",
                "Say what you want. An AI assistant asks the details and drafts a plan for you to read and approve. Then FORGE takes it on to training, evaluation and running the model on your own machine.")}</p>
              <p className="landing-hero-honest">{t("รุ่น Alpha ยังทำได้ไม่ครบทุกขั้น ดูสถานะของแต่ละขั้นได้ด้านล่าง", "This alpha doesn’t cover every step yet. Each step below shows its status.")}</p>
              <HeroTicket release={release} retry={retry} t={t} />
            </div>
            <HeroPreview t={t} />
          </div>
        </section>

        <Path t={t} />
        <LocalSchematic t={t} />

        <section className="landing-download" id="download" aria-labelledby="download-title">
          <div className="landing-container">
            <div className="landing-download-head">
              <h2 id="download-title">{keep(t("ดาวน์โหลด FORGE รุ่น Alpha", "Download the FORGE alpha"))}</h2>
              <div className="landing-release-state" role="status" aria-live="polite" aria-atomic="true">
                {release.status === "loading" && <><LoaderCircle aria-hidden="true" className="landing-spinner" size={16} />{t("กำลังตรวจสอบรุ่นและไฟล์ดาวน์โหลด…", "Checking release and download files…")}</>}
                {release.status === "error" && <><span>{t("โหลดข้อมูลไฟล์ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง หรือเปิด Workbench ที่ติดตั้งไว้แล้ว", "Download details didn’t load. Try again, or open the workbench you already have.")}</span><button className="landing-retry" type="button" onClick={retry}><RotateCw aria-hidden="true" size={15} />{t("ลองอีกครั้ง", "Retry")}</button></>}
                {release.status === "ready" && <><span>{release.data.version}</span><span className="landing-release-divider">·</span><span>Alpha</span><span className="landing-release-divider">·</span><code className="landing-release-commit" title={release.data.commit}>{release.data.commit.slice(0, 12)}</code></>}
              </div>
            </div>
            <div className="landing-platforms">{PLATFORMS.map((platform) => <PlatformTicket key={platform.id} platform={platform} release={release} t={t} />)}</div>
            <div className="landing-install">
              <h3>{t("จากไฟล์ ZIP ถึงหน้า Workbench", "From ZIP to workbench")}</h3>
              <ol>
                <li><span>1</span><div><h4>{t("ติดตั้ง Node.js", "Prepare Node.js")}</h4><p>{t("ใช้ Node.js รุ่น 24.13 ขึ้นไป และดูสิ่งที่ต้องเตรียมของแต่ละไฟล์", "Use Node.js 24.13 or later and check package requirements.")}</p></div></li>
                <li><span>2</span><div><h4>{t("แตกไฟล์แล้วเปิดโปรแกรม", "Extract and launch")}</h4><p>{t("แตกไฟล์ ZIP ไว้ในโฟลเดอร์ที่บันทึกไฟล์ได้ แล้วเปิดตัวเปิดโปรแกรมตามคู่มือในไฟล์", "Extract the ZIP to a writable folder and follow the included launcher guide.")}</p></div></li>
                <li><span>3</span><div><h4>{t("เปิด Workbench", "Open your workbench")}</h4><p>{t("เปิดที่อยู่ localhost ที่ตัวเปิดโปรแกรมแสดง แล้วสร้างโปรเจกต์แรก", "Open the localhost address shown by the launcher, then create your first project.")}</p></div></li>
              </ol>
              <p className="landing-install-note">{t("ไฟล์นี้เป็นซอร์สโค้ดพร้อมตัวเปิดโปรแกรม ยังไม่ใช่ตัวติดตั้งที่มีลายเซ็นรับรอง ครั้งแรกอาจต้องต่ออินเทอร์เน็ตเพื่อดาวน์โหลดส่วนประกอบเพิ่ม", "These packages contain source and launchers, rather than signed installers. First setup may need internet access to download dependencies.")}</p>
            </div>
            <aside className="landing-alpha-notice" id="release-status" aria-labelledby="release-status-title">
              <h3 id="release-status-title">{t("สถานะจริงของรุ่น Alpha", "The alpha, with its status in the open")}</h3>
              <p>{t("FORGE ยังพัฒนาไม่ครบทุกส่วน ผู้พัฒนาทดสอบบนเครื่องของตัวเองแล้ว แต่ยังไม่ได้ทดสอบการใช้งานจริงที่บ้าน การเชื่อมต่อบริการ AI ต้องใช้บัญชีและสิทธิ์ของคุณเอง", "FORGE is still under development. Developer checks are separate from home acceptance testing, which has not run. Live service connections require your accounts and permissions.")}</p>
              <ul className="landing-status-labels">
                <li><span className="landing-lamp is-amber" aria-hidden="true" />{t("ยังพัฒนาไม่ครบ", "Implementation incomplete")}<code>IMPLEMENTATION_INCOMPLETE</code></li>
                <li><span className="landing-lamp is-off" aria-hidden="true" />{t("ยังไม่ได้ทดสอบที่บ้าน", "Home test not run")}<code>HOME_UAT_NOT_RUN</code></li>
              </ul>
            </aside>
          </div>
        </section>
      </main>

      <footer className="landing-rail landing-footer">
        <div className="landing-container landing-footer-inner">
          <a className="landing-brand" href="#"><ForgeMark /><span>FORGE</span></a>
          <p>{t("จากโจทย์ ถึงโมเดลที่ใช้งานได้ บนเครื่องของคุณ", "From a prompt to a working model, on your machine.")}</p>
          <div><a href={SOURCE_URL}><Github aria-hidden="true" size={16} />{t("ซอร์สโค้ด", "Source")}<ArrowUpRight aria-hidden="true" size={14} /></a><a href="/app">Workbench<ArrowUpRight aria-hidden="true" size={14} /></a></div>
        </div>
      </footer>
    </div>
  );
}
