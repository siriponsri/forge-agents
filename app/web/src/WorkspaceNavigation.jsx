import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import './workspace-navigation.css';

const groups = [
  { id: 'work', th: 'งานของคุณ', en: 'Your work', pages: ['plan', 'missions', 'parallel', 'chat'] },
  { id: 'create', th: 'สร้างและสำรวจ', en: 'Create & explore', pages: ['notebooks', 'office', 'reports', 'artifacts', 'research'] },
  { id: 'team', th: 'ทีมและระบบอัตโนมัติ', en: 'Team & automation', pages: ['team', 'workflows', 'strategies', 'proactive', 'memory', 'mobile'] },
  { id: 'resources', th: 'ทรัพยากรและการตั้งค่า', en: 'Resources & settings', pages: ['compute', 'serving', 'storage', 'desktop', 'monitor', 'budgets', 'settings'] },
];

// App owns routes and the unsaved-document guard; this only presents its items.
export default function WorkspaceNavigation({ items, activePage, t, onSelect }) {
  const [query, setQuery] = useState('');
  const disclosures = useRef(new Map());
  const search = useRef(null);
  const term = query.trim().toLocaleLowerCase();
  const activeGroup = groups.find(group => group.pages.includes(activePage))?.id;

  // Overview quick actions can change the route without going through this nav.
  // Reopen its disclosure after a route change or after leaving search results.
  useEffect(() => {
    const details = disclosures.current.get(activeGroup);
    if (details) details.open = true;
  }, [activePage, activeGroup, Boolean(term)]);

  const clear = () => { setQuery(''); search.current?.focus(); };
  const button = ([id, Icon, th, en]) => (
    <button key={id} type="button" aria-current={activePage === id ? 'page' : undefined}
      className={activePage === id ? 'active' : ''} onClick={() => onSelect(id)}>
      <Icon size={18} aria-hidden="true" />
      <span className="nav-label">{t(th, en)}</span>
    </button>
  );
  const matches = items.filter(([id, , th, en]) =>
    `${th} ${en} ${id}`.toLocaleLowerCase().includes(term));
  // Keep future App routes reachable even before a group is assigned to them.
  const ungrouped = items.filter(([id]) => !groups.some(group => group.pages.includes(id)));

  return (
    <nav className="workspace-navigation" aria-label={t('พื้นที่ทำงาน', 'Workspace')}>
      <div className="workspace-nav-search">
        <Search size={16} aria-hidden="true" />
        <input ref={search} type="search" value={query}
          aria-label={t('ค้นหาเครื่องมือ', 'Find a tool')}
          placeholder={t('ค้นหาเครื่องมือ', 'Find a tool')}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && query) { event.preventDefault(); clear(); }
          }} />
        {query && <button type="button" className="workspace-nav-clear"
          aria-label={t('ล้างการค้นหาเครื่องมือ', 'Clear tool search')} onClick={clear}>
          <X size={15} aria-hidden="true" />
        </button>}
      </div>
      {term ? <div className="workspace-nav-results">
        <p role="status" className="workspace-nav-status">
          {matches.length ? t(`พบ ${matches.length} เครื่องมือ`, `${matches.length} tools found`)
            : t('ไม่พบเครื่องมือ ลองค้นหาชื่ออื่น', 'No tools found. Try another name.')}
        </p>
        {matches.map(button)}
      </div> : <>
        {ungrouped.map(button)}
        {groups.map(group => <details key={group.id} className="workspace-nav-group"
          ref={element => {
            if (element) disclosures.current.set(group.id, element);
            else disclosures.current.delete(group.id);
          }} open={group.id === 'work' || group.id === activeGroup}>
          <summary>
            <ChevronRight size={16} aria-hidden="true" />
            <span>{t(group.th, group.en)}</span>
          </summary>
          <div className="workspace-nav-items">
            {group.pages.flatMap(id => items.filter(item => item[0] === id)).map(button)}
          </div>
        </details>)}
      </>}
    </nav>
  );
}
