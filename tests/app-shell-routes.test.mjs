import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PINNED_PAGES, ROUTE_GROUPS, TAB_LIMIT, closeTab, matchScore, neighbourAfterClose, openTab,
  rankItems, recentThreads, threadTitle,
} from '../app/web/src/shell-routes.mjs';

const routes = async () => {
  const source = await readFile(new URL('../app/web/src/App.jsx', import.meta.url), 'utf8');
  const nav = source.slice(source.indexOf('  const nav = ['), source.indexOf('  const startT3'));
  return [...nav.matchAll(/\[['"]([^'"]+)['"],\s*\w+,\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\]/g)].map(([, id, th, en]) => ({ id, th, en }));
};

test('every App route is grouped once and pinned surfaces exist', async () => {
  const ids = (await routes()).map(r => r.id);
  assert.equal(ids.length, 24);
  const grouped = ROUTE_GROUPS.flatMap(g => g.pages);
  assert.deepEqual([...grouped].sort(), [...ids].sort(), 'each route in exactly one palette group');
  assert.equal(new Set(grouped).size, grouped.length);
  for (const id of PINNED_PAGES) assert.ok(ids.includes(id), id);
  assert.equal(PINNED_PAGES[0], 'studio');
});

test('palette ranking: exact and prefix names first, Thai names, no cross-word keyword noise', async () => {
  const items = (await routes()).map(r => ({ key: r.id, group: 'x', label: r.en, alt: r.th }));
  const top = q => rankItems(q, items)[0]?.key;
  assert.equal(top('report'), 'reports');
  assert.equal(top('REPORT STUDIO'), 'reports');
  assert.equal(top('docs'), 'office');
  assert.equal(top('แชต'), 'chat');
  assert.equal(top('ความจำของ AI'), 'memory');
  assert.equal(top('rpt stdo'), 'reports', 'typo-tolerant on names');
  assert.deepEqual(rankItems('zz-no-tool', items), []);
  assert.equal(matchScore('report', 'overview home composer start', false), 0, 'keywords never match by scattered letters');
  assert.equal(rankItems('', items).length, items.length, 'empty query keeps everything in order');
});

test('tabs: home is never a tab, duplicates collapse, limit keeps the newest, close picks a neighbour', () => {
  let tabs = [];
  for (const id of ['overview', 'plan', 'office', 'plan', 'reports']) tabs = openTab(tabs, id);
  assert.deepEqual(tabs, ['plan', 'office', 'reports']);
  assert.equal(neighbourAfterClose(tabs, 'office'), 'reports');
  assert.equal(neighbourAfterClose(tabs, 'reports'), 'office');
  assert.equal(neighbourAfterClose(['plan'], 'plan'), 'overview');
  assert.deepEqual(closeTab(tabs, 'office'), ['plan', 'reports']);
  let many = [];
  for (let i = 0; i < TAB_LIMIT + 3; i++) many = openTab(many, 'p' + i);
  assert.equal(many.length, TAB_LIMIT);
  assert.equal(many.at(-1), 'p' + (TAB_LIMIT + 2));
});

test('threads: project-scoped, most recent activity first, readable fallback titles', () => {
  const t = (th, en) => en;
  const rooms = [
    { id: 'a', projectId: 'p', name: 'Old', createdAt: '2026-01-01T00:00:00Z', messages: [] },
    { id: 'b', projectId: 'p', name: 'Recent message', createdAt: '2025-01-01T00:00:00Z', messages: [{ createdAt: '2026-03-01T00:00:00Z' }] },
    { id: 'c', projectId: 'other', name: 'Elsewhere', createdAt: '2027-01-01T00:00:00Z', messages: [] },
    { id: 'd', projectId: 'p', kind: 'private', botId: 'bot', createdAt: '2026-02-01T00:00:00Z', messages: [] },
  ];
  assert.deepEqual(recentThreads(rooms, 'p').map(r => r.id), ['b', 'd', 'a']);
  assert.equal(threadTitle(rooms[3], [{ id: 'bot', name: 'Reviewer' }], t), 'Reviewer');
  assert.equal(threadTitle({ kind: 'team' }, [], t), 'Team room');
});
