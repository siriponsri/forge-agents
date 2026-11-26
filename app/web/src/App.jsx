import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Layers3,
  Users,
  MessagesSquare,
  NotebookPen,
  Files,
  FileSpreadsheet,
  FileText,
  Activity,
  Settings,
  Code2,
  RefreshCw,
  AlertCircle,
  X,
  Menu,
  LayoutDashboard,
  Zap,
} from "lucide-react";
import { command, request, safeLocalUrl } from "./api.mjs";
import { Empty, Field, Heading, Submit } from "./ui.jsx";
import { Team, Chat, Planning } from "./work.jsx";
import {
  Notebooks,
  Artifacts,
  Monitoring,
  SettingsPage,
} from "./operations.jsx";
import Office from "./Office.jsx";
import Reports from "./Reports.jsx";
import Serving from './Serving.jsx';
import Storage from './Storage.jsx';
import Desktop from './Desktop.jsx';
import Overview from './Overview.jsx';
import ThemePicker from './ThemePicker.jsx';
import { DEFAULT_THEME, getTheme } from './themes.mjs';
import Strategies from './Strategies.jsx';
import Memory from './Memory.jsx';
import Compute from './Compute.jsx';
import MobileInbox from './MobileInbox.jsx';
import Missions from './Missions.jsx';
import ProactiveWorkflows from './ProactiveWorkflows.jsx';
import ParallelWorkspace from './ParallelWorkspace.jsx';
import BudgetStudio from './BudgetStudio.jsx';
import WorkflowPresets from './WorkflowPresets.jsx';
import ResearchLab from './ResearchLab.jsx';
import WorkspaceNavigation from './WorkspaceNavigation.jsx';

