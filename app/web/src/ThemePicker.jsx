import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Moon, Palette, Search, Sun, X } from "lucide-react";
import { DEFAULT_THEME, THEMES, getTheme } from "./themes.mjs";

const english = (_th, en) => en;

function PalettePreview({ theme }) {
  return (
    <span className="theme-mini" aria-hidden="true" style={{
      "--preview-bg": theme.preview.background,
      "--preview-sidebar": theme.preview.sidebar,
      "--preview-fg": theme.preview.foreground,
      "--preview-accent": theme.preview.accent,
    }}>
      <span className="theme-mini-rail" />
      <span className="theme-mini-lines"><i /><i /><i /></span>
      <span className="theme-mini-accent" />
    </span>
  );
}

/** Controlled theme selection. The application owns persistence and root data-theme. */
export default function ThemePicker({ theme = DEFAULT_THEME, onChange, t = english }) {
  const current = getTheme(theme);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialog = useRef(null);
  const search = useRef(null);
  const trigger = useRef(null);
  const options = useRef(new Map());
  const titleId = useId();
  const hintId = useId();
  const dialogId = useId();
  const matching = THEMES.filter(item => `${item.label} ${item.kind} ${item.highContrast ? "contrast" : ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { kind: "dark", label: t("ธีมมืด", "Dark themes"), Icon: Moon },
    { kind: "light", label: t("ธีมสว่าง", "Light themes"), Icon: Sun },
  ];
  const ordered = groups.flatMap(group => matching.filter(item => item.kind === group.kind));

  useEffect(() => {
    if (open) {
      if (!dialog.current.open) dialog.current.showModal();
      search.current?.focus({ preventScroll: true });
    } else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus({ preventScroll: true });
    }
  }, [open]);

  function choose(id) {
    onChange?.(id);
    setOpen(false);
  }

  function navigate(event, id) {
    const index = ordered.findIndex(item => item.id === id);
    let next;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % ordered.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + ordered.length) % ordered.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = ordered.length - 1;
    if (next !== undefined && ordered[next]) {
      event.preventDefault();
      options.current.get(ordered[next].id)?.focus({ preventScroll: true });
      options.current.get(ordered[next].id)?.scrollIntoView({ block: "nearest" });
      onChange?.(ordered[next].id);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="theme-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId}
        aria-label={`${t("เลือกธีม", "Choose theme")}: ${current.label}`} title={`${t("ธีม", "Theme")}: ${current.label}`}
        onClick={() => { setQuery(""); setOpen(true); }}>
        <Palette size={16} aria-hidden="true" />
        <span className="theme-trigger-label">{current.label}</span>
        <ChevronDown size={12} className="theme-trigger-chevron" aria-hidden="true" />
      </button>
      <dialog ref={dialog} id={dialogId} className="theme-dialog" aria-labelledby={titleId} aria-describedby={hintId}
        onCancel={event => { event.preventDefault(); setOpen(false); }}
        onClose={() => setOpen(false)}
        onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="theme-picker-panel">
          <header className="theme-picker-head">
            <div><span className="section-eyebrow">{t("รูปลักษณ์", "Appearance")}</span><h2 id={titleId}>{t("แต่งหน้าตาให้เป็นแบบของคุณ", "Make yourself at home")}</h2></div>
            <button type="button" className="theme-close" onClick={() => setOpen(false)} aria-label={t("ปิดตัวเลือกธีม", "Close theme picker")}><X size={18} aria-hidden="true" /></button>
          </header>
          <p className="theme-picker-description" id={hintId}>{t("เลือกธีมสีที่คุ้นเคยจาก VS Code", "Choose a familiar VS Code theme.")}</p>
          <label className="theme-search">
            <Search size={16} aria-hidden="true" />
            <input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("ค้นหาธีม…", "Search themes…")} aria-label={t("ค้นหาธีม", "Search themes")}
              onKeyDown={event => {
                if (event.key === "ArrowDown" && ordered.length) { event.preventDefault(); options.current.get(ordered[0].id)?.focus({ preventScroll: true }); }
                if (event.key === "Enter" && ordered.length === 1) { event.preventDefault(); choose(ordered[0].id); }
              }} />
            <kbd aria-hidden="true">Esc</kbd>
          </label>
          <div className="theme-options" role="radiogroup" aria-label={t("ธีมสีจาก VS Code", "VS Code themes")}>
            {groups.map(({ kind, label, Icon }) => {
              const items = matching.filter(item => item.kind === kind);
              if (!items.length) return null;
              return <section className="theme-group" key={kind} aria-label={label}>
                <h3><Icon size={13} aria-hidden="true" />{label}<span>{items.length}</span></h3>
                <div className="theme-grid">
                  {items.map(item => <button key={item.id} ref={node => { if (node) options.current.set(item.id, node); else options.current.delete(item.id); }}
                    type="button" role="radio" aria-label={item.label} aria-checked={current.id === item.id} className={`theme-option ${current.id === item.id ? "is-selected" : ""}`}
                    tabIndex={current.id === item.id || !matching.some(option => option.id === current.id) && ordered[0]?.id === item.id ? 0 : -1}
                    onKeyDown={event => navigate(event, item.id)} onClick={() => choose(item.id)}>
                    <PalettePreview theme={item} />
                    <span className="theme-option-copy"><strong>{item.label}</strong><small>{item.highContrast ? t("คอนทราสต์สูง", "High contrast") : item.id === DEFAULT_THEME ? t("ค่าเริ่มต้น", "Default") : t("มากับ VS Code", "VS Code built-in")}</small></span>
                    <span className="theme-option-check" aria-hidden="true">{current.id === item.id && <Check size={14} />}</span>
                  </button>)}
                </div>
              </section>;
            })}
            {!matching.length && <p className="theme-no-results" role="status">{t("ไม่พบธีม ลองค้นหาชื่ออื่น", "No matching themes. Try another name.")}</p>}
          </div>
          <footer className="theme-picker-foot"><Palette size={13} aria-hidden="true" /><span>{t("ชุดสีจาก Microsoft VS Code · MIT", "Palettes from Microsoft VS Code · MIT")}</span><span className="theme-total">{THEMES.length} {t("ธีม", "themes")}</span></footer>
        </div>
      </dialog>
    </>
  );
}
