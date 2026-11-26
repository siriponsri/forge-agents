import React, { useState } from 'react';
import { Code2, ExternalLink, LayoutGrid, MessageSquare, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sparkles } from 'lucide-react';
import { ProjectSwitcher } from './ShellControls.jsx';
import { PINNED_PAGES, relativeTime, threadActivity, threadTitle } from './shell-routes.mjs';

const THREAD_PREVIEW = 12;

function Mark() {
  return (
    <svg className="brand-symbol" width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
      <path fill="#f97316" d="M8 8H56L44 20H20V28H48L36 40H20V56H8Z" />
      <path fill="#f2c94c" d="M44 8H56L44 20H32Z" />
      <path fill="#8b9199" d="M40 28H48L36 40H28Z" />
    </svg>
  );
}

// Presentation only: App owns routes, the unsaved-document guard and persistence.
export default function Sidebar({
  t, lang, nav, page, collapsed, onToggleCollapse, projects, project, onSelectProject, onNewProject,
  threads, bots, activeThreadId, onOpenThread, onOpenPage, onNewProduct, onOpenPalette,
  connected, health, t3Href, busy, onStartT3,
}) {
  const [showAll, setShowAll] = useState(false);
  const route = id => nav.find(item => item[0] === id);
  const visibleThreads = showAll ? threads : threads.slice(0, THREAD_PREVIEW);
  const rowLabel = id => { const r = route(id); return r ? t(r[2], r[3]) : id; };
  const pageRow = id => {
    const r = route(id);
    if (!r) return null;
    const Icon = r[1], label = t(r[2], r[3]), current = page === id;
    return (
      <button key={id} type="button" className="side-row" aria-current={current ? 'page' : undefined}
        title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
        disabled={!project} onClick={() => onOpenPage(id)}>
        <Icon size={16} aria-hidden="true" />
        <span className="side-label">{label}</span>
      </button>
    );
  };
  const collapseLabel = collapsed ? t('ขยายแถบด้านข้าง', 'Expand sidebar') : t('ย่อแถบด้านข้าง', 'Collapse sidebar');

  return (
    <aside className="sidebar" aria-label={t('แถบนำทาง', 'Sidebar')}>
      <div className="sidebar-head">
        <button type="button" className="brand" onClick={() => onOpenPage('overview')}
          aria-label={t('หน้าแรก FORGE', 'FORGE home')} title={collapsed ? 'FORGE' : undefined}>
          <Mark />
          <span className="brand-word">FORGE</span>
        </button>
        <button type="button" className="icon-button sidebar-collapse" onClick={onToggleCollapse}
          aria-label={collapseLabel} title={`${collapseLabel} (Ctrl+B)`} aria-keyshortcuts="Control+B"
          aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </div>

      <ProjectSwitcher t={t} projects={projects} project={project} collapsed={collapsed}
        onSelect={onSelectProject} onCreate={onNewProject} />

      <button type="button" className="side-new" onClick={onNewProduct}
        aria-label={collapsed ? t('ผลิตภัณฑ์ AI ใหม่', 'New AI product') : undefined}
        title={collapsed ? t('ผลิตภัณฑ์ AI ใหม่', 'New AI product') : undefined}>
        <Sparkles size={16} aria-hidden="true" />
        <span className="side-label">{t('ผลิตภัณฑ์ AI ใหม่', 'New AI product')}</span>
      </button>

      <nav className="sidebar-scroll" aria-label={t('เมนูหลัก', 'Main menu')}>
        {collapsed ? (
          <button type="button" className="side-row" aria-label={rowLabel('chat')} title={rowLabel('chat')}
            aria-current={page === 'chat' ? 'page' : undefined} disabled={!project} onClick={() => onOpenPage('chat')}>
            <MessagesSquare size={16} aria-hidden="true" />
          </button>
        ) : (
          <section className="side-section threads" aria-labelledby="side-threads-title">
            <div className="side-heading-row">
              <h2 className="side-heading" id="side-threads-title">
                <span>{t('แชต', 'Conversations')}</span>
                {threads.length > 0 && <span className="side-count">{threads.length}</span>}
              </h2>
              <button type="button" className="icon-button side-heading-action" disabled={!project}
                aria-label={t('เริ่มแชตใหม่', 'New conversation')} title={t('เริ่มแชตใหม่', 'New conversation')}
                onClick={() => onOpenPage('chat')}>
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
            {project && threads.length > 0 ? (
              <ul className="thread-list">
                {visibleThreads.map(room => {
                  const title = threadTitle(room, bots, t);
                  const at = threadActivity(room);
                  const current = page === 'chat' && activeThreadId === room.id;
                  return (
                    <li key={room.id}>
                      <button type="button" className="thread-row" aria-current={current ? 'page' : undefined}
                        onClick={() => onOpenThread(room.id)}>
                        <MessageSquare size={14} aria-hidden="true" />
                        <span className="thread-title">{title}</span>
                        {at > 0 && <time className="thread-time" dateTime={new Date(at).toISOString()}>{relativeTime(at, lang)}</time>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="side-empty">
                {project
                  ? t('ยังไม่มีแชต กด + เพื่อเริ่มแชตใหม่', 'No conversations yet. Choose + to start one.')
                  : t('สร้างโปรเจกต์ก่อน แล้วแชตจะแสดงที่นี่', 'Create a project first. Its conversations appear here.')}
              </p>
            )}
            {threads.length > THREAD_PREVIEW && (
              <button type="button" className="side-more" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
                {showAll ? t('แสดงน้อยลง', 'Show fewer') : t(`ดูทั้งหมด (${threads.length})`, `Show all (${threads.length})`)}
              </button>
            )}
          </section>
        )}

        <section className="side-section" aria-labelledby={collapsed ? undefined : 'side-workspace-title'}
          aria-label={collapsed ? t('เครื่องมือหลัก', 'Workspace') : undefined}>
          {!collapsed && <h2 className="side-heading" id="side-workspace-title"><span>{t('เครื่องมือหลัก', 'Workspace')}</span></h2>}
          {PINNED_PAGES.map(id => pageRow(id))}
          <button type="button" className="side-row" onClick={onOpenPalette} aria-keyshortcuts="Control+K"
            aria-label={collapsed ? t('เครื่องมือทั้งหมด', 'All tools') : undefined}
            title={collapsed ? t('เครื่องมือทั้งหมด (Ctrl+K)', 'All tools (Ctrl+K)') : undefined}>
            <LayoutGrid size={16} aria-hidden="true" />
            <span className="side-label">{t('เครื่องมือทั้งหมด', 'All tools')}</span>
            <kbd className="side-kbd">Ctrl K</kbd>
          </button>
        </section>
      </nav>

      <div className="sidebar-foot">
        <button type="button" className="side-row" aria-current={page === 'settings' ? 'page' : undefined}
          disabled={!project} onClick={() => onOpenPage('settings')}
          aria-label={collapsed ? rowLabel('settings') : undefined} title={collapsed ? rowLabel('settings') : undefined}>
          <Settings size={16} aria-hidden="true" />
          <span className="side-label">{rowLabel('settings')}</span>
        </button>
        <button type="button" className="side-row" onClick={onStartT3} disabled={busy}
          aria-label={collapsed ? t('เปิด T3 เพื่อเขียนโค้ด', 'Open T3 coding') : undefined}
          title={collapsed ? t('เปิด T3 เพื่อเขียนโค้ด', 'Open T3 coding') : undefined}>
          <Code2 size={16} aria-hidden="true" />
          <span className="side-label">{t('เปิด T3 เพื่อเขียนโค้ด', 'Open T3 coding')}</span>
        </button>
        {t3Href && !collapsed && (
          <a className="side-row side-link" href={t3Href} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            <span className="side-label">{t('ไปที่ T3', 'Open T3')}</span>
          </a>
        )}
        <div className="side-status" role="status"
          title={connected ? t('เชื่อมต่ออยู่ ข้อมูลอัปเดตอัตโนมัติ', 'Events connected') : t('กำลังเชื่อมต่อใหม่', 'Reconnecting events')}>
          <span className={`status-dot ${connected ? 'is-live' : 'is-waiting'}`} aria-hidden="true" />
          <span className="side-label">
            {connected ? t('เชื่อมต่อแล้ว · บันทึกในเครื่อง', 'Connected · saved locally') : t('กำลังเชื่อมต่อใหม่…', 'Reconnecting…')}
          </span>
          {collapsed && <span className="visually-hidden">{connected ? t('เชื่อมต่อแล้ว', 'Connected') : t('กำลังเชื่อมต่อใหม่', 'Reconnecting')}</span>}
          <span className="side-version side-label">{health?.version ?? 'alpha'}</span>
        </div>
      </div>
    </aside>
  );
}