export default function App() {
  const [theme,setTheme]=useState(()=>getTheme(localStorage.getItem('forge.theme')||DEFAULT_THEME).id);
  const themeHydrated=useRef(false);
  const [lang, setLang] = useState(
    () => localStorage.getItem("forge.language") || "th",
  );
  const t = (th, en) => (lang === "th" ? th : en);
  const [state, setState] = useState(null),
    [health, setHealth] = useState(null),
    [error, setError] = useState(null),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [page, setPage] = useState("overview"),
    [navOpen, setNavOpen] = useState(false);
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem("forge.project") || "",
  );
  const [newProject, setNewProject] = useState(false),
    [dirtyOffice, setDirtyOffice] = useState(false),
    [leave, setLeave] = useState(null);
  const refreshIndex = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++refreshIndex.current;
    const result = await request("/api/state");
    if (n === refreshIndex.current) setState(result);
    return result;
  }, []);
  useEffect(() => {
    refresh().catch(setError);
    request("/api/health")
      .then(setHealth)
      .catch(() => {});
    const events = new EventSource("/api/events");
    events.onopen = () => {
      setConnected(true);
      refresh().catch(setError);
    };
    events.onmessage = () => {
      refresh().catch(setError);
    };
    events.addEventListener("state", () => {
      refresh().catch(setError);
    });
    events.onerror = () => setConnected(false);
    // Reconciliation is GET-only: reconnect never retries a mutation.
    const timer = setInterval(
      () => refresh().catch(() => setConnected(false)),
      12000,
    );
    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem("forge.language", lang);
  }, [lang]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=getTheme(theme).kind;localStorage.setItem('forge.theme',theme);const meta=document.querySelector('meta[name="theme-color"]');meta?.setAttribute('content',getComputedStyle(document.documentElement).backgroundColor);},[theme]);
  useEffect(()=>{if(state&&!themeHydrated.current){themeHydrated.current=true;if(state.settings.theme)setTheme(getTheme(state.settings.theme).id);}},[state]);
  const changeTheme=id=>{setTheme(getTheme(id).id);command('settings.update',null,{theme:id}).then(refresh).catch(setError);};
  useEffect(() => {
    if (state && !state.projects.some((p) => p.id === projectId))
      setProjectId(state.projects[0]?.id || "");
  }, [state, projectId]);
  useEffect(() => {
    localStorage.setItem("forge.project", projectId);
  }, [projectId]);
  useEffect(()=>{window.scrollTo(0,0);},[page,projectId]);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e) {
      setError(e);
      if (e.status === 409) await refresh().catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  };
  const mutate = (type, data, entity) =>
    run(() => command(type, projectId, data, entity));
  const project = state?.projects.find((p) => p.id === projectId);
  const navigate = (fn) => {
    if (dirtyOffice) setLeave(() => fn);
    else fn();
  };
  const props = {
    t,
    lang,
    state,
    projectId,
    project,
    busy,
    run,
    mutate,
    refresh,
    setNotice,
    themeKind:getTheme(theme).kind,
    themeId:theme,
    connected,
  };
  const nav = [
    ['overview',LayoutDashboard,'ภาพรวม','Overview'],
    ['workflows',Layers3,'รูปแบบการทำงาน','Workflow presets'],
    ['missions',Zap,'ภารกิจและการส่งมอบ','Missions & delivery'],
    ['parallel',Layers3,'พื้นที่งานแยก','Parallel workspaces'],
    ["plan", Layers3, "แผนงาน", "Plan & tasks"],
    ["team", Users, "ทีมบอท", "Bot team"],
    ["chat", MessagesSquare, "ห้องสนทนา", "Conversations"],
    ['strategies',Zap,'กลยุทธ์และการเรียนรู้','Strategies & skills'],
    ['proactive',Activity,'เวิร์กโฟลว์อัตโนมัติ','Proactive workflows'],
    ['memory',Layers3,'ความจำและความรู้','Memory Studio'],
    ['mobile',MessagesSquare,'กล่องงานจากมือถือ','Mobile Inbox'],
    ["notebooks", NotebookPen, "สมุดงาน Python", "Notebooks"],
    ['compute',Code2,'เป้าหมายประมวลผล','Compute targets'],
    ['serving',Zap,'โมเดลและการทำนาย','Models & serving'],
    ["office", FileSpreadsheet, "เอกสารและตาราง", "Docs & sheets"],
    ["reports", FileText, "รายงาน", "Report Studio"],
    ["artifacts", Files, "ไฟล์และผลลัพธ์", "Artifacts"],
    ['storage',Files,'จัดเก็บและกู้คืน','Storage & recovery'],
    ['desktop',Code2,'Desktop และ browser','Desktop & browser'],
    ["monitor", Activity, "ติดตามการทำงาน", "Monitor"],
    ['budgets',Activity,'การใช้งานและงบ','Usage & budgets'],
    ['research',Activity,'ห้องวิจัยและประเมินผล','Research Lab'],
    ["settings", Settings, "ตั้งค่าโครงการ", "Settings"],
  ];
  const startT3 = () =>
    run(async () => {
      const result = await request("/api/t3/start", { projectId });
      const url = result.url || result.appUrl;
      if (!url)
        throw new Error(
          t(
            "T3 ยังไม่ส่ง URL โปรดดูข้อความ readiness",
            "T3 did not return a URL; inspect readiness.",
          ),
        );
      window.open(safeLocalUrl(url), "_blank", "noopener,noreferrer");
      setNotice(
        t(
          "เปิด T3 แล้ว หากเบราว์เซอร์บล็อกหน้าต่าง ให้เปิดลิงก์ด้านล่าง",
          "T3 started. If your browser blocked the window, open the link below.",
        ),
      );
      setHealth((h) => ({ ...h, t3Url: url }));
    });
  return (
    <div className={`workbench ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <svg className="brand-symbol" width="35" height="35" viewBox="0 0 64 64" aria-hidden="true"><path fill="#f97316" d="M8 8H56L44 20H20V28H48L36 40H20V56H8Z"/><path fill="#f2c94c" d="M44 8H56L44 20H32Z"/><path fill="#8b9199" d="M40 28H48L36 40H28Z"/></svg>
          <div>
            FORGE<small>{t('พื้นที่สำหรับทุกไอเดีย','Your creative workspace')}</small>
          </div>
        </div>
        <div className="project-picker">
          <Field label={t("โครงการปัจจุบัน", "Current project")}>
            <select
              value={projectId}
              onChange={(e) => navigate(() => setProjectId(e.target.value))}
              disabled={!state?.projects.length}
            >
              {!state?.projects.length && (
                <option value="">{t("ยังไม่มีโครงการ", "No projects")}</option>
              )}
              {state?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <button onClick={() => setNewProject(true)}>
            {t("+ สร้างโครงการ", "+ Create project")}
          </button>
        </div>
        <WorkspaceNavigation items={nav} activePage={page} t={t}
          onSelect={id => navigate(() => { setPage(id); setNavOpen(false); })} />
        <div className="sidebar-foot">
          <span>
            {connected
              ? t("เชื่อมต่อเหตุการณ์แล้ว", "Events connected")
              : t("กำลังกู้คืนการเชื่อมต่อ", "Reconnecting events")}
          </span>
          <small>
            {t('บันทึกและซิงก์ในเครื่อง','Saved on this machine')}
          </small>
          <button onClick={startT3} disabled={busy}>
            <Code2 size={17} />
            {t("เปิดพื้นที่เขียนโค้ด T3", "Open T3 coding")}
          </button>
          {health?.t3Url && (
            <a
              href={safeLocalUrl(health.t3Url)}
              target="_blank"
              rel="noreferrer"
            >
              {t("ไปที่ T3", "Open T3")}
            </a>
          )}
          <div className="sidebar-version">FORGE <span>{health?.version??'alpha'} · {health?.commit??'local'}</span></div>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <button
            className="mobile-menu"
            aria-label="Menu"
            onClick={() => setNavOpen(!navOpen)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb topbar-title">
            {project?.name || "FORGE"}{" "}
            <span>/ {nav.find((n) => n[0] === page)?.[3]}</span>
          </span>
          <div className="actions">
            <ThemePicker theme={theme} onChange={changeTheme} t={t}/>
            <button
              onClick={() => run(refresh)}
              disabled={busy}
              aria-label={t("โหลดข้อมูลล่าสุด", "Refresh state")}
            >
              <RefreshCw size={16} />
            </button>
            <select
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              <option value="th">ไทย · TH</option>
              <option value="en">English · EN</option>
            </select>
          </div>
        </div>
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={20} />
            <div>
              <strong>
                {error.code || t("ดำเนินการไม่สำเร็จ", "Action failed")}
              </strong>
              <p>{error.message}</p>
              {error.status === 409 && (
                <p>
                  {t(
                    "มีเวอร์ชันใหม่บนเซิร์ฟเวอร์ โหลดข้อมูลล่าสุดแล้ว งานที่ยังไม่บันทึกยังอยู่ โปรดตรวจทานก่อนลองใหม่",
                    "A newer revision exists. State refreshed; your unsaved work is retained. Review before retrying.",
                  )}
                </p>
              )}
            </div>
            <button aria-label="Dismiss error" onClick={() => setError(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert" role="status">
            {notice}
          </div>
        )}
        <main aria-busy={busy}>
          {!state ? (
            <Empty>
              {t(
                "กำลังโหลด FORGE… หากบริการไม่พร้อม โปรดเปิดตัวเริ่มระบบและลองโหลดใหม่",
                "Loading FORGE… If unavailable, start the local service and refresh.",
              )}
            </Empty>
          ) : !project || page==='overview' ? (
            <Overview {...props} onCreate={()=>setNewProject(true)} onNavigate={id=>navigate(()=>setPage(id))}/>
          ) : (
            <>
              {page === "plan" && <Planning {...props} />}{" "}
              {page==='missions'&&<Missions key={projectId} {...props}/>}
              {page==='proactive'&&<ProactiveWorkflows key={projectId} {...props}/>}
              {page==='parallel'&&<ParallelWorkspace key={projectId} {...props}/>}
              {page==='budgets'&&<BudgetStudio key={projectId} {...props}/>}
              {page==='workflows'&&<WorkflowPresets key={projectId} {...props}/>}
              {page==='research'&&<ResearchLab key={projectId} {...props}/>}
              {page === "team" && <Team key={projectId} {...props} />}{" "}
              {page === "chat" && <Chat key={projectId} {...props} />}{" "}
              {page==='strategies'&&<Strategies key={projectId} {...props}/>}
              {page==='memory'&&<Memory key={projectId} {...props}/>}
              {page==='compute'&&<Compute key={projectId} {...props}/>}
              {page==='mobile'&&<MobileInbox key={projectId} {...props}/>}
              {page === "notebooks" && <Notebooks key={projectId} {...props} />}{" "}
              {page === "office" && (
                <Office key={projectId} {...props} onDirty={setDirtyOffice} />
              )}{" "}
              {page === "reports" && <Reports key={projectId} {...props} />}{" "}
              {page === 'serving' && <Serving key={projectId} {...props}/>}
              {page === 'storage' && <Storage key={projectId} {...props}/>}
              {page === 'desktop' && <Desktop key={projectId} {...props}/>}
              {page === "artifacts" && <Artifacts {...props} />}{" "}
              {page === "monitor" && <Monitoring {...props} />}{" "}
              {page === "settings" && (
                <SettingsPage key={`${projectId}`} {...props} health={health} />
              )}
            </>
          )}
        </main>
      </div>
      {newProject && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project"
          >
            <Heading
              title={
                <span id="create-project">
                  {t("สร้างโครงการ", "Create project")}
                </span>
              }
              description={t(
                "โฟลเดอร์งานแยกจากซอร์ส FORGE",
                "Keep project output separate from FORGE source.",
              )}
            />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const result = await run(() =>
                  command("project.create", null, {
                    name: d.get("name"),
                    workspace: d.get("workspace"),
                    description: d.get("description"),
                    profile: {},
                  }),
                );
                if (result) {
                  navigate(() => setProjectId(result.entity.id));
                  setNewProject(false);
                }
              }}
            >
              <Field label={t("ชื่อโครงการ", "Project name")}>
                <input name="name" required autoFocus />
              </Field>
              <Field label={t("โฟลเดอร์พื้นที่ทำงาน", "Workspace directory")}>
                <input
                  name="workspace"
                  required
                  placeholder="C:\Projects\..."
                />
              </Field>
              <Field label={t("เป้าหมาย", "Goal")}>
                <textarea name="description" rows={3} />
              </Field>
              <div className="actions">
                <Submit busy={busy}>
                  {t("สร้างโครงการ", "Create project")}
                </Submit>
                <button type="button" onClick={() => setNewProject(false)}>
                  {t("ปิด", "Close")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {leave && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved"
          >
            <h2 id="unsaved">{t("เอกสารยังไม่บันทึก", "Unsaved document")}</h2>
            <p>
              {t(
                "กลับไปบันทึก หรือออกจากเอกสารและทิ้งการแก้ไขในแท็บนี้",
                "Return to save, or leave and discard edits in this tab.",
              )}
            </p>
            <div className="actions">
              <button className="primary" onClick={() => setLeave(null)}>
                {t("กลับไปบันทึก", "Return to editor")}
              </button>
              <button
                onClick={() => {
                  leave();
                  setDirtyOffice(false);
                  setLeave(null);
                }}
              >
                {t("ทิ้งการแก้ไขและออก", "Discard and leave")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
