// Shell information architecture. App.jsx owns the route table and its guard;
// this module only groups routes, pins the everyday surfaces and ranks search.

// Everyday surfaces shown in the sidebar. Everything else lives in the palette.
export const PINNED_PAGES = ['studio', 'plan', 'missions', 'office', 'reports', 'notebooks', 'artifacts'];

// Palette sections for "All tools". Every route belongs to exactly one group;
// a route missing from these groups still appears under "Other".
export const ROUTE_GROUPS = [
  { id: 'start', th: 'เริ่มต้น', en: 'Start', pages: ['overview', 'studio', 'chat'] },
  { id: 'work', th: 'งานของคุณ', en: 'Your work', pages: ['plan', 'missions', 'parallel'] },
  { id: 'create', th: 'สร้างและสำรวจ', en: 'Create & explore', pages: ['notebooks', 'office', 'reports', 'artifacts', 'research'] },
  { id: 'team', th: 'ทีมผู้ช่วย AI และงานอัตโนมัติ', en: 'Team & automation', pages: ['team', 'workflows', 'strategies', 'proactive', 'memory', 'mobile'] },
  { id: 'resources', th: 'เครื่อง ข้อมูล และการตั้งค่า', en: 'Resources & settings', pages: ['compute', 'serving', 'storage', 'desktop', 'monitor', 'budgets', 'settings'] },
];

// Extra words people type for a route, in both languages.
export const ROUTE_KEYWORDS = {
  overview: 'home ภาพรวม composer start',
  studio: 'ai ml model machine learning train evaluate deploy product predict classify ผลิตภัณฑ์ โมเดล เทรน ทำนาย จัดหมวด',
  chat: 'chat thread threads message conversation ห้องสนทนา ข้อความ',
  plan: 'tasks kanban canvas งาน',
  missions: 'delivery goal เป้าหมาย ส่งมอบ',
  office: 'document sheet spreadsheet word excel เอกสาร ตาราง',
  reports: 'report docx pdf รายงาน',
  notebooks: 'python code jupyter โค้ด สมุดงาน',
  artifacts: 'files output download ไฟล์',
  settings: 'project provider model mcp ตั้งค่า บัญชี',
  team: 'bot agent บอท ทีมบอท',
  monitor: 'runs logs events',
  budgets: 'usage cost spend ค่าใช้จ่าย',
};

const normal = value => String(value ?? '').toLocaleLowerCase().normalize('NFC');

// Higher is better; 0 means no match. Prefix > word start > substring > subsequence.
export function matchScore(query, text, fuzzy = true) {
  const q = normal(query).trim();
  if (!q) return 1;
  const s = normal(text);
  if (!s) return 0;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 800 - Math.min(s.length, 200);
  const words = s.split(/[\s·/&,()\-_.]+/).filter(Boolean);
  if (words.some(word => word.startsWith(q))) return 600 - Math.min(s.length, 200);
  const at = s.indexOf(q);
  if (at >= 0) return 400 - Math.min(at, 100);
  if (!fuzzy) return 0;
  // Ordered subsequence within a compact span, rewarding contiguous runs.
  const chars = [...q].filter(char => char !== ' ');
  let index = 0, run = 0, score = 0, first = -1;
  for (const char of chars) {
    const found = s.indexOf(char, index);
    if (found < 0) return 0;
    if (first < 0) first = found;
    run = found === index ? run + 1 : 0;
    score += 1 + run;
    index = found + 1;
  }
  if (index - first > chars.length * 3) return 0;
  return Math.min(200, 50 + score);
}

// Best score across an item's fields; the visible label weighs most.
export function scoreItem(query, item) {
  // Typo-tolerant matching applies to names only; keywords and hints must match as written.
  const fields = [[item.label, 1, true], [item.alt, .95, true], [item.keywords, .7, false], [item.hint, .5, false]];
  let best = 0;
  for (const [text, weight, fuzzy] of fields) best = Math.max(best, matchScore(query, text, fuzzy) * weight);
  return best;
}

export function rankItems(query, items, groupOrder = []) {
  const order = id => { const i = groupOrder.indexOf(id); return i < 0 ? groupOrder.length : i; };
  if (!normal(query).trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: scoreItem(query, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || order(a.item.group) - order(b.item.group) || a.index - b.index)
    .map(row => row.item);
}

// Most recent activity first: last message, then update, then creation.
export function threadActivity(room) {
  const last = room.messages?.length ? room.messages[room.messages.length - 1] : null;
  return Date.parse(last?.createdAt || last?.timestamp || room.updatedAt || room.createdAt || 0) || 0;
}

export function recentThreads(conversations, projectId) {
  return (conversations || [])
    .filter(room => room.projectId === projectId)
    .map((room, index) => ({ room, index, at: threadActivity(room) }))
    .sort((a, b) => b.at - a.at || b.index - a.index)
    .map(row => row.room);
}

export function threadTitle(room, bots, t) {
  if (room.name) return room.name;
  if (room.kind === 'private') return bots?.find(bot => bot.id === room.botId)?.name || t('แชตส่วนตัว', 'Private');
  return t('แชตทีม', 'Team room');
}

export function relativeTime(value, lang, now = Date.now()) {
  if (!value) return '';
  const seconds = Math.round((value - now) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  try {
    const format = new Intl.RelativeTimeFormat(lang === 'th' ? 'th' : 'en', { numeric: 'auto', style: 'narrow' });
    for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    return format.format(0, 'minute');
  } catch {
    return '';
  }
}

// Open tabs persist per browser. Reads and writes never throw.
export const TAB_LIMIT = 8;
export function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
export function openTab(tabs, id, limit = TAB_LIMIT) {
  if (id === 'overview' || tabs.includes(id)) return tabs;
  const next = [...tabs, id];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
export function closeTab(tabs, id) {
  return tabs.filter(tab => tab !== id);
}
// After closing the active tab, select its right neighbour, else its left, else home.
export function neighbourAfterClose(tabs, id) {
  const index = tabs.indexOf(id);
  const rest = closeTab(tabs, id);
  if (index < 0) return null;
  return rest[index] ?? rest[index - 1] ?? 'overview';
}
