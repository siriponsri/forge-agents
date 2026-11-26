import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus, SlidersHorizontal } from 'lucide-react';
import ThemePicker from './ThemePicker.jsx';

// Fixed-position popover anchored to its trigger, so sidebar scrolling never clips it.
function usePopover(placement) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(null);
  const trigger = useRef(null);
  const panel = useRef(null);

  useLayoutEffect(() => {
    if (!open) { setStyle(null); return undefined; }
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 6, width = Math.min(placement.width, innerWidth - 16);
      let left = placement.side === 'right' ? r.right + gap : placement.align === 'end' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, innerWidth - width - 8));
      const top = placement.side === 'right' ? r.top : r.bottom + gap;
      setStyle({ position: 'fixed', top, left, width, maxHeight: `calc(100dvh - ${Math.round(top) + 12}px)` });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [open, placement.side, placement.align, placement.width]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (panel.current?.contains(event.target) || trigger.current?.contains(event.target)) return;
      if (event.target.closest?.('dialog[open]')) return; // a nested modal (theme chooser)
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  return { open, ready: open && !!style, setOpen, close, style, trigger, panel };
}

export function ProjectSwitcher({ t, projects, project, collapsed, onSelect, onCreate }) {
  const popover = usePopover({ side: collapsed ? 'right' : 'bottom', width: 280 });
  const items = useRef([]);
  const menuId = useId();
  const count = projects.length;

  useEffect(() => {
    if (!popover.ready) return;
    const current = Math.max(0, projects.findIndex(p => p.id === project?.id));
    items.current[count ? current : count]?.focus({ preventScroll: true });
  }, [popover.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = event => {
    const list = items.current.filter(Boolean);
    const at = list.indexOf(document.activeElement);
    const go = i => { event.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close(); }
    else if (event.key === 'Tab') popover.close(false);
  };
  const initial = (project?.name || 'F').trim().charAt(0).toLocaleUpperCase();
  const label = project?.name || t('ยังไม่มีโปรเจกต์', 'No project yet');

  return (
    <div className="project-switcher">
      <button ref={popover.trigger} type="button" className="project-switcher-trigger"
        aria-haspopup="menu" aria-expanded={popover.open} aria-controls={popover.open ? menuId : undefined}
        aria-label={`${t('เปลี่ยนโปรเจกต์', 'Switch project')}: ${label}`}
        title={collapsed ? label : undefined}
        onClick={() => popover.setOpen(open => !open)}>
        <span className="project-avatar" aria-hidden="true">{initial}</span>
        <span className="project-switcher-name">{label}</span>
        <ChevronsUpDown size={14} aria-hidden="true" className="project-switcher-chevron" />
      </button>
      {popover.ready && (
        <div ref={popover.panel} id={menuId} className="shell-popover project-menu" role="menu"
          aria-label={t('โปรเจกต์', 'Projects')} style={popover.style} onKeyDown={onKeyDown}>
          {count > 0 && <div className="shell-popover-label" aria-hidden="true">{t('โปรเจกต์', 'Projects')}</div>}
          {projects.map((p, i) => (
            <button key={p.id} ref={el => { items.current[i] = el; }} type="button" role="menuitemradio"
              aria-checked={p.id === project?.id} tabIndex={-1} className="shell-menu-item"
              onClick={() => { popover.close(); onSelect(p.id); }}>
              <span className="project-avatar small" aria-hidden="true">{p.name.trim().charAt(0).toLocaleUpperCase()}</span>
              <span className="shell-menu-text">{p.name}</span>
              {p.id === project?.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {count > 0 && <div className="shell-popover-sep" role="separator" />}
          <button ref={el => { items.current[count] = el; }} type="button" role="menuitem" tabIndex={-1}
            className="shell-menu-item" onClick={() => { popover.close(false); onCreate(); }}>
            <Plus size={15} aria-hidden="true" />
            <span className="shell-menu-text">{t('สร้างโปรเจกต์ใหม่', 'New project')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Language, theme and layout preferences in one quiet top-bar popover.
export function PreferencesMenu({ t, lang, onLanguage, theme, onTheme, collapsed, onToggleSidebar }) {
  const popover = usePopover({ side: 'bottom', align: 'end', width: 300 });
  const titleId = useId();
  const first = useRef(null);
  useEffect(() => { if (popover.ready) first.current?.focus({ preventScroll: true }); }, [popover.ready]);
  const label = t('ภาษาและธีม', 'Language & theme');
  return (
    <>
      <button ref={popover.trigger} type="button" className="icon-button" aria-label={label} title={label}
        aria-haspopup="dialog" aria-expanded={popover.open} onClick={() => popover.setOpen(open => !open)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      {popover.ready && (
        <div ref={popover.panel} className="shell-popover preferences" role="dialog" aria-labelledby={titleId}
          style={popover.style}
          onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.target.closest('dialog')) return;
            event.preventDefault(); popover.close();
          }}>
          <h2 id={titleId} className="shell-popover-title">{label}</h2>
          <div className="pref-row">
            <label htmlFor={`${titleId}-lang`}>{t('ภาษา', 'Language')}</label>
            <select ref={first} id={`${titleId}-lang`} value={lang} onChange={event => onLanguage(event.target.value)}>
              <option value="th">ไทย</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="pref-row">
            <span id={`${titleId}-theme`}>{t('ธีม', 'Theme')}</span>
            <ThemePicker theme={theme} onChange={onTheme} t={t} />
          </div>
          {onToggleSidebar && <div className="pref-row">
            <span>{t('แถบด้านข้าง', 'Sidebar')}</span>
            <button type="button" className="pref-action" aria-keyshortcuts="Control+B" onClick={onToggleSidebar}>
              {collapsed ? t('แสดงแบบเต็ม', 'Expand') : t('ย่อเป็นไอคอน', 'Collapse to icons')}
              <kbd>Ctrl B</kbd>
            </button>
          </div>}
        </div>
      )}
    </>
  );
}
