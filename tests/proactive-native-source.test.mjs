// Engineering source-contract experiments. These never start a native server or
// model turn and never establish native runtime qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { auditUpstream } from '../app/proactive-native/audit-upstream.mjs';

async function cleanup(root) {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('forge-native-source-'))
    throw new Error('Refuse cleanup outside the explicitly created engineering fixture');
  await rm(root, { recursive: true, force: true });
}

test('source diagnostic rejects absent roots and arbitrary supported/proof input', async () => {
  for (const input of [undefined, {}, [], { supported: true }, { t3: '.', opencode: '.', proof: {} },
    { t3: '', opencode: '.' }, { t3: '\0', opencode: '.' }]) {
    await assert.rejects(auditUpstream(input), { code: 'SOURCE_ROOTS_REQUIRED' });
  }
});

test('missing source fails without returning a qualification or exposing paths/bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-native-source-'));
  try {
    await assert.rejects(auditUpstream({ t3: root, opencode: root }), failure =>
      failure.code === 'SOURCE_FILE_UNAVAILABLE' && failure.message === 'SOURCE_FILE_UNAVAILABLE');
  } finally { await cleanup(root); }
});

test('wrong source bytes fail before source code is ever executed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-native-source-'));
  try {
    await writeFile(path.join(root, 'LICENSE'), 'do not publish this untrusted source payload');
    await assert.rejects(auditUpstream({ t3: root, opencode: root }), { code: 'SOURCE_REVISION_MISMATCH' });
  } finally { await cleanup(root); }
});

const t3 = process.env.FORGE_NATIVE_T3_SOURCE;
const opencode = process.env.FORGE_NATIVE_OPENCODE_SOURCE;
const skip = !t3 || !opencode ? 'Set both FORGE_NATIVE_*_SOURCE to local pinned upstream source trees; no auto-download.' : false;

test('actual pinned primary source files verify; source integrity cannot mint a runtime proof', { skip }, async () => {
  const report = await auditUpstream({ t3, opencode });
  assert.equal(report.sourceIntegrity, 'VERIFIED');
  assert.equal(report.automaticExecutionQualified, false);
  assert.equal(report.proof, null);
  assert.equal(report.runtimeEnforcement, 'NOT_TESTED_BY_SOURCE_AUDIT');
  assert.deepEqual(report.sources.map(s => s.revision), [
    '59651c1761f6c63e9b6056839067066968e6a406', '6f0514052a3c859894ad01bb14cc14dda1e44b96',
  ]);
  assert.equal(JSON.stringify(report).includes(path.resolve(t3)), false);
});

test('primary source experiment: T3 asks and admits the whole thread MCP namespace', { skip }, async () => {
  // Check all reviewed hashes BEFORE compiling any extracted pure source helper.
  await auditUpstream({ t3, opencode });
  const source = await readFile(path.join(t3, 'packages/provider-opencode/src/server/v2/adapter.ts'), 'utf8');
  const snippets = [
    source.match(/const rule =[^;]+;/)?.[0],
    source.slice(source.indexOf('const mcpRules ='), source.indexOf('\nconst sessionRules =')),
    source.slice(source.indexOf('const sessionRules ='), source.indexOf('\nconst sameRules =')),
  ];
  assert.ok(snippets.every(Boolean), 'reviewed source helper boundaries');
  const code = stripTypeScriptTypes(snippets.join('\n'));
  const rulesFor = new Function(`${code}\nreturn sessionRules;`)();
  const rules = rulesFor({ runtimeMode: 'approval-required', interactionMode: 'default' }, [], [], 't3-code-fixture');
  assert.deepEqual(rules.slice(0, 3), [
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'edit', resource: '*', effect: 'ask' },
    { action: 'external_directory', resource: '*', effect: 'ask' },
  ]);
  assert.deepEqual(rules.at(-1), { action: 't3-code-fixture_*', resource: '*', effect: 'allow' });
  assert.equal(rules.some(r => r.action === '*' && r.effect === 'deny'), false);
});

test('primary source experiment: wildcard native denial can be overridden through permission aliases', { skip }, async () => {
  await auditUpstream({ t3, opencode });
  const source = await readFile(path.join(opencode, 'packages/core/src/tool.ts'), 'utf8');
  const snippet = source.match(/const whollyDisabled =[^]*?\n\}/)?.[0];
  assert.ok(snippet);
  // The observed counterexample uses only exact actions and '*'. This minimal
  // matcher is sufficient for those inputs; it is not a replacement runtime.
  const whollyDisabled = new Function('Wildcard', `${stripTypeScriptTypes(snippet)}\nreturn whollyDisabled;`)({
    match: (action, pattern) => pattern === '*' || action === pattern,
  });
  const rules = [
    { action: '*', resource: '*', effect: 'deny' },
    { action: 'edit', resource: '*', effect: 'ask' },
  ];
  assert.equal(whollyDisabled('future_tool', rules), true);
  // Tool.snapshot chooses options.permission ?? name. A previously unseen tool
  // declaring 'edit' remains in the snapshot. Its executor must actually assert
  // Permission before a tool.use policy can stop it. No future tool is executed.
  assert.match(source, /whollyDisabled\(tool\.options\?\.permission \?\? name, rules\)/);
  assert.equal(whollyDisabled('edit', rules), false);
  const runtime = await readFile(path.join(opencode, 'packages/core/src/tool/runtime.ts'), 'utf8');
  const execution = runtime.slice(runtime.indexOf('export const execute ='), runtime.indexOf('const decodeInput ='));
  assert.match(execution, /tool\.execute\(decoded, context\)/);
  assert.doesNotMatch(execution, /permission\.assert|Permission\.assert/);
});
