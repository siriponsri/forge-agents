import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { rankItems } from './shell-routes.mjs';

const RESULT_LIMIT = 60;

// Modal command palette: one combobox, one listbox, focus kept on the input.
// Items: { key, kind, group, label, alt?, keywords?, hint?, Icon?, run(), showEmpty? }
export default function CommandPalette({ open, onClose, items, sections, groupOrder, t }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const panel = useRef(null);
  const restore = useRef(null);
  const listId = useId();
  const titleId = useId();
  const statusId = useId();

  // Remember what had focus; give it back on close unless an action moved focus.
  useLayoutEffect(() => {
    if (open) {
      restore.current = document.activeElement;
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    if (open) { input.current?.focus({ preventScroll: true }); return undefined; }
    const element = restore.current;
    restore.current = null;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (element?.isConnected && lost) element.focus({ preventScroll: true });
    return undefined;
  }, [open]);

  const term = query.trim();
  const rows = useMemo(() => {
    if (term) return rankItems(term, items, groupOrder).slice(0, RESULT_LIMIT);
    return sections.flatMap(section => items.filter(item => item.group === section.id && item.showEmpty !== false));
  }, [term, items, sections, groupOrder]);
  const index = rows.length ? Math.min(active, rows.length - 1) : -1;
  const optionId = i => `${listId}-option-${i}`;

  useEffect(() => {
    if (index >= 0) document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const choose = item => {
    if (!item || item.disabled) return;
    onClose();
    item.run();
  };
  const move = delta => setActive(current => {
    if (!rows.length) return 0;
    const from = Math.min(current, rows.length - 1);
    return (from + delta + rows.length) % rows.length;
  });
  const onKeyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'PageDown') { event.preventDefault(); move(8); }
    else if (event.key === 'PageUp') { event.preventDefault(); move(-8); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(rows[index]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'Tab') { event.preventDefault(); } // focus stays in the dialog
  };

  // Empty query: labelled sections. With a query: one ranked list with type hints.
  const blocks = [];
  if (term) blocks.push({ id: 'results', label: null, rows: rows.map((item, i) => [item, i]) });
  else {
    let i = 0;
    for (const section of sections) {
      const sectionRows = rows.filter(item => item.group === section.id).map(item => [item, i++]);
      if (sectionRows.length) blocks.push({ id: section.id, label: section.label, rows: sectionRows });
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} className="palette" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="visually-hidden">{t('ค้นหาและคำสั่ง', 'Search and commands')}</h2>
        <div className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input ref={input} type="text" role="combobox" value={query}
            aria-label={t('ค้นหาหน้า แชต โปรเจกต์ และคำสั่ง', 'Search pages, conversations, projects and commands')}
            aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={index >= 0 ? optionId(index) : undefined}
            aria-describedby={statusId}
            placeholder={t('พิมพ์ชื่อหน้า แชต หรือคำสั่ง…', 'Type a page, conversation or command…')}
            autoComplete="off" spellCheck="false"
            onChange={event => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" id={listId} role="listbox" aria-label={t('ผลการค้นหา', 'Results')}>
          {blocks.map(block => {
            const options = block.rows.map(([item, i]) => {
              const Icon = item.Icon;
              return (
                <div key={item.key} id={optionId(i)} role="option" aria-selected={i === index}
                  aria-disabled={item.disabled || undefined} data-kind={item.kind}
                  className={`palette-option${i === index ? ' is-active' : ''}`}
                  onMouseMove={() => { if (i !== index) setActive(i); }}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => choose(item)}>
                  {Icon ? <Icon size={16} aria-hidden="true" /> : <span className="palette-icon-space" aria-hidden="true" />}
                  <span className="palette-label">{item.label}</span>
                  {term && item.hint && <span className="palette-hint" aria-hidden="true">{item.hint}</span>}
                  {i === index && <CornerDownLeft className="palette-enter" size={14} aria-hidden="true" />}
                </div>
              );
            });
            return block.label
              ? <div key={block.id} role="group" aria-labelledby={`${listId}-${block.id}`} className="palette-group">
                  <div id={`${listId}-${block.id}`} className="palette-group-label" role="presentation">{block.label}</div>
                  {options}
                </div>
              : <React.Fragment key={block.id}>{options}</React.Fragment>;
          })}
          {!rows.length && <p className="palette-empty">
            {t(`ไม่พบ “${term}” ลองพิมพ์คำอื่น หรือพิมพ์ชื่อหน้าเป็นภาษาอังกฤษ`, `Nothing matches “${term}”. Try another word or the Thai name.`)}
          </p>}
        </div>
        <p id={statusId} className="palette-foot" role="status" aria-live="polite">
          <span>{term ? t(`${rows.length} รายการ`, `${rows.length} results`) : t('เครื่องมือทั้งหมด', 'All tools')}</span>
          <span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> {t('เลื่อน', 'move')} · <kbd>Enter</kbd> {t('เปิด', 'open')} · <kbd>Esc</kbd> {t('ปิด', 'close')}</span>
        </p>
      </div>
    </div>
  );
}
