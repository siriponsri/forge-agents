import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  House,
  Workflow,
  Rocket,
  Columns3,
  ListChecks,
  Users,
  MessagesSquare,
  MessageSquare,
  Lightbulb,
  Zap,
  Brain,
  Smartphone,
  NotebookPen,
  Cpu,
  Boxes,
  FileSpreadsheet,
  FileText,
  Files,
  HardDrive,
  Monitor,
  Activity,
  Wallet,
  FlaskConical,
  Settings,
  Code2,
  RefreshCw,
  AlertCircle,
  X,
  Menu,
  Search,
  SquarePen,
  FolderPlus,
  FolderOpen,
  Languages,
  Palette,
  PanelLeft,
  ChevronRight,
  Sparkles,
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
import { DEFAULT_THEME, THEMES, getTheme } from './themes.mjs';
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
import ProductStudio from './studio/ProductStudio.jsx';
import Sidebar from './Sidebar.jsx';
import CommandPalette from './CommandPalette.jsx';
import { PreferencesMenu } from './ShellControls.jsx';
import { ROUTE_GROUPS, ROUTE_KEYWORDS, closeTab, neighbourAfterClose, openTab, readStored, recentThreads, threadTitle, writeStored } from './shell-routes.mjs';
import './app-shell.css';

const NARROW = '(max-width: 960px)';
const inEditor = target => Boolean(target?.closest?.('.univer-container, [contenteditable="true"]'));

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
  // Shell chrome: collapsed rail and open tabs persist per browser.
  const [collapsed, setCollapsed] = useState(() => readStored("forge.sidebarCollapsed", false) === true);
  const [tabs, setTabs] = useState(() => {
    const stored = readStored("forge.tabs", []);
    return Array.isArray(stored) ? stored.filter(id => typeof id === "string") : [];
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [homeFocus, setHomeFocus] = useState(0);
  const [chatFocus, setChatFocus] = useState(null);
  const [chatRoomId, setChatRoomId] = useState("");
  // A home-composer prompt waiting for AI Product Studio; cleared once consumed.
  const [studioPrompt, setStudioPrompt] = useState("");
  const menuButton = useRef(null);
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
  useEffect(() => { writeStored("forge.sidebarCollapsed", collapsed); }, [collapsed]);
  useEffect(() => { writeStored("forge.tabs", tabs); }, [tabs]);
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
    ['overview',House,'หน้าแรก','Overview'],
    ['studio',Sparkles,'สร้างผลิตภัณฑ์ AI','AI Product Studio'],
    ['workflows',Workflow,'รูปแบบการทำงาน','Workflow presets'],
    ['missions',Rocket,'ภารกิจและการส่งมอบ','Missions & delivery'],
    ['parallel',Columns3,'งานคู่ขนาน','Parallel workspaces'],
    ["plan", ListChecks, "แผนงาน", "Plan & tasks"],
    ["team", Users, "ทีมผู้ช่วย AI", "Bot team"],
    ["chat", MessagesSquare, "แชต", "Conversations"],
    ['strategies',Lightbulb,'กลยุทธ์และทักษะ','Strategies & skills'],
    ['proactive',Zap,'งานอัตโนมัติ','Proactive workflows'],
    ['memory',Brain,'ความจำของ AI','Memory Studio'],
    ['mobile',Smartphone,'งานจากมือถือ','Mobile Inbox'],
    ["notebooks", NotebookPen, "สมุดโค้ด Python", "Notebooks"],
    ['compute',Cpu,'เครื่องประมวลผล','Compute targets'],
    ['serving',Boxes,'เปิดใช้งานโมเดล','Models & serving'],
    ["office", FileSpreadsheet, "เอกสารและตาราง", "Docs & sheets"],
    ["reports", FileText, "รายงาน", "Report Studio"],
    ["artifacts", Files, "ไฟล์ผลลัพธ์", "Artifacts"],
    ['storage',HardDrive,'สำรองและกู้คืนข้อมูล','Storage & recovery'],
    ['desktop',Monitor,'ให้ AI ใช้คอมพิวเตอร์','Desktop & browser'],
    ["monitor", Activity, "ติดตามการทำงาน", "Monitor"],
    ['budgets',Wallet,'การใช้งานและงบ','Usage & budgets'],
    ['research',FlaskConical,'ห้องทดลองและวัดผล','Research Lab'],
    ["settings", Settings, "ตั้งค่าโปรเจกต์", "Settings"],
  ];
  const startT3 = () =>
    run(async () => {
      const result = await request("/api/t3/start", { projectId });
      const url = result.url || result.appUrl;
      if (!url)
        throw new Error(
          t(
            "เปิด T3 ไม่สำเร็จ ตรวจสถานะ T3 ในหน้า ตั้งค่า แล้วลองใหม่",
            "T3 did not return a URL; inspect readiness.",
          ),
        );
      window.open(safeLocalUrl(url), "_blank", "noopener,noreferrer");
      setNotice(
        t(
          "เปิด T3 แล้ว ถ้าหน้าต่างไม่ขึ้น ให้กดลิงก์ “ไปที่ T3”",
          "T3 started. If your browser blocked the window, open the link below.",
        ),
      );
      setHealth((h) => ({ ...h, t3Url: url }));
    });
  let t3Href = "";
  try { t3Href = health?.t3Url ? safeLocalUrl(health.t3Url) : ""; } catch { t3Href = ""; }

  // Every route change goes through the unsaved-document guard.
  const shownPage = project ? page : "overview";
  const route = id => nav.find(item => item[0] === id);
  const closeDrawer = () => setNavOpen(false);
  const openPage = id => {
    closeDrawer();
    if (id === shownPage) { if (id === "overview") setHomeFocus(n => n + 1); return; }
    navigate(() => { setPage(id); setTabs(list => openTab(list, id)); });
  };
  const openThread = (roomId, draft = "") => {
    closeDrawer();
    navigate(() => {
      setChatFocus({ id: roomId, draft, n: Date.now() });
      setChatRoomId(roomId);
      setPage("chat");
      setTabs(list => openTab(list, "chat"));
    });
  };
  // Primary action: describe a new AI product in the home composer.
  const newProduct = () => {
    closeDrawer();
    if (shownPage === "overview") { setHomeFocus(n => n + 1); return; }
    navigate(() => { setPage("overview"); setHomeFocus(n => n + 1); });
  };
  const startProduct = prompt => {
    closeDrawer();
    navigate(() => { setStudioPrompt(prompt); setPage("studio"); setTabs(list => openTab(list, "studio")); });
  };
  const selectProject = id => { if (id !== projectId) navigate(() => setProjectId(id)); };
  const removeTab = id => {
    if (id !== page) { setTabs(list => closeTab(list, id)); return; }
    navigate(() => {
      setPage(neighbourAfterClose(tabs, id) || "overview");
      setTabs(list => closeTab(list, id));
    });
  };
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia?.(NARROW).matches) setNavOpen(open => !open);
    else setCollapsed(value => !value);
  }, []);

  // Ctrl/Cmd+K opens the palette; Ctrl/Cmd+B collapses the sidebar. The Office
  // editor keeps its own shortcuts (bold, links) while it has focus.
  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "b") return;
      if (inEditor(event.target)) return;
      event.preventDefault();
      if (key === "k") setPaletteOpen(open => !open);
      else toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  // The mobile drawer closes on Escape and returns focus to its menu button.
  useEffect(() => {
    if (!navOpen) return undefined;
    document.querySelector(".sidebar .project-switcher-trigger")?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setNavOpen(false);
      menuButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const bots = (state?.bots || []).filter(bot => bot.projectId === projectId);
  const threads = useMemo(() => recentThreads(state?.conversations, projectId), [state, projectId]);
  const groupOf = id => ROUTE_GROUPS.find(group => group.pages.includes(id)) || { id: "other", th: "อื่น ๆ", en: "Other" };

  const paletteSections = [
    { id: "actions", label: t("คำสั่ง", "Commands") },
    ...ROUTE_GROUPS.map(group => ({ id: group.id, label: t(group.th, group.en) })),
    { id: "other", label: t("อื่น ๆ", "Other") },
    { id: "threads", label: t("แชตล่าสุด", "Recent conversations") },
    { id: "projects", label: t("โปรเจกต์", "Projects") },
  ];
  const paletteOrder = [...ROUTE_GROUPS.map(group => group.id), "other", "threads", "projects", "actions", "themes"];
  const command_ = t("คำสั่ง", "Command");
  const paletteItems = [
    { key: "action:new-product", kind: "action", group: "actions", Icon: Sparkles, label: t("สร้างผลิตภัณฑ์ AI ใหม่", "New AI product"), keywords: "new ai ml model product studio ใหม่ ผลิตภัณฑ์ โมเดล", hint: command_, run: newProduct },
    { key: "action:new-conversation", kind: "action", group: "actions", Icon: SquarePen, label: t("เริ่มแชตใหม่", "New conversation"), keywords: "new thread chat แชต compose", hint: command_, run: () => (project ? openPage("chat") : setNewProject(true)) },
    { key: "action:new-project", kind: "action", group: "actions", Icon: FolderPlus, label: t("สร้างโปรเจกต์ใหม่", "New project"), keywords: "create project สร้าง โปรเจกต์", hint: command_, run: () => setNewProject(true) },
    { key: "action:language", kind: "action", group: "actions", Icon: Languages, label: lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย", keywords: "language ภาษา thai english ไทย", hint: command_, run: () => setLang(lang === "th" ? "en" : "th") },
    { key: "action:refresh", kind: "action", group: "actions", Icon: RefreshCw, label: t("โหลดข้อมูลล่าสุด", "Refresh state"), keywords: "reload sync", hint: command_, run: () => run(refresh) },
    { key: "action:sidebar", kind: "action", group: "actions", Icon: PanelLeft, label: collapsed ? t("ขยายแถบด้านข้าง", "Expand sidebar") : t("ย่อแถบด้านข้าง", "Collapse sidebar"), keywords: "sidebar toggle ctrl+b", hint: "Ctrl+B", showEmpty: false, run: toggleSidebar },
    { key: "action:t3", kind: "action", group: "actions", Icon: Code2, label: t("เปิด T3 เพื่อเขียนโค้ด", "Open T3 coding"), keywords: "t3 code coding โค้ด", hint: command_, showEmpty: false, run: startT3 },
    ...(page !== "overview" && tabs.includes(page) ? [{ key: "action:close-tab", kind: "action", group: "actions", Icon: X, label: t("ปิดแท็บนี้", "Close this tab"), keywords: "close tab", hint: command_, showEmpty: false, run: () => removeTab(page) }] : []),
    ...nav.map(([id, Icon, th, en]) => ({
      key: `page:${id}`, kind: "page", group: groupOf(id).id, Icon, label: t(th, en), alt: lang === "th" ? en : th,
      keywords: `${id} ${ROUTE_KEYWORDS[id] || ""}`, hint: t(groupOf(id).th, groupOf(id).en),
      run: () => (project || id === "overview" ? openPage(id) : setNewProject(true)),
    })),
    ...threads.slice(0, project ? 30 : 0).map((room, index) => ({
      key: `thread:${room.id}`, kind: "thread", group: "threads", Icon: MessageSquare, label: threadTitle(room, bots, t),
      keywords: (room.messages?.[room.messages.length - 1]?.text || "").slice(0, 120), hint: t("แชต", "Conversation"),
      showEmpty: index < 5, run: () => openThread(room.id),
    })),
    ...(state?.projects || []).map(p => ({
      key: `project:${p.id}`, kind: "project", group: "projects", Icon: FolderOpen, label: p.name,
      keywords: p.description || "", hint: p.id === projectId ? t("โปรเจกต์ที่เปิดอยู่", "Current project") : t("โปรเจกต์", "Project"),
      run: () => selectProject(p.id),
    })),
    ...THEMES.map(item => ({
      key: `theme:${item.id}`, kind: "theme", group: "themes", Icon: Palette, label: `${t("ธีม", "Theme")}: ${item.label}`,
      keywords: `theme ธีม ${item.kind} ${item.kind === "dark" ? "มืด" : "สว่าง"}`, hint: item.id === theme ? t("ใช้อยู่", "Current") : "",
      showEmpty: false, run: () => changeTheme(item.id),
    })),
  ];

  const pageLabel = id => { const r = route(id); return r ? t(r[2], r[3]) : id; };
  const tabList = project ? tabs.filter(id => route(id)) : [];

  return (
    <div className={`workbench${navOpen ? " nav-open" : ""}${collapsed ? " is-collapsed" : ""}`}>
      <Sidebar t={t} lang={lang} nav={nav} page={shownPage} collapsed={collapsed}
        onToggleCollapse={toggleSidebar}
        projects={state?.projects || []} project={project}
        onSelectProject={id => { closeDrawer(); selectProject(id); }}
        onNewProject={() => { closeDrawer(); setNewProject(true); }}
        threads={project ? threads : []} bots={bots} activeThreadId={chatRoomId}
        onOpenThread={openThread} onOpenPage={openPage} onNewProduct={newProduct}
        onOpenPalette={() => { closeDrawer(); setPaletteOpen(true); }}
        connected={connected} health={health} t3Href={t3Href} busy={busy} onStartT3={startT3} />
      {navOpen && <div className="drawer-backdrop" aria-hidden="true" onClick={closeDrawer} />}
      <div className="workspace">
        <header className="topbar">
          <button ref={menuButton} type="button" className="icon-button mobile-menu" aria-label="Menu"
            aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
            <Menu size={18} aria-hidden="true" />
          </button>
          <nav className="breadcrumb topbar-title" aria-label={t("ตำแหน่งปัจจุบัน", "Breadcrumb")}>
            <span className="crumb-project">{project?.name || "FORGE"}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="crumb-page" aria-current="page">{pageLabel(shownPage)}</span>
          </nav>
          <div className="topbar-actions">
            <button type="button" className="palette-trigger" onClick={() => setPaletteOpen(true)}
              aria-label={t("ค้นหาและคำสั่ง", "Search and commands")} aria-keyshortcuts="Control+K" aria-haspopup="dialog">
              <Search size={15} aria-hidden="true" />
              <span className="palette-trigger-text" aria-hidden="true">{t("ค้นหาหรือไปที่…", "Search or jump to…")}</span>
              <kbd aria-hidden="true">Ctrl K</kbd>
            </button>
            <button type="button" className="icon-button" onClick={() => run(refresh)} disabled={busy}
              aria-label={t("โหลดข้อมูลล่าสุด", "Refresh state")} title={t("โหลดข้อมูลล่าสุด", "Refresh state")}>
              <RefreshCw size={16} aria-hidden="true" className={busy ? "spin" : undefined} />
            </button>
            <PreferencesMenu t={t} lang={lang} onLanguage={setLang} theme={theme} onTheme={changeTheme}
              collapsed={collapsed} onToggleSidebar={toggleSidebar} />
          </div>
        </header>
        {tabList.length > 0 && (
          <nav className="page-tabs" aria-label={t("หน้าที่เปิดอยู่", "Open pages")}>
            {tabList.map(id => {
              const Icon = route(id)[1];
              const label = pageLabel(id), active = shownPage === id;
              return (
                <div key={id} className={`page-tab${active ? " is-active" : ""}`}>
                  <button type="button" className="page-tab-open" aria-current={active ? "page" : undefined}
                    onClick={() => openPage(id)}
                    onAuxClick={event => { if (event.button === 1) { event.preventDefault(); removeTab(id); } }}>
                    <Icon size={14} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                  <button type="button" className="page-tab-close" aria-label={t(`ปิดแท็บ ${label}`, `Close ${label} tab`)}
                    title={t("ปิดแท็บ", "Close tab")} onClick={() => removeTab(id)}>
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </nav>
        )}
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>{t("ทำรายการไม่สำเร็จ", "Action failed")}</strong>
              <p>{error.message}</p>
              {error.code && <small className="alert-code">{error.code}</small>}
              {error.status === 409 && (
                <p>
                  {t(
                    "มีการแก้ไขข้อมูลนี้ก่อนหน้า ระบบโหลดข้อมูลล่าสุดแล้ว ตรวจอีกครั้งแล้วลองใหม่",
                    "A newer revision exists. State refreshed; your unsaved work is retained. Review before retrying.",
                  )}
                </p>
              )}
            </div>
            <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert" role="status">
            <span>{notice}</span>
            {t3Href && <a href={t3Href} target="_blank" rel="noreferrer">{t("ไปที่ T3", "Open T3")}</a>}
          </div>
        )}
        <main aria-busy={busy} className={shownPage === "overview" ? "is-home" : undefined}>
          {!state ? (
            <Empty>
              {t(
                "กำลังเปิด FORGE… ถ้ารอนาน ให้เปิดโปรแกรม FORGE ในเครื่อง แล้วโหลดหน้านี้ใหม่",
                "Loading FORGE… If unavailable, start the local service and refresh.",
              )}
            </Empty>
          ) : !project || page==='overview' ? (
            <Overview {...props} onCreate={()=>setNewProject(true)} onNavigate={openPage}
              onOpenThread={openThread} onStartProduct={startProduct} focusToken={homeFocus}/>
          ) : (
            <>
              {page === "studio" && <ProductStudio key={projectId} {...props} initialPrompt={studioPrompt} onConsumePrompt={() => setStudioPrompt("")} onNavigate={openPage} />}
              {page === "plan" && <Planning {...props} />}{" "}
              {page==='missions'&&<Missions key={projectId} {...props}/>}
              {page==='proactive'&&<ProactiveWorkflows key={projectId} {...props}/>}
              {page==='parallel'&&<ParallelWorkspace key={projectId} {...props}/>}
              {page==='budgets'&&<BudgetStudio key={projectId} {...props}/>}
              {page==='workflows'&&<WorkflowPresets key={projectId} {...props}/>}
              {page==='research'&&<ResearchLab key={projectId} {...props}/>}
              {page === "team" && <Team key={projectId} {...props} />}{" "}
              {page === "chat" && <Chat key={projectId} {...props} focusRoom={chatFocus} onRoomChange={setChatRoomId} />}{" "}
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} t={t}
        items={paletteItems} sections={paletteSections} groupOrder={paletteOrder} />
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
                  {t("สร้างโปรเจกต์", "Create project")}
                </span>
              }
              description={t(
                "งานของโปรเจกต์จะเก็บในโฟลเดอร์ที่คุณเลือก แยกจากตัวโปรแกรม FORGE",
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
              <Field label={t("ชื่อโปรเจกต์", "Project name")}>
                <input name="name" required autoFocus />
              </Field>
              <Field label={t("โฟลเดอร์งาน", "Workspace directory")}>
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
                  {t("สร้างโปรเจกต์", "Create project")}
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
                "เอกสารนี้มีการแก้ไขที่ยังไม่บันทึก กลับไปบันทึกก่อน หรือออกโดยไม่บันทึก",
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
                {t("ออกโดยไม่บันทึก", "Discard and leave")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
